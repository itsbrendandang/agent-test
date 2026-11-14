"""The BixBench v1.5 question file, split into what the solver may see and what it may not.

`Question` is a full row of BixBench.jsonl and never leaves the runner process. The only thing
that crosses into the Inspect task, the prompt and the sandbox is `PublicQuestion`: an id, the
question text and, in the multiple-choice modes, the shuffled options. `PublicQuestion` forbids
extra fields, so a row cannot be passed through by accident.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import random
import secrets
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator

HF_REPO = "futurehouse/BixBench"
# Dataset revision this adapter was written against (tag v1.5 / main on 2025-10-01).
HF_REVISION = "f8cc3bdcc6357c88b8c3648306522b9c422dc95a"
QUESTION_FILE = "BixBench.jsonl"

EvalMode = Literal["str_verifier", "range_verifier", "llm_verifier"]
AnswerMode = Literal["open", "mcq", "mcq-refusal"]
ANSWER_MODES: tuple[AnswerMode, ...] = ("open", "mcq", "mcq-refusal")
# The official refusal option (bixbench/postprocessing_utils.py, questions_to_mcq).
REFUSAL_OPTION = "Insufficient information to answer the question"
# Fields of a row the solver must never see. `ideal` and `distractors` appear as unlabelled,
# shuffled options in the multiple-choice modes only; which option is right stays in the key.
SECRET_FIELDS = (
    "ideal",
    "distractors",
    "hypothesis",
    "result",
    "answer",
    "paper",
    "categories",
    "canary",
)


class Question(BaseModel):
    """One row of BixBench.jsonl. Host only."""

    model_config = ConfigDict(extra="ignore", frozen=True)

    id: str
    question_id: str
    short_id: str
    capsule_uuid: str
    data_folder: str
    question: str
    eval_mode: EvalMode
    ideal: str
    distractors: list[str] = []
    hypothesis: str = ""
    result: str = ""
    answer: bool | None = None
    paper: str = ""
    categories: str = ""
    canary: str = ""

    @field_validator("ideal", mode="before")
    @classmethod
    def _ideal_as_text(cls, value: object) -> str:
        return str(value)

    def long_secrets(self, min_chars: int = 24) -> list[str]:
        """Secret strings long enough that finding one verbatim in a prompt or a staged file is
        a leak and not a coincidence (a short ideal such as "3" occurs in any table)."""
        candidates = [self.hypothesis, self.result, self.paper, self.canary, self.ideal]
        return [text.strip() for text in candidates if len(text.strip()) >= min_chars]


class PublicQuestion(BaseModel):
    """What a solver is given for one question. Nothing else may be added."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    question_id: str
    question: str
    options: list[str] | None = None  # multiple-choice modes: option i has letter chr(65 + i)


@dataclass(frozen=True)
class KeyEntry:
    """Host-side grading key for one question."""

    question_id: str
    question: str
    eval_mode: EvalMode
    ideal: str
    correct_letter: str | None = None  # multiple-choice modes
    refusal_letter: str | None = None  # mcq-refusal only


@dataclass(frozen=True)
class Capsule:
    uuid: str
    short_id: str
    zip_name: str
    questions: tuple[Question, ...]

    @property
    def key(self) -> str:
        """Unique, readable id. One short id can span several capsules (bix-61 has six)."""
        return f"{self.short_id}_{self.uuid[:8]}"


def load_questions(path: Path) -> list[Question]:
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]
    return [Question.model_validate(row) for row in rows]


def group_capsules(questions: Iterable[Question]) -> list[Capsule]:
    """Capsules in file order, each with its questions in file order."""
    grouped: dict[str, list[Question]] = {}
    for question in questions:
        grouped.setdefault(question.capsule_uuid, []).append(question)
    return [
        Capsule(uuid, rows[0].short_id, rows[0].data_folder, tuple(rows))
        for uuid, rows in grouped.items()
    ]


def find_capsules(capsules: list[Capsule], wanted: list[str]) -> list[Capsule]:
    """Select by short id ("bix-26"), capsule key ("bix-61_2e6ab559") or uuid."""
    picked: list[Capsule] = []
    for name in wanted:
        matches = [c for c in capsules if name in (c.short_id, c.key, c.uuid)]
        if not matches:
            raise KeyError(f"no capsule matches {name!r}")
        picked.extend(m for m in matches if m not in picked)
    return picked


def new_shuffle_salt() -> str:
    """A fresh secret for one run's option shuffle. Host only: it is written to the run folder
    (runner.py) and never to a prompt, the sandbox, the environment or run.json."""
    return secrets.token_hex(32)


def _shuffle_rng(salt: str, seed: int, question_id: str) -> random.Random:
    digest = hmac.new(salt.encode(), f"{seed}:{question_id}".encode(), hashlib.sha256).digest()
    return random.Random(int.from_bytes(digest, "big"))


def public_view(
    questions: Iterable[Question],
    answer_mode: AnswerMode = "open",
    seed: int = 0,
    salt: str | None = None,
) -> tuple[list[PublicQuestion], dict[str, KeyEntry]]:
    """The solver's view of the questions, and the grading key that stays on the host.

    Multiple-choice options are the ideal answer and the distractors (plus the refusal option in
    "mcq-refusal"), shuffled with a generator keyed by `salt`, a secret of this run that only
    the host holds, together with `seed` and the question id. The ideal always enters the
    shuffle in slot 0, so a shuffle keyed by seed and question id alone would let anyone who
    knows them compute the correct letter without reading an option; the salt is what prevents
    that, and it is required in the multiple-choice modes. The same salt gives the same letters
    again, which is how a finished run is graded. The official harness shuffles unseeded."""
    if answer_mode not in ANSWER_MODES:
        raise ValueError(f"unknown answer mode {answer_mode!r}")
    if answer_mode != "open" and not salt:
        raise ValueError(
            "multiple-choice options are shuffled with a host-only salt; none was given "
            "(a run made before the salt existed cannot be re-keyed)"
        )
    public: list[PublicQuestion] = []
    key: dict[str, KeyEntry] = {}
    for q in questions:
        if q.question_id in key:
            raise ValueError(f"duplicate question id {q.question_id}")
        if answer_mode == "open":
            public.append(PublicQuestion(question_id=q.question_id, question=q.question))
            key[q.question_id] = KeyEntry(q.question_id, q.question, q.eval_mode, q.ideal)
            continue
        options = [q.ideal, *q.distractors]
        if answer_mode == "mcq-refusal":
            options.append(REFUSAL_OPTION)
        assert salt is not None
        _shuffle_rng(salt, seed, q.question_id).shuffle(options)
        public.append(
            PublicQuestion(question_id=q.question_id, question=q.question, options=options)
        )
        key[q.question_id] = KeyEntry(
            q.question_id,
            q.question,
            q.eval_mode,
            q.ideal,
            correct_letter=chr(65 + options.index(q.ideal)),
            refusal_letter=chr(65 + options.index(REFUSAL_OPTION))
            if answer_mode == "mcq-refusal"
            else None,
        )
    return public, key


def download(dest: Path, zip_names: list[str] | None = None) -> Path:
    """Fetch BixBench.jsonl and capsule zips (all, or the named ones) at the pinned revision."""
    from huggingface_hub import snapshot_download

    patterns = [QUESTION_FILE, *(zip_names if zip_names is not None else ["*.zip"])]
    snapshot_download(
        repo_id=HF_REPO,
        repo_type="dataset",
        revision=HF_REVISION,
        local_dir=str(dest),
        allow_patterns=patterns,
    )
    return dest
