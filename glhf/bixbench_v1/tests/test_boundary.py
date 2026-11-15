"""The integrity boundary, part 2: what crosses into the task, the prompt and the sandbox
configuration. (Part 1 is test_staging.py; the end-to-end check with a real container is
test_e2e.py.)"""

from __future__ import annotations

import json
import os
import random
from pathlib import Path

import pytest
import yaml
from conftest import SENTINELS, UUID, Synthetic
from pydantic import ValidationError

from bixbench_v1 import roles, runner, staging
from bixbench_v1.dataset import (
    REFUSAL_OPTION,
    SECRET_FIELDS,
    PublicQuestion,
    Question,
    new_shuffle_salt,
    public_view,
)
from bixbench_v1.runner import check_prompt, key_for, neutral_mount, read_salt, write_salt
from bixbench_v1.task import bixbench_v1, compose_config, write_compose

SALT = "a-salt-for-tests"

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
    public, key = public_view(synthetic.capsule.questions, "mcq-refusal", seed=3, salt=SALT)
    again, key_again = public_view(synthetic.capsule.questions, "mcq-refusal", 3, SALT)
    assert public == again and key == key_again  # same salt: grading rebuilds the same letters
    for q in public:
        entry = key[q.question_id]
        assert q.options is not None and len(q.options) == 5
        assert q.options[ord(str(entry.correct_letter)) - 65] == entry.ideal
        assert q.options[ord(str(entry.refusal_letter)) - 65] == REFUSAL_OPTION
    no_refusal, key_plain = public_view(synthetic.capsule.questions, "mcq", salt=SALT)
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
            (q, public_view(synthetic.capsule.questions, "mcq", seed, SALT)[1])
            for q in synthetic.capsule.questions
        ]
    }
    assert len(letters) > 1


def test_a_prompt_with_a_secret_is_refused(synthetic: Synthetic) -> None:
    public, _ = public_view(synthetic.capsule.questions, "open")
    for name in ("hypothesis", "result", "paper", "canary", "ideal"):
        with pytest.raises(staging.IntegrityError):
            check_prompt(roles.brief(public) + SENTINELS[name], synthetic.capsule, "open")


def _many_questions(count: int = 200) -> list[Question]:
    return [
        Question(
            id=str(i),
            question_id=f"syn-{i // 5}-q{i % 5}",
            short_id=f"syn-{i // 5}",
            capsule_uuid=UUID,
            data_folder="x.zip",
            question="?",
            eval_mode="str_verifier",
            ideal=f"right {i}",
            distractors=[f"wrong {i} {k}" for k in range(3)],
        )
        for i in range(count)
    ]


def _predicted_without_reading_options(seed: int, question_id: str, count: int) -> str:
    """The red-team's attack: the ideal enters the shuffle in slot 0, so with a generator keyed
    by seed and question id alone, shuffling the positions tells where it lands."""
    positions = list(range(count))
    random.Random(f"{seed}:{question_id}").shuffle(positions)
    return chr(65 + positions.index(0))


def test_the_correct_letter_cannot_be_computed_from_seed_id_and_option_count() -> None:
    questions = _many_questions()
    for mode, count in (("mcq", 4), ("mcq-refusal", 5)):
        _, key = public_view(questions, mode, seed=0, salt=new_shuffle_salt())  # type: ignore[arg-type]
        hits = sum(
            _predicted_without_reading_options(0, q.question_id, count)
            == key[q.question_id].correct_letter
            for q in questions
        )
        # 200/200 with the unsalted shuffle. Chance is 1 in `count`; 0.5 is far above chance.
        assert hits / len(questions) < 0.5, (mode, hits)
        assert {entry.correct_letter for entry in key.values()} == {
            chr(65 + i) for i in range(count)
        }
    # A second run has its own salt, so the same seed and ids give other letters.
    first = public_view(questions, "mcq", 0, new_shuffle_salt())[1]
    second = public_view(questions, "mcq", 0, new_shuffle_salt())[1]
    differing = sum(first[q].correct_letter != second[q].correct_letter for q in first)
    assert differing > len(questions) / 2
    # Without a salt there is no multiple-choice view at all (open mode needs none).
    for mode in ("mcq", "mcq-refusal"):
        with pytest.raises(ValueError, match="salt"):
            public_view(questions, mode)  # type: ignore[arg-type]
    assert public_view(questions, "open")[0][0].options is None


def test_the_salt_is_made_per_run_and_kept_only_in_the_run_folder(
    synthetic: Synthetic, tmp_path: Path
) -> None:
    out_a, out_b = tmp_path / "a", tmp_path / "b"
    out_a.mkdir()
    out_b.mkdir()
    salt_a, salt_b = write_salt(out_a), write_salt(out_b)
    assert salt_a != salt_b and len(salt_a) >= 32
    assert read_salt(out_a) == salt_a and read_salt(tmp_path) is None
    assert (out_a / runner.SALT_FILE).stat().st_mode & 0o077 == 0  # owner only
    assert salt_a not in "\x00".join(os.environ.values())
    # Grading rebuilds exactly the key the run was given, from the folder's salt...
    questions = synthetic.capsule.questions
    public, key = public_view(questions, "mcq", 0, salt_a)
    run = {"question_ids": [q.question_id for q in questions]}
    run["settings"] = {"answer_mode": "mcq", "seed": 0}  # type: ignore[assignment]
    assert key_for(synthetic.capsule, run, out_a) == key
    # ...the salt is in nothing the solver is given...
    task = bixbench_v1(questions=[q.model_dump() for q in public], sample_id="syn")
    sample = next(iter(task.dataset))
    assert salt_a not in json.dumps([str(sample.input), sample.metadata, task.metadata])
    assert salt_a not in roles.brief(public)
    # ...and a run folder without one cannot be keyed for multiple choice.
    with pytest.raises(ValueError, match="salt"):
        key_for(synthetic.capsule, run, tmp_path)


def test_sandbox_has_no_network_and_mounts_only_data_and_outputs(tmp_path: Path) -> None:
    written = write_compose(tmp_path / "compose.yaml", "img:1", tmp_path / "d", tmp_path / "o")
    compose = yaml.safe_load(written.read_text())
    assert compose == compose_config("img:1", tmp_path / "d", tmp_path / "o")
    assert list(compose["services"]) == ["default"]
    service = compose["services"]["default"]
    assert service["network_mode"] == "none" and service["image"] == "img:1"
    assert "networks" not in service and "ports" not in service and "environment" not in service
    assert service["volumes"] == [
        {"type": "bind", "source": str(tmp_path / "d"), "target": "/data", "read_only": True},
        {"type": "bind", "source": str(tmp_path / "o"), "target": "/outputs"},
    ]
    assert not service.get("privileged") and "cap_add" not in service


def test_mount_paths_are_per_run_values_not_environment_variables(tmp_path: Path) -> None:
    # Two runs prepared side by side: each compose file holds its own paths, literally. Before,
    # both read ${BIXBENCH_V1_DATA_DIR} from the one process environment, so the second run's
    # paths replaced the first's.
    one = write_compose(tmp_path / "one.yaml", "img", tmp_path / "data1", tmp_path / "out1")
    two = write_compose(tmp_path / "two.yaml", "img", tmp_path / "data2", tmp_path / "out2")
    assert str(tmp_path / "data1") in one.read_text() and "data2" not in one.read_text()
    assert str(tmp_path / "data2") in two.read_text() and "data1" not in two.read_text()
    for text in (one.read_text(), two.read_text()):
        assert "${" not in text and "BIXBENCH_V1" not in text
    source = (
        Path(runner.__file__).read_text(),
        Path(runner.__file__).with_name("task.py").read_text(),
    )
    assert all("os.environ.update" not in text for text in source)
    assert "_DATA_DIR" not in "".join(source) and "_OUTPUTS_DIR" not in "".join(source)
    assert (
        bixbench_v1(questions=[{"question_id": "q", "question": "?"}], sample_id="s").sandbox
        is None
    )


def test_the_mounted_host_paths_name_no_capsule_run_model_or_solver(
    synthetic: Synthetic, tmp_path: Path
) -> None:
    staged = synthetic.staged / UUID
    data = staging.stage_capsule(synthetic.zip_path, staged)
    manifest = staging.verify_staged(staged)
    mount = neutral_mount(synthetic.staged, data, manifest)
    other = neutral_mount(synthetic.staged, data, manifest)
    assert mount != other and mount.parent == synthetic.staged.resolve().parent / "mounts"
    for word in (UUID, "CapsuleData", "single", "glhf", "claude", "outputs/.."):
        assert word not in str(mount.relative_to(tmp_path.resolve()))
    files = {
        p.relative_to(mount / "data").as_posix() for p in (mount / "data").rglob("*") if p.is_file()
    }
    assert files == manifest.paths and (mount / "outputs").is_dir()
    assert (mount / "data" / "counts.csv").read_bytes() == (data / "counts.csv").read_bytes()
    assert not (mount / "manifest.json").exists()
