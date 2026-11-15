"""Item 4: result.json never holds the ideal answers; grading and regrading
read them host-side and always cover every question of the study."""

import json

import pytest

import regrade
import run
from bixbase.loader import Question, Study
from bixbase.sandbox import sandbox_available
from selftest import ScriptedLLM

IDEAL_1, IDEAL_2 = "IDEAL-SENTINEL-ALPHA", "IDEAL-SENTINEL-BETA"


def make_study(tmp_path) -> Study:
    data = tmp_path / "data" / "s1"
    data.mkdir(parents=True)
    (data / "values.csv").write_text("x\n1\n")
    study = Study(
        study_id="s1", data_folder="s1",
        questions=[
            Question("s1-q1", "first?", IDEAL_1, eval_mode="str_verifier"),
            Question("s1-q2", "second?", IDEAL_2, eval_mode="llm_verifier"),
        ],
    )
    study._data_dir = data.resolve()
    return study


class FakeClient(ScriptedLLM):
    """Stands in for LLMClient in run.py / regrade.py: scripted, no network."""

    made = 0

    def __init__(self, model=None, provider=None, seed=None):
        type(self).made += 1
        super().__init__([
            {"tool_calls": [{"name": "run_code", "input": {"code": "print(1)"}}]},
            {"tool_calls": [{"name": "submit_answer", "input": {
                "answers": {"s1-q1": IDEAL_1.lower()}}}]},  # q2 left unanswered
        ])
        self.model, self.provider = model or "scripted-fake", provider or "fake"

    def complete(self, prompt, *, budget):
        budget.record_usage(1, 1)
        return "<grade> incorrect </grade>"


@pytest.fixture
def fake_models(monkeypatch):
    """Paid switch 'allowed', but every way to a real model is replaced."""
    monkeypatch.setenv("NO_PAID_CALLS", "0")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-fake-not-a-key-0000")
    for mod in (run, regrade):
        monkeypatch.setattr(mod, "LLMClient", FakeClient)
        monkeypatch.setattr(mod, "load_dotenv", lambda *a, **k: None)
    # the scripted cell is ours, so off macOS it may run without a sandbox
    real = run.Sandbox
    monkeypatch.setattr(run, "Sandbox", lambda d, w, **k: real(
        d, w, unsafe_no_sandbox=not sandbox_available()))


def test_run_one_grades_but_stores_no_ideal(tmp_path, fake_models):
    study = make_study(tmp_path)
    out = tmp_path / "results"
    args = run.parse_args(["--budget-tokens", "10000", "--out", str(out),
                           "--cache-dir", str(tmp_path / "data")])
    row = run.run_one(study, 0, args, out)

    assert row["answers"]["s1-q1"] == IDEAL_1.lower()
    assert row["grades"]["s1-q1"]["grade"] == 1          # graded host-side
    assert row["grades"]["s1-q2"]["grade"] == 0
    assert row["grades"]["s1-q2"]["predicted"] == "<no_answer>"
    assert row["metrics"]["n_total"] == 2 and row["metrics"]["n_correct"] == 1
    stored = json.loads((out / "s1" / "rep0" / "result.json").read_text())
    assert all("ideal" not in g for g in stored["grades"].values())
    # the ideal the model did not itself submit appears in no file of the run
    for f in out.rglob("*"):
        if f.is_file():
            assert IDEAL_2 not in f.read_text(errors="replace"), f
            assert '"ideal"' not in f.read_text(errors="replace"), f


def test_regrade_full_denominator_new_file_no_ideal(tmp_path, fake_models, monkeypatch, capsys):
    study = make_study(tmp_path)
    monkeypatch.setattr(regrade, "load_studies", lambda *a, **k: [study])
    results = tmp_path / "results"
    old = {
        "study_id": "s1", "repeat": 0, "error": None,
        "answers": {"s1-q1": IDEAL_1},                   # q2 missing entirely
        "grades": {"s1-q1": {"predicted": IDEAL_1, "ideal": IDEAL_1,
                             "grade": 0, "grade_type": "incorrect"}},
        "metrics": {"accuracy": 0.0, "n_total": 1},
        "budget": {"used": {"total_tokens": 7}, "elapsed_seconds": 1.0},
    }
    errored = dict(old, repeat=1, error="boom", answers={}, grades={}, metrics=None)
    orphan = dict(old, study_id="gone", repeat=0)
    paths = {}
    for row in (old, errored, orphan):
        p = results / row["study_id"] / f"rep{row['repeat']}" / "result.json"
        p.parent.mkdir(parents=True)
        p.write_text(json.dumps(row, indent=2))
        paths[p] = p.read_bytes()

    assert regrade.main(["--results", str(results)]) == 0

    for p, before in paths.items():
        assert p.read_bytes() == before                  # nothing overwritten
    new_root = tmp_path / "results_regraded"
    new = json.loads((new_root / "s1" / "rep0" / "result.json").read_text())
    assert set(new["grades"]) == {"s1-q1", "s1-q2"}
    assert new["metrics"]["n_total"] == 2 and new["metrics"]["n_correct"] == 1
    assert new["metrics"]["accuracy"] == 0.5
    err = json.loads((new_root / "s1" / "rep1" / "result.json").read_text())
    assert err["metrics"]["n_total"] == 2 and err["metrics"]["n_correct"] == 0
    assert not (new_root / "gone").exists()
    assert "SKIPPED" in capsys.readouterr().err
    for f in new_root.rglob("*.json"):
        assert '"ideal"' not in f.read_text() and IDEAL_2 not in f.read_text()

    # summarize.py reads the new tree as it is
    import summarize
    assert summarize.main(["--results", str(new_root)]) == 0
    summary = json.loads((new_root / "summary.json").read_text())
    assert summary["overall"]["n_questions"] == 4        # 2 runs x 2 questions
    assert summary["overall"]["n_correct"] == 1


def test_regrade_refuses_to_write_into_the_results_tree(tmp_path, fake_models, monkeypatch):
    monkeypatch.setattr(regrade, "load_studies", lambda *a, **k: [])
    results = tmp_path / "results"
    results.mkdir()
    assert regrade.main(["--results", str(results), "--out", str(results)]) == 2
    assert regrade.main(["--results", str(results), "--out", str(results / "x")]) == 2
