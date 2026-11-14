"""The integrity boundary, part 2: what crosses into the task, the prompt and the sandbox
configuration. (Part 1 is test_staging.py; the end-to-end check with a real container is
test_e2e.py.)"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml
from conftest import SENTINELS, Synthetic
from pydantic import ValidationError

from bixbench_v1 import roles, staging
from bixbench_v1.dataset import (
    REFUSAL_OPTION,
    SECRET_FIELDS,
    PublicQuestion,
    public_view,
)
from bixbench_v1.runner import check_prompt
from bixbench_v1.task import COMPOSE, bixbench_v1

LEAKY = [v for k, v in SENTINELS.items() if k != "notebook"]


def test_public_question_has_no_secret_field_and_refuses_extras(synthetic: Synthetic) -> None:
    assert set(PublicQuestion.model_fields) == {"question_id", "question", "options"}
    assert not set(PublicQuestion.model_fields) & set(SECRET_FIELDS)
    row = synthetic.capsule.questions[0].model_dump()
    with pytest.raises(ValidationError):
        PublicQuestion.model_validate(row)  # a full row cannot be passed through
    with pytest.raises(ValidationError):
        PublicQuestion(question_id="q", question="?", ideal="4")  # type: ignore[call-arg]


def test_open_mode_view_and_prompt_carry_no_secret(synthetic: Synthetic) -> None:
    public, key = public_view(synthetic.capsule.questions, "open")
    dumped = json.dumps([q.model_dump() for q in public])
    prompt = roles.brief(public)
    for secret in LEAKY:
        assert secret not in dumped and secret not in prompt
    assert all(q.options is None for q in public)
    assert [q.question_id for q in public] == list(key)
    assert key["syn-1-q3"].ideal == SENTINELS["ideal"]  # the key, and only the key, has it
    check_prompt(prompt, synthetic.capsule, "open")


def test_the_task_and_its_sample_carry_no_secret(synthetic: Synthetic) -> None:
    public, _ = public_view(synthetic.capsule.questions, "open")
    task = bixbench_v1(questions=[q.model_dump() for q in public], sample_id="syn", solver="glhf")
    sample = next(iter(task.dataset))
    assert sample.target == "" and task.scorer is None
    everything = json.dumps([str(sample.input), sample.metadata, task.metadata], default=str)
    for secret in LEAKY:
        assert secret not in everything
    # A row with an extra field is refused at the task boundary too.
    with pytest.raises(ValidationError):
        bixbench_v1(questions=[synthetic.capsule.questions[0].model_dump()], sample_id="syn")


def test_multiple_choice_shows_options_but_not_which_is_right(synthetic: Synthetic) -> None:
    public, key = public_view(synthetic.capsule.questions, "mcq-refusal", seed=3)
    again, key_again = public_view(synthetic.capsule.questions, "mcq-refusal", seed=3)
    assert public == again and key == key_again  # seeded: a rerun gives the same letters
    for q in public:
        entry = key[q.question_id]
        assert q.options is not None and len(q.options) == 5
        assert q.options[ord(str(entry.correct_letter)) - 65] == entry.ideal
        assert q.options[ord(str(entry.refusal_letter)) - 65] == REFUSAL_OPTION
    no_refusal, key_plain = public_view(synthetic.capsule.questions, "mcq")
    assert all(len(q.options or []) == 4 for q in no_refusal)
    assert all(entry.refusal_letter is None for entry in key_plain.values())
    prompt = roles.brief(public)
    for name in ("hypothesis", "result", "paper", "categories", "canary"):
        assert SENTINELS[name] not in prompt
    # Options appear as bare lettered lines; nothing marks one of them.
    option_lines = [line for line in prompt.splitlines() if line[1:3] == ". "]
    assert sorted(option_lines) == sorted(
        f"{chr(65 + i)}. {option}" for q in public for i, option in enumerate(q.options or [])
    )
    check_prompt(prompt, synthetic.capsule, "mcq-refusal")
    # Letters differ between questions or seeds, so position gives nothing away.
    letters = {
        key[q.question_id].correct_letter
        for seed in range(8)
        for q, key in [
            (q, public_view(synthetic.capsule.questions, "mcq", seed)[1])
            for q in synthetic.capsule.questions
        ]
    }
    assert len(letters) > 1


def test_a_prompt_with_a_secret_is_refused(synthetic: Synthetic) -> None:
    public, _ = public_view(synthetic.capsule.questions, "open")
    for name in ("hypothesis", "result", "paper", "canary", "ideal"):
        with pytest.raises(staging.IntegrityError):
            check_prompt(roles.brief(public) + SENTINELS[name], synthetic.capsule, "open")


def test_sandbox_has_no_network_and_mounts_only_data_and_outputs() -> None:
    compose = yaml.safe_load(Path(COMPOSE).read_text())
    assert list(compose["services"]) == ["default"]
    service = compose["services"]["default"]
    assert service["network_mode"] == "none"
    assert "networks" not in service and "ports" not in service and "environment" not in service
    mounts = [str(v) for v in service["volumes"]]
    assert len(mounts) == 2
    assert mounts[0].endswith(":/data:ro") and "BIXBENCH_V1_DATA_DIR" in mounts[0]
    assert mounts[1].endswith(":/outputs") and "BIXBENCH_V1_OUTPUTS_DIR" in mounts[1]
    assert not service.get("privileged") and "cap_add" not in service
