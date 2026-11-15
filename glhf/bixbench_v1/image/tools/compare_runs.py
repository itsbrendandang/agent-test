"""Compare two `bixbench-v1 run --model mock` folders made with the same command, one with
local Docker and one with `--sandbox modal`: the same steps, the same files, the same tool
outputs? Writes a JSON report. No model is involved: the scripted model plays a fixed script, so
any difference comes from the sandbox.

    uv run python image/tools/compare_runs.py runs/modal-proof/docker runs/modal-proof/modal \
        image/mock-equivalence.json
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

from inspect_ai.log import read_eval_log

# What may differ between two sandboxes without the mechanics differing: the machine's name in
# a shell prompt, and clock times.
HOST = re.compile(r"@[A-Za-z0-9_.-]+:")


def steps(run_dir: Path) -> list[dict[str, Any]]:
    """The run as a list of steps: every tool call (name and arguments) and every tool output."""
    log = read_eval_log(str(next((run_dir / "logs").glob("*.eval"))))
    assert log.samples
    out: list[dict[str, Any]] = []
    for message in log.samples[0].messages:
        if message.role == "assistant":
            for call in message.tool_calls or []:
                out.append({"call": call.function, "arguments": call.arguments})
        elif message.role == "tool":
            out.append({"output": HOST.sub("@HOST:", str(message.content))})
    return out


def files(run_dir: Path) -> dict[str, int]:
    root = run_dir / "outputs"
    return {
        p.relative_to(root).as_posix(): p.stat().st_size
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


def compare(docker: Path, modal: Path) -> dict[str, Any]:
    a, b = (json.loads((d / "run.json").read_text()) for d in (docker, modal))
    sa, sb = steps(docker), steps(modal)
    fa, fb = files(docker), files(modal)
    phases = lambda run: [(p["kind"], p.get("phase")) for p in run["phases"]]  # noqa: E731
    answers = lambda d: json.loads((d / "outputs" / "answers.json").read_text())["answers"]  # noqa: E731
    differing_steps = [
        {"step": i, "docker": x, "modal": y}
        for i, (x, y) in enumerate(zip(sa, sb, strict=False))
        if x != y
    ]
    result = {
        "status": [a["status"], b["status"]],
        "same_status": a["status"] == b["status"] == "done",
        "same_answer_statuses": a["answer_statuses"] == b["answer_statuses"],
        "same_phases": phases(a) == phases(b),
        "phases": phases(b),
        "same_question_records": a.get("questions") == b.get("questions"),
        "blind_check": [a.get("blind_check"), b.get("blind_check")],
        "steps": [len(sa), len(sb)],
        "same_tool_calls": [s for s in sa if "call" in s] == [s for s in sb if "call" in s],
        "same_tool_outputs": [s for s in sa if "output" in s] == [s for s in sb if "output" in s],
        "differing_steps": differing_steps[:10],
        "files": [len(fa), len(fb)],
        "same_file_names": sorted(fa) == sorted(fb),
        "only_docker": sorted(set(fa) - set(fb)),
        "only_modal": sorted(set(fb) - set(fa)),
        "same_answers_json": answers(docker) == answers(modal),
        "messages": [a["messages"], b["messages"]],
        "total_tokens": [a["total_tokens"], b["total_tokens"]],
        "seconds": [a["seconds"], b["seconds"]],
        "sandbox": [a["settings"].get("sandbox"), b["settings"].get("sandbox")],
        "image": [a["settings"]["image"], b["settings"]["image"]],
        "modal_sandboxes": b["settings"].get("modal", {}).get("sandboxes"),
        "modal_sandbox_seconds": b["settings"].get("modal", {}).get("sandbox_seconds"),
        "modal_sandbox_usd": b["settings"].get("modal", {}).get("sandbox_usd"),
    }
    result["same_mechanics"] = all(
        result[k]
        for k in ("same_status", "same_answer_statuses", "same_phases", "same_question_records",
                  "same_tool_calls", "same_tool_outputs", "same_file_names", "same_answers_json")
    )  # fmt: skip
    return result


def main() -> int:
    docker, modal, target = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    report: dict[str, Any] = {
        "docker": str(docker),
        "modal": str(modal),
        "model": "mock (scripted)",
        "runs": {},
    }
    for run_file in sorted(docker.glob("*/*/run.json")):
        key = run_file.parent.relative_to(docker).as_posix()
        if not (modal / key / "run.json").exists():
            report["runs"][key] = {"same_mechanics": False, "missing_on_modal": True}
            continue
        report["runs"][key] = compare(run_file.parent, modal / key)
    report["all_same_mechanics"] = all(r["same_mechanics"] for r in report["runs"].values())
    target.write_text(json.dumps(report, indent=1) + "\n")
    for key, run in report["runs"].items():
        print(
            f"{key:28} same mechanics: {run['same_mechanics']}  steps {run.get('steps')} files {run.get('files')} "
            f"tokens {run.get('total_tokens')} seconds {run.get('seconds')} modal USD {run.get('modal_sandbox_usd')}"
        )
        for diff in run.get("differing_steps", [])[:3]:
            print("   differs:", json.dumps(diff)[:600])
    print("ALL SAME:", report["all_same_mechanics"])
    return 0 if report["all_same_mechanics"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
