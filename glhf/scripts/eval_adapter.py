#!/usr/bin/env python3
"""Run the agent swarm against a generic science-QA dataset (SciQ, LAB-Bench, GPQA).

This reuses the BixBench v1.5 machinery instead of reinventing it:
  * each dataset row is mapped to a `Question` (bixbench_v1.dataset.Question);
  * `public_view(...)` splits it into what the solver sees (`PublicQuestion`: question +
    shuffled options) and the host-only grading key (`KeyEntry`: the correct letter);
  * the solver answers one letter per question;
  * `grade_answers(..., answer_mode="mcq")` does the letter match. MCQ needs no LLM judge.

So the integrity boundary is identical to a real BixBench run: the correct answer never
reaches the solver, only the shuffled options do.

Prereqs:
  python glhf/scripts/fetch_eval_data.py sciq         # downloads to glhf/data/sciq/
  pip install "datasets>=2.19" pydantic

Demo (no API keys, no Docker — proves the pipeline end to end):
  python glhf/scripts/eval_adapter.py sciq --limit 20 --answerer oracle
  python glhf/scripts/eval_adapter.py sciq --limit 20 --answerer always-a

Real run: implement `swarm_answers(...)` to call your swarm and pass --answerer swarm.
"""

from __future__ import annotations

import argparse
import asyncio
import random
import sys
from pathlib import Path

# Make bixbench_v1 importable without installing it (src layout).
SRC = Path(__file__).resolve().parents[1] / "bixbench_v1" / "src"
sys.path.insert(0, str(SRC))
# bixbench_v1.paid uses the shared switch in bixbench3.paid.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "bixbench" / "src"))

from bixbench_v1.dataset import (  # noqa: E402
    KeyEntry,
    PublicQuestion,
    Question,
    new_shuffle_salt,
    public_view,
)
from bixbench_v1.grading import grade_answers  # noqa: E402

DATA_ROOT = Path(__file__).resolve().parents[1] / "data"


# --- dataset row -> Question -------------------------------------------------
# Each mapper returns (question_text, ideal_answer, [distractors]) for one row.
# Add a dataset by writing one mapper and registering it in MAPPERS.

def _map_sciq(row: dict) -> tuple[str, str, list[str]]:
    return (
        row["question"],
        row["correct_answer"],
        [row["distractor1"], row["distractor2"], row["distractor3"]],
    )


def _map_gpqa(row: dict) -> tuple[str, str, list[str]]:
    return (
        row["Question"],
        row["Correct Answer"],
        [row["Incorrect Answer 1"], row["Incorrect Answer 2"], row["Incorrect Answer 3"]],
    )


def _map_labbench(row: dict) -> tuple[str, str, list[str]]:
    # LAB-Bench MCQ configs (LitQA2, SeqQA, ...) expose `ideal` + `distractors` (a list).
    return (row["question"], row["ideal"], list(row["distractors"]))


MAPPERS = {"sciq": _map_sciq, "gpqa": _map_gpqa, "lab-bench": _map_labbench}


def to_questions(dataset_key: str, rows: list[dict]) -> list[Question]:
    mapper = MAPPERS[dataset_key]
    out: list[Question] = []
    for i, row in enumerate(rows):
        question, ideal, distractors = mapper(row)
        qid = f"{dataset_key}-{i:05d}"
        out.append(
            Question(
                id=qid,
                question_id=qid,
                short_id=dataset_key,
                capsule_uuid=qid,          # no capsule here; a unique value is enough
                data_folder="",            # no staged data for pure QA
                question=str(question),
                eval_mode="llm_verifier",  # unused for mcq; grade_mcq does letter match
                ideal=str(ideal),
                distractors=[str(d) for d in distractors],
            )
        )
    return out


# --- answerers ---------------------------------------------------------------
# A solver sees only PublicQuestion (question + shuffled options) and returns a letter.

def answer_always_a(public: list[PublicQuestion]) -> dict[str, str]:
    return {q.question_id: "A" for q in public}


def answer_oracle(public: list[PublicQuestion], key: dict[str, KeyEntry]) -> dict[str, str]:
    """Picks the correct letter from the key — only to prove grading works. Not a real solver."""
    return {q.question_id: key[q.question_id].correct_letter or "A" for q in public}


def answer_random(public: list[PublicQuestion]) -> dict[str, str]:
    rng = random.Random(0)
    return {q.question_id: chr(65 + rng.randrange(len(q.options or ["A"]))) for q in public}


def swarm_answers(public: list[PublicQuestion]) -> dict[str, str]:
    """HOOK: run your real swarm here.

    Give each PublicQuestion to the swarm (same prompt the runner builds via
    roles.brief([q])), have it return a single option letter, and collect:
        {q.question_id: "<letter>"}
    The key is NOT available to this function, by design. Example sketch:

        from bixbench_v1 import roles
        answers = {}
        for q in public:
            prompt = roles.brief([q])          # question + lettered options
            letter = your_swarm.solve(prompt)  # -> "A".."D"
            answers[q.question_id] = letter
        return answers
    """
    raise NotImplementedError(
        "Wire your swarm into swarm_answers(). Use --answerer oracle/always-a/random to test."
    )


def _load_dotenv() -> None:
    """Load KEY=value lines from a .env at the repo root, if present (does not overwrite)."""
    import os

    env = Path(__file__).resolve().parents[2] / ".env"
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def answer_claude(public: list[PublicQuestion], model: str) -> dict[str, str]:
    """Answer each MCQ with Claude directly (one letter per question). Needs ANTHROPIC_API_KEY.

    This is the lightweight "test with our model" path: a single Claude call per question,
    not the full Docker/Modal swarm. Uses the Anthropic REST API over urllib (no SDK).
    """
    from bixbench_v1.paid import _paid

    # Paid call: refused unless NO_PAID_CALLS=0 (AGENTS.md). Check before any key or client.
    _paid.refuse_paid(f"the claude answerer ({model})")
    import json
    import os
    import re
    import urllib.request

    _load_dotenv()
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise SystemExit(
            "ANTHROPIC_API_KEY not set. Put it in a .env file at the repo root:\n"
            "  ANTHROPIC_API_KEY=sk-ant-...\n"
            "or run: export ANTHROPIC_API_KEY=sk-ant-..."
        )
    answers: dict[str, str] = {}
    for i, q in enumerate(public, 1):
        opts = "\n".join(f"{chr(65 + j)}. {o}" for j, o in enumerate(q.options or []))
        prompt = (
            f"Answer this multiple-choice science question. Reply with ONLY the letter.\n\n"
            f"{q.question}\n\n{opts}\n\nAnswer (one letter):"
        )
        body = json.dumps({
            "model": model,
            "max_tokens": 8,
            "messages": [{"role": "user", "content": prompt}],
        }).encode()
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages", data=body,
            headers={"x-api-key": api_key, "anthropic-version": "2023-06-01",
                     "content-type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                out = json.loads(resp.read())
            text = "".join(b.get("text", "") for b in out.get("content", []))
            m = re.search(r"[A-Z]", text.upper())
            answers[q.question_id] = m.group(0) if m else ""
        except Exception as e:
            print(f"  q{i}: call failed ({e}); left blank")
            answers[q.question_id] = ""
        print(f"  {i}/{len(public)} answered", end="\r")
    print()
    return answers


def answer_openai(public: list[PublicQuestion], model: str) -> dict[str, str]:
    """Answer each MCQ with an OpenAI model (one letter per question). Needs OPENAI_API_KEY."""
    from bixbench_v1.paid import _paid

    # Paid call: refused unless NO_PAID_CALLS=0 (AGENTS.md). Check before any key or client.
    _paid.refuse_paid(f"the openai answerer ({model})")
    import json
    import os
    import re
    import urllib.request

    _load_dotenv()
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise SystemExit(
            "OPENAI_API_KEY not set. Put it in a .env file at the repo root:\n"
            "  OPENAI_API_KEY=sk-...\n"
            "or run: export OPENAI_API_KEY=sk-..."
        )
    answers: dict[str, str] = {}
    for i, q in enumerate(public, 1):
        opts = "\n".join(f"{chr(65 + j)}. {o}" for j, o in enumerate(q.options or []))
        prompt = (
            f"Answer this multiple-choice science question. Reply with ONLY the letter.\n\n"
            f"{q.question}\n\n{opts}\n\nAnswer (one letter):"
        )
        body = json.dumps({
            "model": model,
            "max_tokens": 8,
            "messages": [{"role": "user", "content": prompt}],
        }).encode()
        req = urllib.request.Request(
            "https://api.openai.com/v1/chat/completions", data=body,
            headers={"authorization": f"Bearer {api_key}", "content-type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                out = json.loads(resp.read())
            text = out["choices"][0]["message"]["content"]
            m = re.search(r"[A-Z]", text.upper())
            answers[q.question_id] = m.group(0) if m else ""
        except Exception as e:
            print(f"  q{i}: call failed ({e}); left blank")
            answers[q.question_id] = ""
        print(f"  {i}/{len(public)} answered", end="\r")
    print()
    return answers


# Default model per provider when --model is not given.
DEFAULT_MODELS = {"claude": "claude-3-5-sonnet-20241022", "openai": "gpt-4o-mini"}


def get_answers(name: str, public: list[PublicQuestion], key: dict[str, KeyEntry],
                model: str) -> dict[str, str]:
    if name == "oracle":
        return answer_oracle(public, key)
    if name == "always-a":
        return answer_always_a(public)
    if name == "random":
        return answer_random(public)
    if name == "claude":
        return answer_claude(public, model or DEFAULT_MODELS["claude"])
    if name == "openai":
        return answer_openai(public, model or DEFAULT_MODELS["openai"])
    if name == "swarm":
        return swarm_answers(public)
    raise SystemExit(f"unknown answerer {name!r}")


# --- run ---------------------------------------------------------------------

def load_rows(dataset_key: str, limit: int) -> list[dict]:
    from datasets import load_from_disk

    path = DATA_ROOT / dataset_key / "hf_dataset"
    if not path.exists():
        raise SystemExit(
            f"{path} not found. Run: python glhf/scripts/fetch_eval_data.py {dataset_key}"
        )
    data = load_from_disk(str(path))
    split = "train" if "train" in data else next(iter(data))
    ds = data[split]
    n = min(limit, len(ds)) if limit > 0 else len(ds)
    return [dict(ds[i]) for i in range(n)]


async def main_async(args: argparse.Namespace) -> None:
    rows = load_rows(args.dataset, args.limit)
    questions = to_questions(args.dataset, rows)

    # Same split the real runner uses. MCQ options are shuffled with a host-only salt.
    public, key = public_view(questions, answer_mode="mcq", seed=0, salt=new_shuffle_salt())

    answers = get_answers(args.answerer, public, key, args.model)

    # No judge needed: mcq grading is a deterministic letter match.
    grades = await grade_answers(key, answers, answer_mode="mcq", judge=None, profile="per-mode")

    correct = sum(g.correct for g in grades)
    total = len(grades)
    print(f"dataset={args.dataset}  answerer={args.answerer}  n={total}")
    print(f"score: {correct}/{total} = {correct / total:.1%}")
    # Show a few so you can eyeball what the solver saw vs. what was right.
    by_id = {q.question_id: q for q in public}
    for g in grades[: args.show]:
        q = by_id[g.question_id]
        print(f"\nQ: {q.question[:90]}")
        print(f"   options: {q.options}")
        print(f"   picked {g.predicted!r}  correct_letter={key[g.question_id].correct_letter}"
              f"  -> {'OK' if g.correct else 'wrong'}")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("dataset", choices=sorted(MAPPERS), help="which downloaded dataset")
    p.add_argument("--limit", type=int, default=20, help="max questions (0 = all)")
    p.add_argument("--answerer", default="oracle",
                   choices=["oracle", "always-a", "random", "claude", "openai", "swarm"],
                   help="oracle/always-a/random test the pipeline; claude/openai=your model; swarm=full solver")
    p.add_argument("--model", default="",
                   help="model id (default: claude-3-5-sonnet for claude, gpt-4o-mini for openai)")
    p.add_argument("--show", type=int, default=3, help="print this many graded examples")
    asyncio.run(main_async(p.parse_args()))


if __name__ == "__main__":
    main()
