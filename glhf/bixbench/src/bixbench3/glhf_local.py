"""Run one case on this machine with either solver, then grade it with the official grader.

    uv run python -m bixbench3.glhf_local --case ../demo_case --solver glhf --model mock --out runs/demo-glhf
    uv run python -m bixbench3.glhf_local --case ../demo_case --solver single --model anthropic/claude-opus-5 --out runs/demo-single

For the demo case and for tests. Real BixBench3 tasks need the cloud runner (`bixbench3 run`):
their data is 8 to 259 GB and they need the full runtime image.

`--model mock` plays a fixed script and needs no API key. It proves the plumbing, not the science.

Layout of --out: workspace/ outputs/ logs/ grade.json run.json
"""

from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path
from typing import Any

from inspect_ai import eval as inspect_eval
from inspect_ai.model import Model, ModelOutput, get_model

from bixbench3.grading.grader import grade
from bixbench3.inspect_harness.models import RuntimeCase
from bixbench3.inspect_harness.tasks import bixbench3_cases

LOCAL_COMPOSE = Path(__file__).parents[2] / "sandbox" / "local-compose.yaml"
MOCK = "mockllm/model"
ROLES = ("planner", "experimenter", "critic", "reporter")


def _call(tool: str, **arguments: object) -> ModelOutput:
    return ModelOutput.for_tool_call(MOCK, tool, arguments)


def _write(path: str, text: str) -> ModelOutput:
    return _call("python", code=f"open({path!r}, 'w').write({text!r})\nprint('wrote', {path!r})")


def _done(answer: str) -> ModelOutput:
    return _call("submit", answer=answer)


def mock_script(solver: str, truths: dict[str, str]) -> list[ModelOutput]:
    """A fixed script for `--model mock`. `truths` maps each required sandbox path to correct content.

    Swarm story: the first pass leaves the first artifact with a header and no rows; the critic
    rejects it and refutes the claim that the first pass was complete; the reviser fixes it; the
    second review finds nothing; the reporter writes METHODS.md.
    """
    methods = _write(
        "/outputs/METHODS.md", "# Methods\n\nScripted mock run. No analysis was performed.\n"
    )
    correct = [_write(path, text) for path, text in truths.items()]
    if solver == "single":
        return [*correct, methods, _done("done")]
    first_path, first_text = next(iter(truths.items()))
    header = first_text.splitlines()[0] + "\n"
    artifact = Path(first_path).stem
    return [
        # proposer
        _call(
            "propose_claim",
            text="Every required output is derived from all listed samples.",
            artifact_ids=[artifact],
            null_hypothesis="At least one listed sample is missing from the outputs.",
        ),
        _call(
            "propose_claim",
            text="The first pass of the outputs is complete.",
            artifact_ids=[artifact],
            null_hypothesis="At least one output is incomplete after the first pass.",
        ),
        _done("planned"),
        # experimenter: first pass is wrong (header only)
        _call("bash_session", action="type_submit", input="ls /data"),
        _write(first_path, header),
        *correct[1:],
        _done("first pass written"),
        # critic, round 1
        _call(
            "raise_issue",
            severity="blocking",
            artifact_ids=[artifact],
            problem=f"{Path(first_path).name} has a header and no rows.",
            evidence=f"wc -l {first_path} -> 1",
        ),
        _call(
            "record_falsification_test",
            claim_id="C2",
            test_name="row count",
            p_value=0.01,
            contradicts=True,
            note=f"{first_path} has 0 data rows",
        ),
        _done("1 issue raised"),
        # reviser
        correct[0],
        _call(
            "resolve_issue",
            issue_id="I1",
            status="fixed",
            resolution="Reran the counting script; rows present.",
        ),
        _done("fixed"),
        # critic, round 2
        _call(
            "record_falsification_test",
            claim_id="C1",
            test_name="label permutation",
            p_value=0.0004,
            contradicts=False,
            note="scripts/perm.py, 10000 permutations",
        ),
        _done("no issues"),
        # reporter
        methods,
        _done("reported"),
    ]


def load_case(case_dir: Path) -> RuntimeCase:
    first = (case_dir / "cases.jsonl").read_text(encoding="utf-8").splitlines()[0]
    return RuntimeCase.model_validate(json.loads(first))


def run_local(
    case_dir: Path,
    out_dir: Path,
    *,
    solver: str = "glhf",
    model: str = "mock",
    role_models: dict[str, str] | None = None,
    time_limit_seconds: int = 1800,
    review_rounds: int = 3,
) -> dict[str, Any]:
    case_dir, out_dir = case_dir.resolve(), out_dir.resolve()
    case = load_case(case_dir)
    workspace, outputs, data = out_dir / "workspace", out_dir / "outputs", case_dir / "data"
    for directory in (workspace, outputs):
        directory.mkdir(parents=True, exist_ok=True)
    data.mkdir(exist_ok=True)
    os.environ.update(
        BIXBENCH3_INSPECT_SANDBOX_COMPOSE=str(LOCAL_COMPOSE),
        BIXBENCH3_WORKSPACE_DIR=str(workspace),
        BIXBENCH3_OUTPUTS_DIR=str(outputs),
        BIXBENCH3_DATA_DIR=str(data),
    )
    grading_spec = case_dir / "grader" / "artifacts_grading.json"
    if model == "mock":
        if role_models:
            raise ValueError("role models cannot be combined with --model mock")
        truth_dir = grading_spec.parent
        spec = json.loads(grading_spec.read_text(encoding="utf-8"))
        truth_by_id = {
            a["artifact_id"]: (truth_dir / a["ground_truth"]["path"]).read_text()
            for a in spec["artifacts"]
        }
        truths = {o.sandbox_path: truth_by_id[o.artifact_id] for o in case.expected_outputs}
        resolved: Model = get_model(MOCK, custom_outputs=mock_script(solver, truths))
    else:
        resolved = get_model(model)

    started = time.time()
    summary: dict[str, Any] = {
        "task": case.task_id,
        "solver": solver,
        "model": model,
        "role_models": role_models or {},
        "time_limit_seconds": time_limit_seconds,
        "started_at": started,
        "status": "running",
    }
    (out_dir / "run.json").write_text(json.dumps(summary, indent=2))
    task_args = (
        {f"{role}_model": name for role, name in (role_models or {}).items()}
        if solver == "glhf"
        else {}
    )
    logs = inspect_eval(
        bixbench3_cases(
            dataset_path=str(case_dir),
            case_ids=[case.task_id],
            solver=solver,
            review_rounds=review_rounds,
            time_limit_seconds=time_limit_seconds,
            **task_args,
        ),
        model=resolved,
        log_dir=str(out_dir / "logs"),
        display="none",
    )
    log = logs[0]
    result = grade(grading_spec, outputs)
    (out_dir / "grade.json").write_text(json.dumps(result, indent=2, default=str))
    usage = {
        name: {
            "input_tokens": u.input_tokens,
            "output_tokens": u.output_tokens,
            "total_tokens": u.total_tokens,
        }
        for name, u in (log.stats.model_usage or {}).items()
    }
    summary.update(
        status="done" if log.status == "success" else "failed",
        error=str(log.error.message) if log.error else None,
        finished_at=time.time(),
        seconds=round(time.time() - started, 1),
        score=result["score"],
        artifacts=[
            {"artifact_id": a["artifact_id"], "score": a["score"]} for a in result["artifacts"]
        ],
        usage=usage,
        messages=len(log.samples[0].messages) if log.samples else 0,
    )
    (out_dir / "run.json").write_text(json.dumps(summary, indent=2))
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--case",
        type=Path,
        required=True,
        help="case directory (cases.jsonl, prompt.md, data/, grader/)",
    )
    parser.add_argument("--out", type=Path, required=True, help="run directory to create")
    parser.add_argument("--solver", choices=("single", "glhf"), default="glhf")
    parser.add_argument("--model", default="mock", help="'mock' or an Inspect provider/model id")
    parser.add_argument("--role-model", action="append", default=[], metavar="ROLE=MODEL")
    parser.add_argument("--time-limit", type=int, default=1800, help="seconds for the whole run")
    parser.add_argument("--review-rounds", type=int, default=3)
    arguments = parser.parse_args()
    role_models: dict[str, str] = {}
    for item in arguments.role_model:
        role, sep, name = item.partition("=")
        if not sep or role not in ROLES:
            parser.error(f"--role-model expects ROLE=MODEL with ROLE in {ROLES}; got {item!r}")
        role_models[role] = name
    summary = run_local(
        arguments.case,
        arguments.out,
        solver=arguments.solver,
        model=arguments.model,
        role_models=role_models,
        time_limit_seconds=arguments.time_limit,
        review_rounds=arguments.review_rounds,
    )
    print(json.dumps(summary, indent=2))
    return 0 if summary["status"] == "done" else 1


if __name__ == "__main__":
    raise SystemExit(main())
