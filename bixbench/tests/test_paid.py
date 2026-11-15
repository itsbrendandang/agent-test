"""Item 1: the NO_PAID_CALLS switch, and --budget-tokens."""

import pytest
from conftest import FAKE_KEY

import regrade
import run
from bixbase import paid
from bixbase.llm import LLMClient


@pytest.mark.parametrize("value,off", [
    (None, True), ("", True), ("1", True), ("false", True), ("no", True),
    ("00", True), ("O", True), ("0", False), (" 0 ", False),
])
def test_rule_only_exact_zero_allows(value, off):
    env = {} if value is None else {"NO_PAID_CALLS": value}
    assert paid.paid_calls_off(env, files=[]) is off


def test_read_order_env_then_nearest_file_then_repo_file(tmp_path):
    near, repo = tmp_path / "near.env", tmp_path / "repo.env"
    near.write_text(f"OPENAI_API_KEY={FAKE_KEY}\nexport NO_PAID_CALLS='0'  # on\n")
    repo.write_text("NO_PAID_CALLS=1\n")
    assert paid.switch_value({}, [near, repo]) == "0"
    assert paid.switch_value({}, [repo, near]) == "1"
    assert paid.switch_value({"NO_PAID_CALLS": "1"}, [near, repo]) == "1"
    near.write_text(f"OPENAI_API_KEY={FAKE_KEY}\n")  # no switch line: fall through
    assert paid.switch_value({}, [near, repo]) == "1"
    assert paid.switch_value({}, [near]) is None
    assert paid.paid_calls_off({}, [near]) is True


def test_llmclient_refuses_while_switch_is_on(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", FAKE_KEY)
    with pytest.raises(paid.PaidCallsOff) as e:
        LLMClient(model="gpt-4o", provider="openai")
    assert paid.HOW_TO_ALLOW in str(e.value)
    assert FAKE_KEY not in str(e.value)
    with pytest.raises(paid.PaidCallsOff):
        LLMClient()  # auto-detected provider: refused before any key is looked at


def test_llmclient_passes_the_switch_only_at_zero(monkeypatch):
    monkeypatch.setenv("NO_PAID_CALLS", "0")
    # a provider that does not exist: proves the switch let it through
    # without building a real client or calling anything
    with pytest.raises(ValueError, match="unknown provider"):
        LLMClient(model="m", provider="bogus")


def test_enforce_blanks_keys_and_dotenv_does_not_bring_them_back(tmp_path):
    dotenv = pytest.importorskip("dotenv")
    env_file = tmp_path / ".env"
    env_file.write_text(f"ANTHROPIC_API_KEY={FAKE_KEY}\nOPENAI_API_KEY={FAKE_KEY}\n")
    import os
    assert paid.enforce() is True
    dotenv.load_dotenv(env_file)
    for key in paid.PAID_KEYS:
        assert os.environ[key] == ""


def test_enforce_leaves_keys_when_allowed():
    env = {"NO_PAID_CALLS": "0", "OPENAI_API_KEY": FAKE_KEY}
    assert paid.enforce(env) is False
    assert env["OPENAI_API_KEY"] == FAKE_KEY


def _boom(*a, **k):
    raise AssertionError("must not be reached while paid calls are off")


def test_run_py_refused_before_anything_starts(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(run, "load_dotenv", _boom)
    monkeypatch.setattr(run, "load_studies", _boom)
    monkeypatch.setattr(run, "LLMClient", _boom)
    out = tmp_path / "results"
    rc = run.main(["--studies", "x", "--budget-tokens", "1000", "--out", str(out)])
    assert rc == 2
    assert paid.HOW_TO_ALLOW in capsys.readouterr().err
    assert not out.exists()


def test_regrade_py_refused_before_anything_starts(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(regrade, "load_dotenv", _boom)
    monkeypatch.setattr(regrade, "load_studies", _boom)
    monkeypatch.setattr(regrade, "LLMClient", _boom)
    assert regrade.main(["--results", str(tmp_path)]) == 2
    assert paid.HOW_TO_ALLOW in capsys.readouterr().err


@pytest.mark.parametrize("argv", [[], ["--budget-tokens", "0"]])
def test_run_py_requires_budget_tokens(argv, capsys):
    with pytest.raises(SystemExit) as e:
        run.parse_args(["--studies", "x", *argv])
    assert e.value.code == 2
    assert "--budget-tokens is required" in capsys.readouterr().err
    assert run.parse_args(["--budget-tokens", "5"]).budget_tokens == 5
