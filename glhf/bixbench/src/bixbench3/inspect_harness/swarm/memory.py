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
  uv run python -m bixbench3.inspect_harness.swarm.memory approve-all --i-read-them
  uv run python -m bixbench3.inspect_harness.swarm.memory reject 2
"""

from __future__ import annotations

import argparse
import asyncio
import re
import sys
import unicodedata
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
_HEADING = re.compile(r"#+\s*task\s+(\S.*)$", re.IGNORECASE)  # as read back; written as _HEADER
_CONTEXT = "; context: "

# Tokens that mix letters and digits and are tools, formats, references or units, not genes or
# samples. Compared in lower case.
_NOT_IDENTIFIERS = frozenset(
    "hisat2 deseq2 macs2 macs3 bowtie2 bowtie1 mem2 bzip2 bz2 lz4 hdf5 h5ad h5 utf8 utf16 md5 "
    "sha1 sha256 sha512 crc32 base64 base32 grch37 grch38 grcm38 grcm39 hg18 hg19 hg38 mm9 mm10 "
    "mm39 dm6 ce11 tair10 t2t r1 r2 i1 i2 gff3 gtf2 vcf4 log2 log10 log1p phred33 phred64 q20 q30 "
    "x86 arm64 s3 ec2 py2 py3 python2 python3 iso8601 k8s e2e ggplot2 minimap2 gatk4 bedtools2 "
    "tophat2 stringtie2 rpy2 float32 float64 int32 int64 uint8 http2 ipv4 ipv6 f1 10x "
    "bed3 bed4 bed5 bed6 bed9 bed12 chr1 chr2 chr3 chrm chrx chry truseq2 truseq3 utf8sig "
    "fastq2 bz2 gzip2 sha2 sha3 x64 amd64 aarch64 win32 win64 h5seurat k8 b37 hs37d5 hs38 "
    "mm39 rn6 rn7 danrer11 saccer3 t2t gff2 cp1252 latin1 iso88591".split()
)
# Upper-case words that are tools, formats, units or ordinary shouting, not gene symbols. A
# token of 3 to 8 capitals that is not here is treated as a symbol (MYC, GAPDH, EGFR).
_NOT_SYMBOLS = frozenset(
    "STAR HISAT BWA GATK RSEM MACS BLAST BLAT SALMON DESEQ EDGER LIMMA VOOM GSEA FGSEA KEGG "
    "GENCODE ENSEMBL NCBI UCSC HGNC EMBL REFSEQ MSIGDB CRAN BIOC CONDA MAMBA DOCKER "
    "BAM SAM CRAM VCF BCF GVCF GTF GFF BED TSV CSV TXT JSON JSONL YAML YML XML HTML PDF PNG "
    "SVG HDF RDS RDA XLSX XLS MTX LOOM FASTA FASTQ FAI BAI CSI TBI BGZF GZIP BGZIP TAR ZIP "
    "NARROWPEAK BROADPEAK BIGWIG BEDGRAPH "
    "RNA DNA MRNA CDNA RRNA TRNA MIRNA LNCRNA GDNA ATAC CHIP SEQ SCRNA SNRNA SNP SNPS SNV "
    "INDEL INDELS CNV PCR QPCR UMI UMIS UTR CDS TSS TES ORF ERCC "
    "TPM FPKM RPKM CPM TMM RLE VST RLOG PCA UMAP TSNE SVD NMF GLM ANOVA HVG HVGS "
    "MAPQ CIGAR FLAG PHRED QUAL "
    "RAM CPU CPUS GPU SSD HDD JVM API CLI GUI URL URI HTTP HTTPS FTP SSH SQL IDE OOM "
    "ASCII UTF BOM CRLF EOF EOL TAB PATH HOME TMP TMPDIR PWD USER LANG NULL NONE TRUE FALSE "
    "NAN INF README TODO NOTE NOTES TIP TIPS FIXME LICENSE METHODS FINDINGS LESSONS "
    "THE AND NOT FOR ALL ANY USE ONLY MUST NEVER ALWAYS BEFORE AFTER FIRST THEN WHEN WITH "
    "WARNING ERROR ERRORS INFO DEBUG DONE STEP ONE TWO "
    "AWS GCP GCS VPC IAM POSIX UNIX LINUX MACOS".split()
)
# Words a number may stand next to without being a value read from the data: after a tool or
# an option (a version, a setting), or before a unit of the machine (not of the biology).
_TOOLS = frozenset(
    "python python3 r rscript perl java julia bash conda mamba pip docker ubuntu debian node "
    "star hisat2 hisat salmon kallisto bowtie bowtie2 bwa minimap2 samtools bcftools htslib "
    "bedtools deeptools macs2 macs3 multiqc fastqc cutadapt fastp trimmomatic subread "
    "featurecounts htseq rsem stringtie picard gatk gatk4 cellranger ranger spaceranger "
    "scanpy anndata seurat deseq2 edger limma pandas numpy scipy sklearn matplotlib "
    "snakemake nextflow bioconductor biocmanager ensembl gencode refseq tximport fgsea "
    "clusterprofiler version versions release v".split()
)
_UNIT = (
    r"(?:seconds?|secs?|s|ms|minutes?|mins?|hours?|hrs?|h|days?|"
    r"[kmgt]i?b|[kmgt]|bytes?|threads?|cores?|cpus?|jobs?|processes|workers?|bits?|"
    r"permutations?|iterations?|retries|attempts?|characters?|chars?)"
)
_ATTACHED = re.compile(
    # "-p 4", "--threads=8", "-Xmx16g": the value of an option
    r"(?<![A-Za-z0-9])--?[A-Za-z][\w.\-]*(?:[ =]|(?<=[A-Za-z])(?=\d))\d+(?:\.\d+)?[A-Za-z]{0,2}(?![\w.]*\d)"
    # "3600 seconds", "16 GB", "8 threads": an amount of machine
    rf"|(?<![\w.])\d+(?:\.\d+)?[ -]?{_UNIT}(?![A-Za-z0-9])",
    re.IGNORECASE,
)
_AFTER_WORD = re.compile(r"([A-Za-z][A-Za-z0-9]*)[ ]v?(\d+(?:\.\d+)?)(?![\w]*\.\d)(?![A-Za-z0-9])")
_NUMBER_WORDS = (
    "two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen "
    "sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety"
).split()
_NUMBER_WORD = re.compile(rf"(?<![A-Za-z])(?:{'|'.join(_NUMBER_WORDS)})(?![A-Za-z])", re.I)
_MAGNITUDE = re.compile(
    r"(?<![A-Za-z])(?:hundreds?|thousands?|dozens?|percent|per ?cent)(?![A-Za-z])", re.I
)
_CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f\x85\u2028\u2029]")
# Advice about how to write a column is not a result: "p-values must be written unrounded".
_HOW_TO_WRITE = re.compile(
    r"(?<![A-Za-z])[pq][- ]?values (?:must|should|need to|have to|are to) be "
    r"(?:written|kept|stored|reported|left|formatted|printed)(?![A-Za-z])",
    re.IGNORECASE,
)
_CALLS = re.compile(r"(?<![A-Za-z])results(?:\(\)|\(| names?(?![A-Za-z]))", re.IGNORECASE)
_VERSION = re.compile(r"(?<![\w.])v?\d+(?:\.\d+)+[a-z]?(?![\w.]*\d)|(?<![\w.])v\d+(?!\w)", re.I)
# For numbers: only what cannot be a value (2.7.10, v32). "2.317" is a version to _VERSION.
_LONG_VERSION = re.compile(
    r"(?<![\w.])v?\d+(?:\.\d+){2,}[a-z]?(?![\w.]*\d)|(?<![\w.])v\d+(?:\.\d+)*(?!\w)", re.I
)
_SCIENTIFIC = re.compile(
    r"\d(?:\.\d+)?e[-+]?\d|\d\s*(?:x|\*|\u00d7)\s*10\s*\^?\s*[-+]?\s*\d", re.IGNORECASE
)
_ENSEMBL = re.compile(r"(?<![A-Za-z])ENS[A-Z]*\d{6,}", re.IGNORECASE)
_SCORE = re.compile(
    r"(?<![A-Za-z])(scor(?:e|es|ed|ing)|ground[^A-Za-z0-9]?truth|graders?|graded|grading|"
    r"answer key|rubrics?|full marks|checkers?|judges?|truth set|benchmark key)(?![A-Za-z])",
    re.IGNORECASE,
)
# Words that belong to a statement of results, not of process.
_RESULT_WORDS = re.compile(
    r"(?<![A-Za-z])("
    r"answers?|expected|results?|findings?|top[- ]hits?|top genes?|hits?|"
    r"fold[- ]?changes?|log2fc|logfc|lfc|fdr|padj|p[- ]?adj|p[- ]?values?|q[- ]?values?|"
    r"outliers?|up[- ]?regulated|down[- ]?regulated|upregulat\w*|downregulat\w*|"
    r"significant(?:ly)?|enriched|markers?|"
    r"differentially expressed|degs?|de genes?|derepress\w*|overexpress\w*|underexpress\w*|"
    r"represses|induces|depleted|odds ratio|effect size|pvals?|adj\.p\.val|"
    r"strongest|dominates?|goes (?:up|down)|go (?:up|down)|comes? out on top|"
    r"wins|winner|tophits?|topgenes?|"
    r"the paper|the study|the authors|published|supplement\w*|"
    r"articles?|manuscript\w*|publications?|pre-?prints?|et al"
    r")(?![A-Za-z])",
    re.IGNORECASE,
)
# A word joined to a number by "_" or "-" is how samples and replicates are named (KO_3, rep-2).
_SAMPLE_LIKE = re.compile(
    r"(?<![A-Za-z0-9])([A-Za-z]{1,12})[_\-.#:~/]{1,2}(\d+)(?![A-Za-z0-9]|\.\d)"
    r"|(?<![A-Za-z0-9])([A-Za-z]{2,12})_+([IVX]+|[A-Za-z])(?![A-Za-z0-9])"
)
_NOT_SAMPLES = frozenset(
    "utf iso phred python py sha md base log step phase round version v r rule level column col "
    "line row chr chrom lane read part stage tier http tls ipv ubuntu debian node java gcc "
    "cuda port release option mode type layer pass lib exon intron k bed gff gtf vcf "
    "localhost section figure table chapter item note tip rev".split()
)
# Two capitals and a number close by is how short symbols and samples are written when the
# digit is detached: "TP 53", "IL-6", "KO#3", "CD (4)".
_SHORT_SYMBOL = re.compile(r"(?<![A-Za-z0-9])([A-Z]{2,6})[^A-Za-z0-9]{1,2}(\d{1,3})(?![A-Za-z0-9])")
_NOT_SHORT_SYMBOLS = frozenset(
    "GB MB KB TB ID OK OS IO UI PC QC GO DE CI PE SE NA AT IN ON OR TO NO".split()
)
_NUMBER = re.compile(r"(?<![\w.])\d+(?:\.\d+)*(?![\w]*\.\d)")
_THOUSANDS = re.compile(r"(?<=\d)[,\u2009\u202f '](?=\d{3}(?!\d))")


def free_numbers(line: str) -> list[str]:
    """Numbers in a normalised line that are not a version, not the value of an option, not an
    amount of machine ("16 GB", "8 threads") and not the version after a tool's name."""
    rest = _ATTACHED.sub(" ", _LONG_VERSION.sub(" ", line))
    rest = _AFTER_WORD.sub(
        lambda m: " " if m.group(1).lower() in _TOOLS else m.group(0),
        rest,
    )
    return _NUMBER.findall(rest)


def lesson_rejection(line: str) -> str | None:
    """Why a lesson line must not be kept, or None if it reads as a process note."""
    raw = _CONTROL.sub("", unicodedata.normalize("NFKC", line))
    if re.search(r"\d\s*%", raw):  # before percent-decoding, which would read "%20" as a space
        return "contains a percentage"
    line = _THOUSANDS.sub("", normalise(_CONTROL.sub("", line)))
    if _SCORE.search(line):
        return "mentions a score, the grader or the answers"
    found = study_identifier(line)
    if found:
        return f"contains a study or dataset identifier ({found})"
    if _ENSEMBL.search(line):
        return "contains a gene or transcript identifier"
    word = _RESULT_WORDS.search(_CALLS.sub(" ", _HOW_TO_WRITE.sub(" ", line)))
    if word:
        return f"reads like a result, not a process note ({word.group(0).lower()!r})"
    if _SCIENTIFIC.search(line):
        return "contains a number in scientific notation"
    if re.search(r"\d\s*%", line):
        return "contains a percentage"
    if _MAGNITUDE.search(line) or len(_NUMBER_WORD.findall(line)) >= 2:
        return "contains a number written in words"
    # Any token that mixes letters and digits is treated as a gene, sample or file identifier
    # (TP53, Sox2, brca1, ctrl_rep3, S9) unless it is a known tool or format. Version strings
    # (2.7.10b, v32) and the values of options (-Xmx16g) are set aside first.
    plain = _ATTACHED.sub(" ", _VERSION.sub(" ", line))
    for token in re.findall(r"[A-Za-z0-9]+", plain):
        if (
            any(c.isdigit() for c in token)
            and any(c.isalpha() for c in token)
            and token.lower() not in _NOT_IDENTIFIERS
        ):
            return f"contains an identifier that looks like a gene or sample ({token})"
    # A gene symbol without a digit is a word in capitals (MYC, GAPDH). No list of symbols is
    # kept here; a list of the capitals that are tools and formats is.
    for token in re.findall(r"(?<![A-Za-z0-9])[A-Z]{3,8}(?![A-Za-z0-9]|\.[a-z])", plain):
        if token not in _NOT_SYMBOLS:
            return f"contains a word in capitals that may be a gene symbol ({token})"
    for symbol, digits in _SHORT_SYMBOL.findall(plain):
        joined = f"{symbol}{digits}".lower()
        if (
            symbol not in _NOT_SYMBOLS
            and symbol not in _NOT_SHORT_SYMBOLS
            and symbol.lower() not in _TOOLS
            and joined not in _NOT_IDENTIFIERS
        ):
            return f"contains an identifier that looks like a gene or sample ({symbol} {digits})"
    for prefix, digits, name, suffix in _SAMPLE_LIKE.findall(plain):
        if (prefix or name).lower() not in _NOT_SAMPLES and prefix.lower() not in _TOOLS:
            return (
                "contains a name that looks like a sample or replicate "
                f"({prefix or name}_{digits or suffix})"
            )
    numbers = _NUMBER.findall(line)
    for number in free_numbers(line):
        parts = number.split(".")
        # Two or more dots is a version (2.7.10). Otherwise an integer of three or more digits
        # or any decimal is a value read from the data, unless it is attached to a tool, an
        # option or a unit of the machine (those were set aside by free_numbers).
        if len(parts) <= 2 and (len(parts[0]) >= 3 or len(parts) == 2):
            return f"contains a data-like number ({number})"
    if len(numbers) > 3:
        return "contains several numbers"
    return None


MAX_FREE_NUMBERS = 3  # in one run's lessons, all lines together


def filter_lessons(text: str) -> tuple[list[str], list[dict[str, str]]]:
    """Lines to keep, and the rejected ones with the reason (for the ledger).

    Lines are split on "\\n" only, after the control characters and Unicode line separators
    that str.splitlines() would also split on are deleted: "TP<separator>53" is one token. The
    numbers of all lines are counted together, so a value cannot be told one digit per line."""
    kept: list[str] = []
    rejected: list[dict[str, str]] = []
    for raw in _CONTROL.sub("", text[:MAX_LESSON_CHARS].replace("\r\n", "\n")).split("\n"):
        line = raw.strip()
        if not line or line.lower().strip(" .-*") == "none" or line.startswith("#"):
            continue
        reason = lesson_rejection(line)
        if reason:
            rejected.append({"line": line[:200], "reason": reason})
        elif line not in kept:
            kept.append(line)
    counted = {line: len(free_numbers(normalise(line))) for line in kept}
    if sum(counted.values()) > MAX_FREE_NUMBERS:
        reason = f"the lessons hold more than {MAX_FREE_NUMBERS} numbers between them"
        rejected += [{"line": k[:200], "reason": reason} for k in kept if counted[k]]
        kept = [k for k in kept if not counted[k]]
    return kept, rejected


def canonical_id(task_id: object) -> str:
    """One spelling per task id, for the same-task rule: NFKC, trimmed, lower case, "-" for
    runs of spaces, "_" and "-", and no leading zeros on a number."""
    text = unicodedata.normalize("NFKC", str(task_id)).strip().casefold()
    text = re.sub(r"[\s_\-]+", "-", text)
    return text.lstrip("0") or "0" if text.isdigit() else text


def check_task_id(task_id: object) -> str:
    """The id as text, refused if it could not be read back from a heading: "," separates the
    context list and ";" starts it, and a line break would end the heading."""
    text = str(task_id).strip()
    if not text or any(c in text for c in ",;\n\r"):
        raise ValueError(f"task id {text!r} is empty or contains ',', ';' or a line break")
    return text


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
    current: Section | None = None
    for line in file.read_text(encoding="utf-8").split("\n"):
        line = line.strip().lstrip("\ufeff")
        if line.startswith("#"):
            # Every "#" line is a heading. One that is not a task heading (the file's title,
            # or a task heading mistyped by hand) owns the lines under it, and they are
            # dropped: they must not be credited to the task above.
            heading = _HEADING.match(line)
            current = None
            if heading:
                head, _, context = heading.group(1).partition(_CONTEXT)
                task, _, stamp = head.rpartition(", ")
                current = Section(
                    (task or head).strip(),
                    stamp.strip() if task else "",
                    [c.strip() for c in context.split(",") if c.strip()],
                )
                out.append(current)
        elif line and current is not None:
            current.lines.append(line)
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


def load_memory(memory_dir: str | None, task_id: str | None) -> Memory:
    """Approved lessons a run on `task_id` may see, newest that fit, with where they came from.

    A section is left out when the current task wrote it or was in its writer's context (ids
    are compared in their canonical spelling). Lines are filtered again on the way in, so a
    hand-edited file cannot inject what a run could not have written. The pending file is never
    read here. `task_id` is required, and without one nothing is returned: a reader that does
    not say which task it is cannot be kept away from that task's lessons."""
    if not memory_dir or task_id is None or not str(task_id).strip():
        return Memory()
    reader = canonical_id(task_id)
    picked: list[str] = []
    sources: set[str] = set()
    size = 0
    full = False
    for section in reversed(_sections(Path(memory_dir) / MEMORY_FILE)):
        if full:
            break
        if reader in {canonical_id(p) for p in section.provenance}:
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


def read_memory(memory_dir: str | None, task_id: str | None) -> str:
    return load_memory(memory_dir, task_id).text


def add_pending(memory_dir: str, task_id: str, lessons: str, context: Iterable[str] = ()) -> int:
    """Queue the lines of `lessons` that pass the filter and are new, for a person to approve.

    `context` is every task whose lessons this run was shown. Returns the number queued."""
    task_id = check_task_id(task_id)
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
    others = sorted({check_task_id(c) for c in context} - {task_id})
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
    commands.add_parser("approve-all").add_argument(
        "--i-read-them",
        action="store_true",
        help="required: say that you have read every pending lesson (`list` shows them)",
    )
    commands.add_parser("reject-all")
    args = parser.parse_args(argv)
    if args.command == "approve-all" and not args.i_read_them:
        # Approval is the gate: no filter can prove a lesson carries nothing of a task.
        print(
            "approve-all approves lessons nobody may have read. Run `list`, read every line, "
            "then repeat with --i-read-them (or approve by number).",
            file=sys.stderr,
        )
        return 2
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
