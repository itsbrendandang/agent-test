"""`run --jobs N`: the start rules, the loop, and the command with a fake child. No Docker, no
model, no Modal: the children here are fakes that write what a real child writes."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import pytest
from conftest import SENTINELS, Synthetic

from bixbench_v1 import cli, jobs
from bixbench_v1.jobs import Caps, Unit, next_start, run_all


def unit(name: str, capsule: str = "c1", tokens: int = 100, usd: float = 0.0) -> Unit:
    return Unit(name, capsule, Path("/out") / name, tokens, tokens - 10, usd)


# --- next_start: which run may start now ---------------------------------------------------------


def test_a_run_starts_only_when_the_caps_cover_every_running_run() -> None:
    pending = [unit("a"), unit("b"), unit("c")]
    caps = Caps(tokens=250, usd=None)
    assert next_start(pending, [], jobs=3, spent=0, caps=caps, ready=set()) == (0, None)
    # One run holds 100; another 100 fits under 250.
    assert next_start(pending[1:], pending[:1], jobs=3, spent=0, caps=caps, ready=set()) == (
        0,
        None,
    )
    # Two runs hold 200: the third waits (no STOP while something runs).
    assert next_start(pending[2:], pending[:2], jobs=3, spent=0, caps=caps, ready=set()) == (
        None,
        None,
    )


def test_stop_is_said_only_when_nothing_runs_and_the_next_run_does_not_fit() -> None:
    caps = Caps(tokens=250, usd=None)
    index, stop = next_start([unit("a")], [], jobs=2, spent=200, caps=caps, ready=set())
    assert index is None and stop is not None and stop.startswith("STOP before /out/a")


def test_the_number_of_jobs_is_a_ceiling() -> None:
    caps = Caps(tokens=None, usd=None)
    running = [unit("a"), unit("b")]
    assert next_start([unit("c")], running, jobs=2, spent=0, caps=caps, ready=set()) == (
        None,
        None,
    )


def test_a_later_run_does_not_jump_a_run_that_waits_for_the_cap() -> None:
    caps = Caps(tokens=300, usd=None)
    pending = [unit("big", tokens=250), unit("small", tokens=10)]
    assert next_start(pending, [unit("a")], jobs=3, spent=0, caps=caps, ready=set()) == (
        None,
        None,
    )


def test_modal_waits_for_the_first_run_of_a_capsule_and_looks_further() -> None:
    caps = Caps(tokens=None, usd=10.0, upload_first=True)
    running = [unit("c1/single", "c1", usd=1.0)]
    pending = [unit("c1/glhf", "c1", usd=1.0), unit("c2/single", "c2", usd=1.0)]
    # c1's data is still being uploaded by its first run: c2 starts first.
    assert next_start(pending, running, jobs=4, spent=0, caps=caps, ready=set()) == (1, None)
    # Once a run of c1 has ended, its other runs may start in order.
    assert next_start(pending, running, jobs=4, spent=0, caps=caps, ready={"c1"}) == (0, None)


def test_the_modal_cap_reserves_the_worst_case_of_running_runs() -> None:
    caps = Caps(tokens=None, usd=3.0, usd_spent=lambda: 0.5)
    running = [unit("a", usd=1.0), unit("b", usd=1.0)]
    # 0.5 in the ledger + 2.0 held + 1.0 > 3.0: wait.
    assert next_start([unit("c", usd=1.0)], running, jobs=4, spent=0, caps=caps, ready=set()) == (
        None,
        None,
    )
    index, stop = next_start([unit("c", usd=2.6)], [], jobs=4, spent=0, caps=caps, ready=set())
    assert index is None and stop is not None and "--modal-usd-cap" in stop


# --- run_all: the loop, with fake children -------------------------------------------------------


class Fake:
    """A child that ends after `steps` polls, with `code`."""

    def __init__(self, log: list[str], name: str, steps: int = 2, code: int = 0) -> None:
        self.log, self.name, self.left, self.code = log, name, steps, code
        self.signals: list[str] = []

    def poll(self) -> int | None:
        if self.left <= 0:
            return self.code
        self.left -= 1
        return None

    def interrupt(self) -> None:
        self.signals.append("INT")

    def terminate(self) -> None:
        self.signals.append("TERM")

    def kill(self) -> None:
        self.signals.append("KILL")
        self.left = 0


def test_run_all_keeps_at_most_jobs_runs_and_charges_each_one() -> None:
    units = [unit(f"r{i}", f"c{i}") for i in range(5)]
    alive: list[str] = []
    most = 0
    spent = {"tokens": 0}
    handles: dict[str, Fake] = {}

    def launch(u: Unit) -> Fake:
        nonlocal most
        alive.append(u.name)
        most = max(most, len(alive))
        handles[u.name] = Fake([], u.name)
        return handles[u.name]

    def finished(u: Unit, code: int) -> str | None:
        alive.remove(u.name)
        spent["tokens"] += 40
        return None

    stop = run_all(
        units,
        jobs=2,
        caps=Caps(tokens=None, usd=None),
        spent=lambda: spent["tokens"],
        launch=launch,
        finished=finished,
        abandoned=lambda u: None,
        sleep=lambda s: None,
    )
    assert stop is None and most == 2 and spent["tokens"] == 200 and not alive


def test_run_all_stops_starting_after_a_stop_and_lets_running_runs_end() -> None:
    started: list[str] = []
    ended: list[str] = []

    def finished(u: Unit, code: int) -> str | None:
        ended.append(u.name)
        return "STOP: the Modal cap" if u.name == "r0" else None

    stop = run_all(
        [unit(f"r{i}", f"c{i}") for i in range(4)],
        jobs=2,
        caps=Caps(tokens=None, usd=None),
        spent=lambda: 0,
        launch=lambda u: (
            started.append(u.name),
            Fake([], u.name, steps=1 if u.name == "r0" else 3),
        )[1],
        finished=finished,
        abandoned=lambda u: None,
        say=lambda text: None,
        sleep=lambda s: None,
    )
    assert stop == "STOP: the Modal cap"
    assert started == ["r0", "r1"] and sorted(ended) == ["r0", "r1"]


def test_ctrl_c_is_passed_on_then_escalates_and_charges_the_runs() -> None:
    handles: list[Fake] = []
    abandoned: list[str] = []
    calls = {"sleep": 0}

    def sleep(seconds: float) -> None:
        calls["sleep"] += 1
        if calls["sleep"] == 1:
            raise KeyboardInterrupt

    def launch(u: Unit) -> Fake:
        handles.append(Fake([], u.name, steps=10_000))
        return handles[-1]

    with pytest.raises(KeyboardInterrupt):
        run_all(
            [unit("a", "c1"), unit("b", "c2")],
            jobs=2,
            caps=Caps(tokens=None, usd=None),
            spent=lambda: 0,
            launch=launch,
            finished=lambda u, code: None,
            abandoned=lambda u: abandoned.append(u.name),
            say=lambda text: None,
            sleep=sleep,
            grace=(2, 2),
        )
    assert all(h.signals == ["INT", "TERM", "KILL"] for h in handles)
    assert abandoned == ["a", "b"]


# --- the command with a fake child ----------------------------------------------------------------


class FakeChild:
    """Does what a real child does to the run folder: writes run.json and the result."""

    def __init__(self, spec: Path, tokens: int, fail: bool = False) -> None:
        document = jobs.read_spec(spec)
        run_dir: Path = document["run"]["out_dir"]
        run_dir.mkdir(parents=True, exist_ok=True)
        self.polls = 2
        if fail:
            jobs.write_json(Path(document["result"]), {"ok": False, "error": "boom"})
            self.code = 1
            return
        summary = {"status": "done", "total_tokens": tokens, "seconds": 1.0, "settings": {}}
        (run_dir / "run.json").write_text(json.dumps(summary))
        jobs.write_json(Path(document["result"]), {"ok": True})
        self.code = 0
        self.spec = document

    def poll(self) -> int | None:
        self.polls -= 1
        return self.code if self.polls < 0 else None

    def interrupt(self) -> None: ...
    def terminate(self) -> None: ...
    def kill(self) -> None: ...


def _command(
    synthetic: Synthetic, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, *extra: str
) -> tuple[Path, list[dict[str, Any]], list[str]]:
    out = tmp_path / "set"
    specs: list[dict[str, Any]] = []
    graded: list[str] = []

    def launch(argv: list[str], log: Path) -> FakeChild:
        assert argv[1:3] == ["-m", "bixbench_v1.cli"] and argv[-2] == "solve-one"
        child = FakeChild(Path(argv[-1]), tokens=1_000, fail="glhf" in argv[-1])
        if hasattr(child, "spec"):
            specs.append(child.spec)
        return child

    monkeypatch.setattr(cli, "_launch_child", launch)
    monkeypatch.setattr(cli, "grade_run", lambda run_dir, *a, **k: graded.append(run_dir.name))
    monkeypatch.setattr(cli, "_write_report", lambda out, profile: None)
    monkeypatch.setattr(cli, "load_env", lambda path: [])
    monkeypatch.setattr(jobs.time, "sleep", lambda s: None)
    argv = ["bixbench-v1", "--data", str(synthetic.hub.parent), "run", "--capsules", "syn-1"]
    argv += ["--out", str(out), "--max-tokens", "400000", "--time-limit", "300", *extra]
    monkeypatch.setattr(sys, "argv", argv)
    return out, specs, graded


def test_the_command_runs_children_and_keeps_one_budget(
    synthetic: Synthetic, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    out, specs, graded = _command(synthetic, tmp_path, monkeypatch, "--jobs", "2", "--repeats", "2")
    assert cli.main() == 0
    budget = json.loads((out / "budget.json").read_text())
    runs = {r["run"]: r for r in budget["runs"]}
    assert set(runs) == {
        "syn-1_11111111/single",
        "syn-1_11111111/glhf",
        "syn-1_11111111/single-r1",
        "syn-1_11111111/glhf-r1",
    }
    # A failed child is charged its backstop (1.25 x 400,000); a finished one what it spent.
    assert runs["syn-1_11111111/glhf"]["status"] == "error"
    assert "boom" in runs["syn-1_11111111/glhf"]["error"]
    assert budget["spent"] == 2 * 1_000 + 2 * 500_000
    assert sorted(graded) == ["single", "single-r1"]
    # The spec holds the capsule by uuid and never a question's answer.
    spec_text = json.dumps(specs, default=str)
    assert specs and specs[0]["capsule_uuid"] == synthetic.capsule.uuid
    assert not [v for v in SENTINELS.values() if v in spec_text]
    assert {s["run"]["jobs"] for s in specs} == {2}
    # The data was staged once, by the parent, before any child.
    assert (synthetic.hub.parent / "staged" / synthetic.capsule.uuid / "manifest.json").exists()


def test_the_command_with_jobs_respects_the_token_cap(
    synthetic: Synthetic, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Worst case of a run: 1.25 x 400,000 + 20,000 = 520,000. A cap of 1,100,000 holds two
    # running runs, never three, even with --jobs 4; after two finish (1,000 each) two more fit.
    out, _specs, _ = _command(
        synthetic,
        tmp_path,
        monkeypatch,
        "--jobs",
        "4",
        "--solvers",
        "single",
        "--repeats",
        "4",
        "--total-token-cap",
        "1100000",
    )
    most = 0
    launched = 0
    graded: list[str] = []
    original = cli._launch_child

    def counting(argv: list[str], log: Path) -> Any:
        nonlocal most, launched
        launched += 1
        most = max(most, launched - len(graded))  # running = started - ended
        return original(argv, log)

    monkeypatch.setattr(cli, "_launch_child", counting)
    monkeypatch.setattr(cli, "grade_run", lambda run_dir, *a, **k: graded.append(run_dir.name))
    assert cli.main() == 0
    budget = json.loads((out / "budget.json").read_text())
    assert len(budget["runs"]) == 4 and budget["spent"] == 4_000
    assert most == 2


def test_jobs_must_be_at_least_one(
    synthetic: Synthetic, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _command(synthetic, tmp_path, monkeypatch, "--jobs", "0")
    with pytest.raises(SystemExit, match="--jobs must be at least 1"):
        cli.main()


def test_spec_round_trip_keeps_paths(tmp_path: Path) -> None:
    u = Unit("c/single", "uuid-1", tmp_path / "c" / "single", 10, 5)
    u.run = {
        "hub_dir": tmp_path / "hub",
        "staged_root": tmp_path / "staged",
        "out_dir": u.run_dir,
        "modal_ledgers": [tmp_path / "a.jsonl"],
        "model": "mock",
    }
    spec, result, log = jobs.spec_paths(tmp_path, u)
    assert spec.parent.name == jobs.JOBS_DIR and log.name == "c__single.log"
    jobs.write_spec(spec, u, result, {"modal": False})
    back = jobs.read_spec(spec)
    assert back["run"]["out_dir"] == u.run_dir and back["run"]["modal_ledgers"] == [
        tmp_path / "a.jsonl"
    ]
    assert jobs.read_result(result)["ok"] is False  # nothing written yet
