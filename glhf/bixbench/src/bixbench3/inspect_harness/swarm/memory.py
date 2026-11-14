"""Long-term memory of the swarm: process lessons kept between runs.

A lesson is free text written by a model, and no filter can prove that it carries nothing of a
task's inputs or answers. So memory is gated by a person:

  1. a run only ever writes to `lessons.pending.md`; nothing a run writes is shown to a later
     run until a person has read it and approved it (`python -m ...swarm.memory approve N`);
  2. only `lessons.md`, the approved file, is injected, and only approved lessons are sent to
     past.dev;
  3. a lesson is never shown to a run on the task that wrote it, nor on any task whose lessons
     were in that writer's context ("context" in the heading), so a result cannot travel
     X -> Y -> X by being rephrased in a run on Y;
  4. lessons are written before grading, so a score cannot be in one (see solver.py);
  5. as defence in depth, a line that looks like a result is dropped before it reaches the
     pending file, and again when the approved file is read (`lesson_rejection`).
The filter in (5) is deliberately blunt: it drops harmless lines and still cannot catch a gene
symbol without a digit or a result told in plain words. That is what the approval step is for.

Commands (run from glhf/bixbench; --dir defaults to glhf/memory):
  uv run python -m bixbench3.inspect_harness.swarm.memory list
  uv run python -m bixbench3.inspect_harness.swarm.memory approve 1 3
  uv run python -m bixbench3.inspect_harness.swarm.memory approve-all
  uv run python -m bixbench3.inspect_harness.swarm.memory reject 2
"""

from __future__ import annotations

import argparse
import asyncio
import re
import sys
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from .guards import normalise, study_identifier

MEMORY_FILE = "lessons.md"  # approved by a person; the only file that is injected
PENDING_FILE = "lessons.pending.md"  # written by runs; never injected
MEMORY_INJECT_CHARS = 6000  # newest lessons that fit; older ones stay on disk
MAX_LESSON_CHARS = 2000  # per run
DEFAULT_DIR = Path(__file__).resolve().parents[5] / "memory"  # glhf/memory
_HEADER = "## Task "
_CONTEXT = "; context: "

# Tokens that mix letters and digits and are tools, formats, references or units, not genes or
# samples. Compared in lower case.
_NOT_IDENTIFIERS = frozenset(
    "hisat2 deseq2 macs2 macs3 bowtie2 bowtie1 mem2 bzip2 bz2 lz4 hdf5 h5ad h5 utf8 utf16 md5 "
    "sha1 sha256 sha512 crc32 base64 base32 grch37 grch38 grcm38 grcm39 hg18 hg19 hg38 mm9 mm10 "
    "mm39 dm6 ce11 tair10 t2t r1 r2 i1 i2 gff3 gtf2 vcf4 log2 log10 log1p phred33 phred64 q20 q30 "
    "x86 arm64 s3 ec2 py2 py3 python2 python3 iso8601 k8s e2e ggplot2 minimap2 gatk4 bedtools2 "
    "tophat2 stringtie2 rpy2 float32 float64 int32 int64 uint8 http2 ipv4 ipv6 f1 10x".split()
)
_VERSION = re.compile(r"(?<![\w.])v?\d+(?:\.\d+)+[a-z]?(?![\w.]*\d)|(?<![\w.])v\d+(?!\w)", re.I)
_SCIENTIFIC = re.compile(
    r"\d(?:\.\d+)?e[-+]?\d|\d\s*(?:x|\*|\u00d7)\s*10\s*\^?\s*[-+]?\s*\d", re.IGNORECASE
)
_ENSEMBL = re.compile(r"(?<![A-Za-z])ENS[A-Z]*\d{6,}", re.IGNORECASE)
_SCORE = re.compile(
    r"(?<![A-Za-z])(scor(?:e|es|ed|ing)|ground[- ]truth|graders?|graded|answer key)(?![A-Za-z])",
    re.IGNORECASE,
)
# Words that belong to a statement of results, not of process.
_RESULT_WORDS = re.compile(
    r"(?<![A-Za-z])("
    r"answers?|expected|results?|findings?|top[- ]hits?|top genes?|hits?|"
    r"fold[- ]?changes?|log2fc|logfc|lfc|fdr|padj|p[- ]?adj|p[- ]?values?|q[- ]?values?|"
    r"outliers?|up[- ]?regulated|down[- ]?regulated|upregulat\w*|downregulat\w*|"
    r"significant(?:ly)?|enriched|markers?|"
    r"the paper|the study|the authors|published|supplement\w*"
    r")(?![A-Za-z])",
    re.IGNORECASE,
)
# A word joined to a number by "_" or "-" is how samples and replicates are named (KO_3, rep-2).
_SAMPLE_LIKE = re.compile(r"(?<![A-Za-z0-9])([A-Za-z]{1,12})[_-](\d+)(?![A-Za-z0-9]|\.\d)")
_NOT_SAMPLES = frozenset(
    "utf iso phred python py sha md base log step phase round version v r rule level column col "
    "line row chr chrom lane read part stage tier http tls ipv".split()
)
_NUMBER = re.compile(r"(?<![\w.])\d+(?:\.\d+)*(?![\w]*\.\d)")
_THOUSANDS = re.compile(r"(?<=\d)[,\u2009\u202f '](?=\d{3}(?!\d))")


def lesson_rejection(line: str) -> str | None:
    """Why a lesson line must not be kept, or None if it reads as a process note."""
    line = _THOUSANDS.sub("", normalise(line))
    if _SCORE.search(line):
        return "mentions a score, the grader or the answers"
    found = study_identifier(line)
    if found:
        return f"contains a study or dataset identifier ({found})"
    if _ENSEMBL.search(line):
        return "contains a gene or transcript identifier"
    word = _RESULT_WORDS.search(line)
    if word:
        return f"reads like a result, not a process note ({word.group(0).lower()!r})"
    if _SCIENTIFIC.search(line):
        return "contains a number in scientific notation"
    if re.search(r"\d\s*%", line):
        return "contains a percentage"
    # Any token that mixes letters and digits is treated as a gene, sample or file identifier
    # (TP53, Sox2, brca1, ctrl_rep3, S9) unless it is a known tool or format. Version strings
    # (2.7.10b, v32) are set aside first.
    for token in re.findall(r"[A-Za-z0-9]+", _VERSION.sub(" ", line)):
        if (
            any(c.isdigit() for c in token)
            and any(c.isalpha() for c in token)
            and token.lower() not in _NOT_IDENTIFIERS
        ):
            return f"contains an identifier that looks like a gene or sample ({token})"
    for prefix, digits in _SAMPLE_LIKE.findall(_VERSION.sub(" ", line)):
        if prefix.lower() not in _NOT_SAMPLES:
            return f"contains a name that looks like a sample or replicate ({prefix}_{digits})"
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
        elif line not in kept:
            kept.append(line)
    return kept, rejected


@dataclass
class Section:
    """The lessons one run wrote: its task, when, and the tasks whose lessons it had read."""

    task: str
    stamp: str
    context: list[str] = field(default_factory=list)
    lines: list[str] = field(default_factory=list)

    @property
    def provenance(self) -> set[str]:
        return {self.task, *self.context}

    def heading(self) -> str:
        context = _CONTEXT + ", ".join(self.context) if self.context else ""
        return f"{_HEADER}{self.task}, {self.stamp}{context}"


@dataclass(frozen=True)
class Memory:
    text: str = ""
    sources: frozenset[str] = frozenset()  # tasks whose lessons are in `text`, with their context


def _sections(file: Path) -> list[Section]:
    """Sections of a memory file, oldest first. Text before the first heading is ignored."""
    out: list[Section] = []
    if not file.exists():
        return out
    for line in file.read_text(encoding="utf-8").splitlines():
        if line.startswith(_HEADER):
            head, _, context = line[len(_HEADER) :].partition(_CONTEXT)
            task, _, stamp = head.rpartition(", ")
            out.append(
                Section(
                    (task or head).strip(),
                    stamp.strip() if task else "",
                    [c.strip() for c in context.split(",") if c.strip()],
                )
            )
        elif line.strip() and out:
            out[-1].lines.append(line.strip())
    return out


def _write(file: Path, sections: list[Section], title: str) -> None:
    body = "".join(f"\n{s.heading()}\n" + "\n".join(s.lines) + "\n" for s in sections if s.lines)
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(f"{title}\n{body}", encoding="utf-8")


_PENDING_TITLE = (
    "# Lessons waiting for approval\n\n"
    "Written by runs. Nothing here is shown to any run. Read each line, then approve or reject "
    "it:\n`uv run python -m bixbench3.inspect_harness.swarm.memory list` (from glhf/bixbench)."
)
_APPROVED_TITLE = (
    "# Approved lessons\n\n"
    "Process lessons a person approved. Runs with --memory read this file. Do not edit the "
    "`## Task` headings: code uses them to keep a lesson away from the task it came from."
)


def load_memory(memory_dir: str | None, task_id: str | None = None) -> Memory:
    """Approved lessons a run on `task_id` may see, newest that fit, with where they came from.

    A section is left out when the current task wrote it or was in its writer's context. Lines
    are filtered again on the way in, so a hand-edited file cannot inject what a run could not
    have written. The pending file is never read here."""
    if not memory_dir:
        return Memory()
    picked: list[str] = []
    sources: set[str] = set()
    size = 0
    full = False
    for section in reversed(_sections(Path(memory_dir) / MEMORY_FILE)):
        if full:
            break
        if task_id is not None and str(task_id) in section.provenance:
            continue
        for line in reversed(section.lines):
            if lesson_rejection(line) or line in picked:
                continue
            if size + len(line) + 1 > MEMORY_INJECT_CHARS:
                full = True
                break
            picked.append(line)
            sources |= section.provenance
            size += len(line) + 1
    return Memory("\n".join(reversed(picked)), frozenset(sources))


def read_memory(memory_dir: str | None, task_id: str | None = None) -> str:
    return load_memory(memory_dir, task_id).text


def add_pending(memory_dir: str, task_id: str, lessons: str, context: Iterable[str] = ()) -> int:
    """Queue the lines of `lessons` that pass the filter and are new, for a person to approve.

    `context` is every task whose lessons this run was shown. Returns the number queued."""
    kept, _ = filter_lessons(lessons)
    folder = Path(memory_dir)
    known = {
        line
        for name in (MEMORY_FILE, PENDING_FILE)
        for section in _sections(folder / name)
        for line in section.lines
    }
    fresh = [line for line in kept if line not in known]
    if not fresh:
        return 0
    stamp = datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")
    others = sorted({str(c) for c in context} - {str(task_id)})
    pending = [*_sections(folder / PENDING_FILE), Section(str(task_id), stamp, others, fresh)]
    _write(folder / PENDING_FILE, pending, _PENDING_TITLE)
    return len(fresh)


def pending_lessons(memory_dir: str | Path) -> list[tuple[int, Section, str]]:
    """(number, section, line) for every lesson waiting, numbered from 1 in file order."""
    out: list[tuple[int, Section, str]] = []
    for section in _sections(Path(memory_dir) / PENDING_FILE):
        for line in section.lines:
            out.append((len(out) + 1, section, line))
    return out


def decide(
    memory_dir: str | Path, numbers: Sequence[int] | None, approve: bool
) -> tuple[list[Section], list[tuple[int, str]]]:
    """Approve or reject pending lessons by number (None = all).

    Approved lines move to the approved file under their original heading (task, time, context).
    Returns the approved sections, and (number, reason) for lines the filter refuses: those can
    never be injected, so they are not approved and stay pending until rejected."""
    folder = Path(memory_dir)
    waiting = pending_lessons(folder)
    chosen = {n for n, _, _ in waiting} if numbers is None else set(numbers)
    unknown = chosen - {n for n, _, _ in waiting}
    if unknown:
        raise ValueError(f"no pending lesson numbered {sorted(unknown)}")
    approved: dict[str, Section] = {}
    refused: list[tuple[int, str]] = []
    left: dict[str, Section] = {}
    for number, section, line in waiting:
        target = None
        if number in chosen and approve:
            reason = lesson_rejection(line)
            if reason:
                refused.append((number, reason))
                target = left
            else:
                target = approved
        elif number not in chosen:
            target = left
        if target is not None:
            target.setdefault(
                section.heading(), Section(section.task, section.stamp, section.context)
            ).lines.append(line)
    if approved:
        _write(
            folder / MEMORY_FILE,
            [*_sections(folder / MEMORY_FILE), *approved.values()],
            _APPROVED_TITLE,
        )
    _write(folder / PENDING_FILE, list(left.values()), _PENDING_TITLE)
    return list(approved.values()), refused


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m bixbench3.inspect_harness.swarm.memory",
        description="Review the lessons runs have queued. Only approved lessons reach later runs.",
    )
    parser.add_argument("--dir", type=Path, default=DEFAULT_DIR, help="memory folder")
    parser.add_argument(
        "--no-past", action="store_true", help="do not send approved lessons to past.dev"
    )
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("list", help="show pending lessons with their numbers")
    for name in ("approve", "reject"):
        commands.add_parser(name).add_argument("numbers", type=int, nargs="+")
    commands.add_parser("approve-all")
    commands.add_parser("reject-all")
    args = parser.parse_args(argv)
    if args.command == "list":
        waiting = pending_lessons(args.dir)
        for number, section, line in waiting:
            context = f", context {', '.join(section.context)}" if section.context else ""
            flag = lesson_rejection(line)
            print(f"{number:3}  [task {section.task}{context}] {line}")
            if flag:
                print(f"     ! the filter refuses this line: {flag}")
        print(f"{len(waiting)} pending in {args.dir / PENDING_FILE}")
        return 0
    approve = args.command.startswith("approve")
    numbers = None if args.command.endswith("-all") else args.numbers
    try:
        approved, refused = decide(args.dir, numbers, approve)
    except ValueError as error:
        print(error, file=sys.stderr)
        return 2
    for number, reason in refused:
        print(f"{number}: not approved, the filter refuses it ({reason}); reject it or edit it")
    count = sum(len(s.lines) for s in approved)
    print(f"{'approved' if approve else 'rejected'} {count if approve else 'the chosen'} lesson(s)")
    if approved and not args.no_past:
        from ... import paid
        from . import past_memory  # late import: past_memory imports this module

        if paid.paid_calls_off():  # NO_PAID_CALLS: the approved file is kept, nothing is sent
            print(f"past.dev: nothing sent. {paid.HOW_TO_ALLOW}", file=sys.stderr)
        elif past_memory.enabled():
            for section in approved:
                try:
                    receipt = asyncio.run(
                        past_memory.remember(
                            section.task, "\n".join(section.lines), section.context
                        )
                    )
                    print(
                        f"sent {len(section.lines)} lesson(s) of task {section.task} to past.dev ({receipt})"
                    )
                except Exception as error:  # the approved file is the source of truth
                    print(f"past.dev: could not send task {section.task}: {error}", file=sys.stderr)
    return 0 if not refused else 1


if __name__ == "__main__":
    raise SystemExit(main())
