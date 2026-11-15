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


def get_answers(name: str, public: list[PublicQuestion], key: dict[str, KeyEntry]) -> dict[str, str]:
    if name == "oracle":
        return answer_oracle(public, key)
    if name == "always-a":
        return answer_always_a(public)
    if name == "random":
        return answer_random(public)
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

    answers = get_answers(args.answerer, public, key)

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
                   choices=["oracle", "always-a", "random", "swarm"],
                   help="oracle/always-a/random test the pipeline; swarm is your real solver")
    p.add_argument("--show", type=int, default=3, help="print this many graded examples")
    asyncio.run(main_async(p.parse_args()))


if __name__ == "__main__":
    main()
