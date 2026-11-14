"""Long-term memory of the swarm: process lessons kept between runs.

Three code rules keep memory from carrying a task's inputs or answers into a later run, because a
prompt alone cannot guarantee it:
  1. a lesson line that looks like a result is never saved or injected (`lesson_rejection`);
  2. lessons written by a run on task X are never shown to a later run on task X;
  3. lessons are written before grading, so a score cannot be in one (see solver.py).
The filter is deliberately blunt and will drop some harmless lines. It cannot catch everything:
a gene symbol without a digit, or a result described in words, passes. Read the file now and then.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from pathlib import Path

from .tools import _STUDY_ID

MEMORY_FILE = "lessons.md"
MEMORY_INJECT_CHARS = 6000  # newest lessons that fit; older ones stay on disk
MAX_LESSON_CHARS = 2000  # per run
_HEADER = "## Task "

# Upper-case tokens with a digit that are tools, formats or references, not genes or samples.
_NOT_IDENTIFIERS = frozenset(
    "HISAT2 DESEQ2 MACS2 MACS3 BOWTIE2 BWA-MEM2 BZIP2 BZ2 HDF5 H5AD H5 UTF8 UTF-8 UTF16 MD5 SHA1 "
    "SHA256 CRC32 BASE64 GRCH37 GRCH38 GRCM38 GRCM39 HG19 HG38 MM10 MM39 T2T R1 R2 I1 I2 GFF3 GTF2 "
    "VCF4 LOG2 LOG10 LOG2FC LOG2FOLDCHANGE PHRED33 PHRED64 Q20 Q30 X86 X86-64 ARM64 S3 PY3 PYTHON3 "
    "ISO8601 K8S N2 CPU32 E2E".split()
)
_IDENTIFIER = re.compile(r"\b(?=[A-Z0-9-]*\d)(?=[A-Z0-9-]*[A-Z])[A-Z][A-Z0-9-]{1,11}\b")
_ENSEMBL = re.compile(r"\bENS[A-Z]*\d{6,}", re.IGNORECASE)
_SCORE = re.compile(r"\b(scor(?:e|es|ed|ing)|ground[- ]truth|grader|answer key)\b", re.IGNORECASE)
_NUMBER = re.compile(r"(?<![\w.])\d+(?:\.\d+)*(?![\w]*\.\d)")


def lesson_rejection(line: str) -> str | None:
    """Why a lesson line must not be kept, or None if it reads as a process note."""
    if _SCORE.search(line):
        return "mentions a score, the grader or the answers"
    if _STUDY_ID.search(line):
        return "contains a study or dataset identifier"
    if _ENSEMBL.search(line):
        return "contains a gene or transcript identifier"
    for token in _IDENTIFIER.findall(line):
        if token not in _NOT_IDENTIFIERS:
            return f"contains an identifier that looks like a gene or sample ({token})"
    if re.search(r"\d\s*%", line):
        return "contains a percentage"
    numbers = _NUMBER.findall(line)
    for number in numbers:
        parts = number.split(".")
        # Two or more dots is a version (2.7.10). Otherwise a long integer or a precise decimal
        # is a value read from the data.
        if len(parts) <= 2 and (len(parts[0]) >= 4 or (len(parts) == 2 and len(parts[1]) >= 3)):
            return f"contains a data-like number ({number})"
    if len(numbers) > 3:
        return "contains several numbers"
    return None


def filter_lessons(text: str) -> tuple[list[str], list[dict[str, str]]]:
    """Lines to keep, and the rejected ones with the reason (for the ledger)."""
    kept: list[str] = []
    rejected: list[dict[str, str]] = []
    for raw in text[:MAX_LESSON_CHARS].splitlines():
        line = raw.strip()
        if not line or line.lower().strip(" .-*") == "none" or line.startswith("#"):
            continue
        reason = lesson_rejection(line)
        if reason:
            rejected.append({"line": line[:200], "reason": reason})
        else:
            kept.append(line)
    return kept, rejected


def _sections(text: str) -> list[tuple[str, list[str]]]:
    """(task id, lesson lines) per saved run, oldest first."""
    out: list[tuple[str, list[str]]] = []
    for line in text.splitlines():
        if line.startswith(_HEADER):
            out.append((line[len(_HEADER) :].rsplit(", ", 1)[0].strip(), []))
        elif line.strip() and out:
            out[-1][1].append(line)
    return out


def read_memory(memory_dir: str | None, task_id: str | None = None) -> str:
    """Lessons earlier runs on OTHER tasks left on the runner's disk, newest that fit.

    Empty when memory is off or new. Lines are filtered again on the way in, so a hand-edited or
    older file cannot inject what `append_memory` would refuse."""
    if not memory_dir:
        return ""
    file = Path(memory_dir) / MEMORY_FILE
    if not file.exists():
        return ""
    picked: list[str] = []
    size = 0
    for section_task, lines in reversed(_sections(file.read_text(encoding="utf-8"))):
        if task_id is not None and section_task == str(task_id):
            continue
        for line in reversed(lines):
            if lesson_rejection(line):
                continue
            if size + len(line) + 1 > MEMORY_INJECT_CHARS:
                return "\n".join(reversed(picked))
            picked.append(line)
            size += len(line) + 1
    return "\n".join(reversed(picked))


def append_memory(memory_dir: str, task_id: str, lessons: str) -> bool:
    """Save the lines of `lessons` that pass the filter and are not already known."""
    kept, _ = filter_lessons(lessons)
    folder = Path(memory_dir)
    file = folder / MEMORY_FILE
    known = set(file.read_text(encoding="utf-8").splitlines()) if file.exists() else set()
    fresh = [line for line in kept if line not in known]
    if not fresh:
        return False
    folder.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")
    with file.open("a", encoding="utf-8") as fh:
        fh.write(f"\n{_HEADER}{task_id}, {stamp}\n" + "\n".join(fresh) + "\n")
    return True
