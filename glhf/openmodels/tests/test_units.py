"""Registry rules, ledger arithmetic, the capsule draw, the key file, the checks, the estimate."""

from __future__ import annotations

import copy
import json
import stat
from pathlib import Path
from typing import Any

import pytest
import yaml
from bixbench_v1 import paid
from helpers import KEY, QWEN, REPO_REGISTRY, URL, FakeEndpoint

from openmodels import capsules, checks, estimate, ledger, registry, serve

RAW = yaml.safe_load(registry.REGISTRY.read_text())


def broken(**changes: Any) -> dict[str, Any]:
    data = copy.deepcopy(RAW)
    data["models"][0].update(changes)
    return data


# --- registry ----------------------------------------------------------------------------------


def test_the_registry_in_the_repo_is_valid_and_matches_its_app_files() -> None:
    assert QWEN.on_modal and QWEN.gated is False and QWEN.context_length >= registry.CONTEXT_NEEDED
    assert QWEN.price_per_second == pytest.approx((1.95 + 4 * 0.0473 + 32 * 0.008) / 3600, abs=5e-7)
    constants = registry.app_constants(registry.ROOT / QWEN.app_file)
    assert constants["SCALEDOWN_SECONDS"] <= 300 and constants["MAX_CONTAINERS"] == 1
    for (
        model
    ) in REPO_REGISTRY.models:  # no file or folder called `modal`: it would shadow the package
        assert model.kind != "modal-app" or "modal" not in Path(model.app_file).stem.split("_")
    assert not list(registry.ROOT.rglob("modal.py")) and not (registry.ROOT / "modal").exists()


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"revision": "main"}, "pinned 40-character revision"),
        ({"price_per_second": 0.000542}, "does not match the price table"),
        ({"gpu": "Z9000"}, "no price for GPU"),
        ({"gated": True, "status": "served"}, "gated model waits"),
        ({"gated": None}, "`gated` must be true or false"),
        ({"tool_call_parser": None}, "tool_call_parser"),
        ({"scaledown_seconds": 900}, "scaledown_seconds must be"),
        ({"context_length": 32768}, "say so in `limits`"),
        ({"inspect_model": "openai/gpt-5.5"}, "inspect_model must be"),
        ({"status": "great"}, "status"),
        ({"max_output_tokens": 999}, "MAX_OUTPUT_TOKENS"),
        ({"app_file": "apps/none.py"}, "not found"),
    ],
)
def test_a_registry_that_breaks_a_rule_is_refused(changes: dict[str, Any], message: str) -> None:
    with pytest.raises(registry.RegistryError, match=message):
        registry.validate(broken(**changes))


def test_an_app_that_opens_the_endpoint_or_keeps_a_container_warm_is_refused(
    tmp_path: Path,
) -> None:
    source = (registry.ROOT / QWEN.app_file).read_text()
    (tmp_path / "apps").mkdir()
    for edit, message in (
        (
            (
                "    min_containers=MIN_CONTAINERS,",
                "    min_containers=MIN_CONTAINERS,\n    unauthenticated=True,",
            ),
            "unauthenticated",
        ),
        (("MIN_CONTAINERS = 0", "MIN_CONTAINERS = 1"), "MAX_CONTAINERS=1 and MIN_CONTAINERS=0"),
        (("MAX_CONTAINERS = 1", "MAX_CONTAINERS = 4"), "MAX_CONTAINERS=1 and MIN_CONTAINERS=0"),
    ):
        assert edit[0] in source
        (tmp_path / QWEN.app_file).write_text(source.replace(*edit))
        with pytest.raises(registry.RegistryError, match=message):
            registry.validate(copy.deepcopy(RAW), tmp_path)
    (tmp_path / QWEN.app_file).write_text(source)
    registry.validate(copy.deepcopy(RAW), tmp_path)  # the unchanged file passes


def test_a_vendor_model_needs_cited_prices() -> None:
    data = copy.deepcopy(RAW)
    opus = next(m for m in data["models"] if m["name"] == "claude-opus-5-5")
    del opus["usd_per_mtok"]["source"]
    with pytest.raises(registry.RegistryError, match="source"):
        registry.validate(data)


# --- ledger ------------------------------------------------------------------------------------


def test_ledger_arithmetic_and_totals(tmp_path: Path) -> None:
    assert ledger.dollars(3600, 0.000665) == 2.394 and ledger.dollars(-5, 1.0) == 0.0
    line = ledger.entry(
        QWEN, REPO_REGISTRY.prices, seconds=1000, seconds_source="wall-clock", run="r", note="n"
    )
    assert line["usd"] == pytest.approx(0.6653, abs=1e-4) and line["resource"]["gpu"] == "L40S x1"
    assert line["price"]["gpu_s"] == pytest.approx(1.95 / 3600)
    path = tmp_path / "a" / "ledger.jsonl"
    ledger.append(line, path)
    ledger.append({"job": "modal-bench", "usd": 1.0}, path)  # the other key names are read too
    ledger.append({"who": "modal-sandbox", "usd": 3.0}, path)
    with path.open("a") as handle:
        handle.write("not json\n[1, 2]\n")
    assert len(ledger.read(path)) == 3
    assert ledger.total(path) == pytest.approx(1.6653, abs=1e-4)
    assert ledger.total(path, who=None) == pytest.approx(4.6653, abs=1e-4)
    assert ledger.total(tmp_path / "missing.jsonl") == 0.0


def test_the_guard_refuses_at_the_cap(tmp_path: Path) -> None:
    path = tmp_path / "ledger.jsonl"
    ledger.append({"who": "modal-bench", "usd": 12.0}, path)
    guard = ledger.Guard(cap_usd=20.0, path=path)
    assert guard.check(8.0, "x") == 12.0  # exactly at the cap is allowed
    with pytest.raises(ledger.CapExceeded, match=r"12\.00 USD.*8\.01 USD.*cap 20\.00"):
        guard.check(8.01, "x")


def test_worst_case_covers_cold_start_every_run_and_the_scaledown() -> None:
    seconds = ledger.worst_case_seconds(QWEN, runs=2, time_limit_seconds=1800)
    assert seconds == 1200 + 300 + 2 * (1800 + 300 + 120) + 300


# --- capsule draw ------------------------------------------------------------------------------


def test_the_recorded_draw_can_be_repeated_and_avoids_the_pilot() -> None:
    made = json.loads(capsules.LIST_FILE.read_text())
    assert made["capsules"] == capsules.draw(list(made["pool"]), made["seed"], made["count"])
    assert len(made["capsules"]) == 20 == len(set(made["capsules"]))
    assert not set(made["capsules"]) & set(made["excluded"]) and not set(made["pool"]) & set(
        made["excluded"]
    )
    assert sorted(made["excluded"]) == ["bix-29_b8c485ff", "bix-2_30b33e47", "bix-46_d37acffb"]
    assert made["questions"] == sum(made["pool"][key] for key in made["capsules"])
    keys, counts = capsules.load()
    assert keys == made["capsules"] and sum(counts.values()) == made["questions"]


def test_the_draw_depends_on_the_seed_and_not_on_the_order_of_the_pool(tmp_path: Path) -> None:
    pool = [f"bix-{n}_x" for n in range(40)]
    assert capsules.draw(pool, 1, 5) == capsules.draw(pool[::-1], 1, 5) != capsules.draw(pool, 2, 5)
    with pytest.raises(ValueError):
        capsules.draw(pool, 1, 41)
    (tmp_path / "p" / "bix-1_a").mkdir(parents=True)
    (tmp_path / "p" / "report.md").write_text("x")
    assert capsules.pilot_capsules(tmp_path / "p") == ["bix-1_a"]
    made = capsules.record({"bix-1_a": 3, **dict.fromkeys(pool, 2)}, ["bix-1_a"], seed=1, count=5)
    assert "bix-1_a" not in made["pool"] and made["questions"] == 10
    text = tmp_path / "list.txt"
    text.write_text("# smoke\nbix-46_d37acffb\n")
    assert capsules.load(text) == (["bix-46_d37acffb"], {})


# --- key file and Modal commands ---------------------------------------------------------------


def test_the_key_is_written_private_and_never_returned(
    tmp_path: Path, allowed: None, capsys: pytest.CaptureFixture[str]
) -> None:
    path = tmp_path / ".secrets" / "endpoint.json"

    def run(command: Any) -> serve.Done:
        return serve.Done(0, json.dumps({"token_id": "wk-abc123", "token_secret": "ws-topsecret"}))

    assert serve.create_key(run, path) == "wk-abc123"
    assert (
        stat.S_IMODE(path.stat().st_mode) == 0o600
        and serve.load_key(path) == "wk-abc123.ws-topsecret"
    )
    assert "topsecret" not in capsys.readouterr().out
    with pytest.raises(serve.ServeError, match="already exists"):
        serve.create_key(run, path)
    path.chmod(0o644)
    with pytest.raises(serve.ServeError, match="readable by others"):
        serve.load_key(path)
    with pytest.raises(serve.ServeError, match="not shown") as failed:
        serve.create_key(lambda command: serve.Done(1, "ws-leak error"), tmp_path / "other.json")
    assert "ws-leak" not in str(failed.value)


def test_modal_actions_are_refused_while_the_switch_is_on(tmp_path: Path, clean: list[str]) -> None:
    called: list[Any] = []
    run = lambda command: called.append(command) or serve.Done(0, "")  # noqa: E731
    for action in (
        lambda: serve.create_key(run, tmp_path / "k.json"),
        lambda: serve.deploy(QWEN, run),
        lambda: serve.http("GET", URL + "/v1/models", {}, None, 1.0),
    ):
        with pytest.raises(paid.PaidCallsOff, match="NO_PAID_CALLS"):
            action()
    assert called == [] and clean == [] and not (tmp_path / "k.json").exists()
    assert (
        serve.stop("openmodels-x", lambda command: serve.Done(0, "[]")) is True
    )  # stopping is never refused


def test_stop_waits_for_modal_to_list_the_app_as_stopped() -> None:
    states = iter(["stopping", "stopping", "stopped"])
    waits: list[float] = []

    def run(command: Any) -> serve.Done:
        if command[:3] == ["modal", "app", "stop"]:
            return serve.Done(0, "")
        return serve.Done(0, json.dumps([{"description": "openmodels-a", "state": next(states)}]))

    assert serve.stop("openmodels-a", run, sleep=waits.append) is True and waits == [5.0, 5.0]

    def never(command: Any) -> serve.Done:
        return serve.Done(0, json.dumps([{"description": "openmodels-a", "state": "deployed"}]))

    assert serve.stop("openmodels-a", never, tries=3, sleep=waits.append) is False


def test_live_lists_only_our_apps_that_are_not_stopped() -> None:
    listing = [
        {"App ID": "ap-1", "Description": "openmodels-a", "State": "deployed"},
        {"App ID": "ap-2", "Description": "openmodels-b", "State": "stopped"},
        {"App ID": "ap-3", "Description": "someone-else", "State": "deployed"},
    ]
    assert serve.live(lambda command: serve.Done(0, json.dumps(listing))) == ["openmodels-a"]
    with pytest.raises(serve.ServeError):
        serve.live(lambda command: serve.Done(1, "", "not logged in"))


# --- checks ------------------------------------------------------------------------------------


def test_key_check_fails_an_endpoint_that_answers_without_the_key() -> None:
    assert checks.key_check(URL, KEY, FakeEndpoint(cold_503=0))["ok"] is True
    opened = checks.key_check(URL, KEY, FakeEndpoint(open_without_key=True, cold_503=0))
    assert opened["ok"] is False and opened["paths"]["GET /health"]["no_key"] == 200
    assert checks.key_check(URL, "wk-other.ws-other", FakeEndpoint(cold_503=0))["ok"] is False


def test_tool_check_needs_a_parsed_call_with_the_right_value() -> None:
    good = checks.tool_check(URL, KEY, "m", FakeEndpoint(cold_503=0))
    assert (
        good["ok"]
        and good["arguments"] == {"question_id": "q1", "answer": "42"}
        and good["second_turn"] == "done"
    )
    text = checks.tool_check(URL, KEY, "m", FakeEndpoint(tools=False, cold_503=0))
    assert text["ok"] is False and "no parsed tool call" in text["problem"]

    def wrong(
        method: str, url: str, headers: dict[str, str], body: Any, timeout: float
    ) -> tuple[int, Any]:
        call = {
            "id": "c",
            "function": {
                "name": "submit_answer",
                "arguments": '{"question_id": "q1", "answer": "41"}',
            },
        }
        return 200, {
            "choices": [{"message": {"tool_calls": [call]}, "finish_reason": "tool_calls"}]
        }

    assert checks.tool_check(URL, KEY, "m", wrong)["problem"] == "wrong tool or wrong value"

    def not_json(
        method: str, url: str, headers: dict[str, str], body: Any, timeout: float
    ) -> tuple[int, Any]:
        call = {"id": "c", "function": {"name": "submit_answer", "arguments": "{answer: 42"}}
        return 200, {
            "choices": [{"message": {"tool_calls": [call]}, "finish_reason": "tool_calls"}]
        }

    assert checks.tool_check(URL, KEY, "m", not_json)["problem"] == "the arguments are not JSON"
    with pytest.raises(serve.ServeError, match="answered 500"):
        checks.tool_check(URL, KEY, "m", lambda *a: (500, "boom"))


# --- estimate ----------------------------------------------------------------------------------


def test_a_vendor_cell_is_the_pilots_tokens_per_question_at_the_models_prices() -> None:
    pilot = {
        "input_tokens": 80.0,
        "output_tokens": 8000.0,
        "cache_read_tokens": 240000.0,
        "cache_write_tokens": 32000.0,
        "questions": 8.0,
    }
    opus = REPO_REGISTRY.get("claude-opus-5-5")
    cell = estimate.api_cell(pilot, 80, opus)  # ten times the pilot's questions
    # 800 x 4 + 320,000 x 5 + 2,400,000 x 0.2 + 80,000 x 20, per million tokens
    assert cell["usd_parts"] == {
        "input": 0.0,
        "cache_write": 1.6,
        "cached_input": 0.48,
        "output": 1.6,
    }
    assert cell["expected_usd"] == 3.68
    assert cell["no_cache_usd"] == pytest.approx((2_720_800 * 4 + 80_000 * 20) / 1e6, abs=0.01)
    assert cell["tokens_per_question"]["cache_read_tokens"] == 30000
    assert estimate.gpu_cell(120.0, 82, 0.000665) == {
        "questions": 82,
        "seconds_per_question": 120.0,
        "seconds": 9840,
        "usd": 6.54,
    }
