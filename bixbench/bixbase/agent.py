"""Single-agent baseline: one model, one system prompt, one tool-use loop.

solve(study, budget, ...) is THE interface the swarm will later reimplement.
Everything else (loader, sandbox, budget, logger, grader) stays shared so the
comparison is compute-fair.

Loop contract:
  - model gets run_code / read_file / list_dir / submit_answer
  - loop ends on submit_answer, or is forced to submit on BudgetExhausted
  - a forced submission still goes to the grader; if the model never produces
    answers we submit {} and mark forced_no_answer — never fabricate
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .budget import Budget, BudgetExhausted
from .llm import LLMClient
from .loader import Study
from .logger import RunLogger
from .prompts import FORCED_FINAL_PROMPT, SYSTEM_PROMPT, TASK_PROMPT_TEMPLATE
from .sandbox import Sandbox

TOOL_SCHEMAS = [
    {
        "name": "run_code",
        "description": (
            "Execute Python code in the working directory. The study data is "
            "available read-only via os.environ['DATA_DIR']. Files you write "
            "persist between calls. stdout/stderr are returned."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "code": {"type": "string", "description": "Python source to run"}
            },
            "required": ["code"],
        },
    },
    {
        "name": "list_dir",
        "description": (
            "List a directory. Use '.' for the working dir or 'DATA_DIR' for "
            "the read-only study data."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "default": "."},
            },
        },
    },
    {
        "name": "read_file",
        "description": (
            "Read a file with line numbers. Paths resolve inside WORK_DIR or "
            "DATA_DIR."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "offset": {"type": "integer", "default": 0},
                "limit": {"type": "integer", "default": 200},
            },
            "required": ["path"],
        },
    },
    {
        "name": "submit_answer",
        "description": (
            "Finish the task. `answers` maps each question id to your final "
            "concise answer. Call exactly once, when done."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "answers": {
                    "type": "object",
                    "description": "{question_id: answer_string}",
                    "additionalProperties": {"type": "string"},
                }
            },
            "required": ["answers"],
        },
    },
]


@dataclass
class SolveResult:
    study_id: str
    answers: dict[str, str]
    submitted: bool
    forced: bool  # answers were forced by budget exhaustion
    stop_reason: str
    budget: dict
    run_dir: Path
    transcript: Path
    final_script: Path
    error: str | None = None


def _task_prompt(study: Study) -> str:
    questions_block = "\n".join(
        f"- [{q.question_id}] {q.text}" for q in study.questions
    )
    return TASK_PROMPT_TEMPLATE.format(
        study_id=study.study_id,
        data_description=study.describe() or "",
        questions_block=questions_block,
    )


def _execute_tool(
    name: str,
    tool_input: dict,
    sandbox: Sandbox,
    logger: RunLogger,
) -> tuple[str, dict[str, str] | None]:
    """Run one tool call. Returns (result_text, submitted_answers_or_None)."""
    if name == "run_code":
        code = tool_input.get("code", "")
        if not code.strip():
            return "ERROR: empty code", None
        res = sandbox.run_code(code)
        logger.log_code_cell(code, res)
        return res.tool_result_text(), None
    if name == "list_dir":
        return sandbox.list_dir(tool_input.get("path", ".")), None
    if name == "read_file":
        return (
            sandbox.read_file(
                tool_input["path"],
                offset=int(tool_input.get("offset", 0)),
                limit=int(tool_input.get("limit", 200)),
            ),
            None,
        )
    if name == "submit_answer":
        answers = tool_input.get("answers") or {}
        if isinstance(answers, str):
            try:
                answers = json.loads(answers)
            except json.JSONDecodeError:
                answers = {}
        if not isinstance(answers, dict) or not all(
            isinstance(k, str) for k in answers
        ):
            return (
                "ERROR: answers must be an object {question_id: answer}. "
                "Fix the format and call submit_answer again.",
                None,
            )
        return "submitted", {str(k): str(v) for k, v in answers.items()}
    return f"ERROR: unknown tool {name!r}", None


def _content_blocks(resp_text: str, tool_calls) -> list[dict]:
    blocks: list[dict[str, Any]] = []
    if resp_text:
        blocks.append({"type": "text", "text": resp_text})
    for tc in tool_calls:
        blocks.append(
            {
                "type": "tool_use",
                "id": tc.id,
                "name": tc.name,
                "input": tc.input,
            }
        )
    return blocks


def solve(
    study: Study,
    budget: Budget,
    *,
    llm: LLMClient,
    run_dir: Path,
    sandbox: Sandbox | None = None,
) -> SolveResult:
    """Run the single-agent loop on one study. Shared interface for the swarm."""
    run_dir = Path(run_dir)
    sandbox = sandbox or Sandbox(study.data_dir, run_dir / "work")
    logger = RunLogger(run_dir)
    answers: dict[str, str] = {}
    submitted = False
    forced = False
    stop_reason = "running"
    error = None

    messages: list[dict] = [
        {"role": "user", "content": _task_prompt(study)}
    ]
    logger.log_run_start(
        study_id=study.study_id,
        model=llm.model,
        provider=llm.provider,
        seed=llm.seed,
        questions=[q.question_id for q in study.questions],
    )
    logger.log_message("system", SYSTEM_PROMPT)
    logger.log_message("user", messages[0]["content"])

    try:
        while not submitted:
            try:
                resp = llm.chat(
                    messages, system=SYSTEM_PROMPT, tools=TOOL_SCHEMAS,
                    budget=budget,
                )
            except BudgetExhausted as e:
                # fall through to forced submission below
                stop_reason = f"budget_exhausted:{e.reason}"
                break

            blocks = _content_blocks(resp.text, resp.tool_calls)
            messages.append({"role": "assistant", "content": blocks})
            logger.log_message("assistant", blocks)
            logger.log_budget(budget.snapshot())

            if not resp.tool_calls:
                # model produced text but no tool call; nudge it to continue
                # (or it may have written its answer in text)
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            "Continue: use a tool, or call submit_answer with "
                            "your final answers."
                        ),
                    }
                )
                continue

            results = []
            for tc in resp.tool_calls:
                budget.record_tool_call()
                logger.log_tool_call(tc.name, tc.id, tc.input)
                try:
                    result_text, submitted_answers = _execute_tool(
                        tc.name, tc.input, sandbox, logger
                    )
                except (PermissionError, OSError) as e:
                    result_text, submitted_answers = f"ERROR: {e}", None
                logger.log_tool_result(tc.id, tc.name, result_text)
                results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tc.id,
                        "content": result_text,
                    }
                )
                if submitted_answers is not None:
                    answers = submitted_answers
                    submitted = True
                    stop_reason = "submitted"
            messages.append({"role": "user", "content": results})
    except Exception as e:  # noqa: BLE001 - fail loudly, record error
        error = f"{type(e).__name__}: {e}"
        stop_reason = f"error:{error}"

    # ---- forced final answer on budget exhaustion or error ------------------
    if not submitted:
        forced = True
        reason = stop_reason
        try:
            messages.append(
                {
                    "role": "user",
                    "content": FORCED_FINAL_PROMPT.format(reason=reason),
                }
            )
            resp = llm.chat(
                messages, system=SYSTEM_PROMPT,
                tools=[t for t in TOOL_SCHEMAS if t["name"] == "submit_answer"],
                budget=budget, enforce_budget=False,
            )
            logger.log_message(
                "assistant", _content_blocks(resp.text, resp.tool_calls)
            )
            for tc in resp.tool_calls:
                if tc.name == "submit_answer":
                    _, submitted_answers = _execute_tool(
                        tc.name, tc.input, sandbox, logger
                    )
                    if submitted_answers is not None:
                        answers = submitted_answers
                        submitted = True
            if not answers and len(study.questions) == 1 and resp.text:
                # model answered in prose rather than via the tool — still its
                # own answer, so we grade it rather than marking no_answer
                answers = {study.questions[0].question_id: resp.text.strip()}
                submitted = True
        except Exception as e:  # noqa: BLE001
            error = f"{type(e).__name__}: {e}"

    if not answers:
        # fail loudly: unanswered questions get an explicit marker, not a guess
        answers = {
            q.question_id: "<no_answer>" for q in study.questions
        }
        if not submitted:
            stop_reason += "|no_answer_submitted"

    logger.log_final_answer(answers, forced=forced, reason=stop_reason)
    logger.log_run_end(
        stop_reason=stop_reason,
        submitted=submitted,
        forced=forced,
        error=error,
        budget=budget.snapshot(),
    )
    logger.close()

    return SolveResult(
        study_id=study.study_id,
        answers=answers,
        submitted=submitted,
        forced=forced,
        stop_reason=stop_reason,
        budget=budget.snapshot(),
        run_dir=run_dir,
        transcript=run_dir / "transcript.jsonl",
        final_script=run_dir / "final_script.py",
        error=error,
    )
