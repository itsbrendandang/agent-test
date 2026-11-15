"""Text checks shared by the documentation search and the lessons memory.

Both must refuse text that names the study being reproduced or its data. The checks run on a
normalised copy of the text, because an identifier can be disguised: full-width, zero-width or
combining characters, percent-encoding or HTML entities, a letter of another script that looks
like a Latin one, any punctuation between prefix and number ("GSE/12345", "GSE (12345)"), a
file-name suffix ("GSE12345_counts.tsv"), spaced-out letters or digits ("G S E 12 34 56"), a
DOI with its slash replaced. Word boundaries (`\\b`) are not used around identifiers: `_`
counts as a word character, so `\\b` misses "GSE12345_raw".

What no pattern here can decide (a rephrased title, a dataset's nickname, the biology of the
task told in plain words) is listed as LIMIT in tests/unit/test_redteam_guards.py.
"""

from __future__ import annotations

import html
import re
import unicodedata
from urllib.parse import unquote

_INVISIBLE = re.compile(
    r"[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f"
    r"\u2800\u3164\ufeff\uffa0]"
)
_DASHES = re.compile(r"[\u2010-\u2015\u2212\ufe58\ufe63\uff0d]")
# Letters of other scripts that are drawn like Latin ones (Cyrillic, Greek, Cherokee, small
# capitals). Only letters that are the same shape; a text that really is Greek or Russian is
# changed too, which does not matter: this copy is only ever compared, never shown.
_CONFUSABLE = str.maketrans(
    {
        "\u0410": "A", "\u0412": "B", "\u0415": "E", "\u041a": "K", "\u041c": "M",
        "\u041d": "H", "\u041e": "O", "\u0420": "P", "\u0421": "C", "\u0422": "T",
        "\u0425": "X", "\u0405": "S", "\u0406": "I", "\u0408": "J", "\u050c": "G",
        "\u0430": "a", "\u0435": "e", "\u043e": "o", "\u0440": "p", "\u0441": "c",
        "\u0443": "y", "\u0445": "x", "\u0455": "s", "\u0456": "i", "\u0458": "j",
        "\u0391": "A", "\u0392": "B", "\u0395": "E", "\u0396": "Z", "\u0397": "H",
        "\u0399": "I", "\u039a": "K", "\u039c": "M", "\u039d": "N", "\u039f": "O",
        "\u03a1": "P", "\u03a4": "T", "\u03a5": "Y", "\u03a7": "X", "\u03bf": "o",
        "\u03c7": "x", "\u13c0": "G", "\u0262": "G", "\u0280": "R", "\u1d07": "E",
    }
)  # fmt: skip
_SEP = r"[^A-Za-z0-9]{0,3}"  # what may sit between an accession prefix and its number
_TIGHT = r"[^A-Za-z0-9\s]{0,3}"  # the same without spaces, where a space makes ordinary text
_NOT_LETTER = r"(?<![A-Za-z])"
# ArrayExpress collection codes. The pattern used to take any four letters, case-insensitive,
# and so refused "-e QUAL 20" (an option, a word and a number).
_AE_CODES = (
    "MTAB|GEOD|MEXP|TABM|ERAD|AFMX|ATMX|BAIR|BUGS|CAGE|CBIL|DKFZ|DORD|EMBL|ENAD|FLYC|FPMI|GEAD|"
    "HCAD|HGMP|IPKG|JCVI|JJRD|LGCL|MAXD|MANP|MARS|MIMR|MNIA|MUGN|NASC|NCMF|NGEN|PROT|RUBN|RZPD|"
    "SGRP|SMDB|SNGR|SYBR|TIGR|TOXM|UCON|UHNC|UMCU|WMIT"
)


def _spread(word: str) -> str:
    """A pattern for `word` with up to two non-alphanumerics between its letters ("bio rxiv",
    "z e n o d o", "fig-share"), which must not start inside another word."""
    return _NOT_LETTER + r"[^A-Za-z0-9]{0,2}".join(re.escape(c) for c in word if c.isalnum())


_STUDY_ID = re.compile(
    # DOI: 10.1038/s41586-...; with something else for the slash, the suffix needs a letter
    # ("10.5555_glhf.2021", "10.5555 glhf"), so "10.12345 / 3" stays arithmetic.
    r"(?<![\d.])10\.\d{4,9}(?:/\S+|[^A-Za-z0-9]{1,3}(?=\S*[A-Za-z])\S+)"
    rf"|{_NOT_LETTER}(?:GSE|GSM|GPL){_SEP}\d{{3,}}"  # GEO
    rf"|{_NOT_LETTER}GDS{_TIGHT}\d{{3,}}"  # GEO DataSet; "GDS 1000 Genomes" is a file format
    rf"|{_NOT_LETTER}[SED]R[RXPSAZ]{_SEP}\d{{4,}}"  # SRA / ENA / DDBJ
    rf"|{_NOT_LETTER}PRJ[A-Z]{{2}}{_SEP}\d+"  # BioProject (NA, EB, DB, EA, DA, CA)
    rf"|{_NOT_LETTER}SAM[A-Z]{{1,2}}{_SEP}\d{{5,}}"  # BioSample; SAMD9 and SAMD11 are genes
    rf"|{_NOT_LETTER}E{_SEP}(?:{_AE_CODES}){_SEP}\d+"  # ArrayExpress
    rf"|{_NOT_LETTER}(?:MTAB|GEOD|MEXP|TABM){_SEP}\d{{3,}}"  # the same without its "E-"
    r"|(?-i:(?<![A-Za-z])E[-_][A-Z]{4}[-_]\d+)"  # an unlisted collection, as it is written
    rf"|{_NOT_LETTER}(?:S-?E|E)?PMC{_SEP}\d{{4,}}"
    rf"|{_NOT_LETTER}(?:PMID|pubmed)(?:\s*id)?{_SEP}\d{{5,}}"
    r"|(?<!\d)\d{5,}\s*\[(?:pmid|uid|pmcid)\]"
    rf"|{_NOT_LETTER}(?:phs|EGA[SDCNFRXZ]){_SEP}\d{{6,}}"  # dbGaP, EGA
    rf"|{_NOT_LETTER}PXD{_SEP}\d{{4,}}"  # PRIDE / ProteomeXchange
    rf"|{_NOT_LETTER}MSV{_SEP}\d{{6,}}"  # MassIVE
    rf"|{_NOT_LETTER}MTBLS{_SEP}\d+"  # MetaboLights
    rf"|{_NOT_LETTER}syn{_SEP}\d{{5,}}"  # Synapse
    rf"|{_NOT_LETTER}ENC(?:SR|FF|BS|LB|DO){_TIGHT}\d{{3}}[A-Z]{{3}}"  # ENCODE
    rf"|{_NOT_LETTER}S-B(?:SST|IAD){_TIGHT}\d+"  # BioStudies, BioImage Archive
    rf"|{_NOT_LETTER}(?:NCT{_TIGHT}\d{{8}}|ISRCTN{_TIGHT}\d{{8}})"  # trial registries
    rf"|{_NOT_LETTER}EMPIAR{_SEP}\d+"
    rf"|{_NOT_LETTER}(?:MGYS|JPST|JGA[SD]|IPX){_TIGHT}\d{{4,}}"  # MGnify, jPOST, JGA, iProX
    # NGDC/GSA, CNGB, NODE, Metabolomics Workbench, Single Cell Portal, PeptideAtlas: short
    # prefixes that are also words or commands, so upper case and nothing before the digits.
    r"|(?-i:(?<![A-Za-z])(?:CRA|HRA|CNP|OEP|ST|SCP|PASS)\d{4,})"
    r"|(?<![0-9a-f])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"  # a UUID
    # Publisher article ids: the paper without its DOI prefix.
    r"|(?<![a-z0-9])s\d{5}-\d{3}-\d{4,5}-[0-9a-z]"  # Springer Nature
    r"|(?<![a-z0-9])j\.[a-z]{2,12}\.\d{4}\.\d{2}\.\d{3}"  # Elsevier
    r"|(?<![a-z0-9])S\d{4}-?\d{4}\(?\d{2}\)?\d{5}-?[\dX]"  # PII
    r"|(?<![\d.])(?:19|20)\d{2}\.\d{2}\.\d{2}\.\d{6}"  # bioRxiv / medRxiv
    r"|(?<![a-z])elife\.\d{5}"
    r"|(?<![a-z])arxiv\W{0,2}\d{4}\.\d{4,5}"
    r"|(?<![a-z])(?:rs-\d{5,}|ssrn\W{0,3}\d{6,})"  # Research Square, SSRN
    rf"|{_NOT_LETTER}doi\s*:"
    rf"|{_NOT_LETTER}doi[^A-Za-z0-9]{{0,3}}(?:dot[^A-Za-z0-9]{{0,3}})?org(?![A-Za-z])"
    + "".join(
        f"|{_spread(word)}"
        for word in (
            "zenodo", "figshare", "biorxiv", "bioarxiv", "medrxiv", "dryad", "mendeley data",
            "data.mendeley", "osf.io", "europepmc", "researchsquare",
        )
    ),
    re.IGNORECASE,
)  # fmt: skip
# A repository's name with a long number anywhere in the same text: "GEO accession 123456",
# "PMID is 31234567", "run 1234567 from SRA". No tool manual is looked up this way.
_REPOSITORY = re.compile(
    r"(?<![A-Za-z])(?:GSE|GSM|GEO|Gene Expression Omnibus|SRA|ENA|DDBJ|PMID|PMCID|PMC|PubMed|"
    r"MEDLINE|BioProject|BioSample|ArrayExpress|dbGaP|Synapse|accessions?)(?![A-Za-z])",
    re.IGNORECASE,
)
_LONG_NUMBER = re.compile(r"(?<![\d.])\d{5,}(?![\d.]\d)")
# Spaced-out forms, undone on a second copy of the text: single letters ("G S E", "G.S.E."),
# and groups of digits ("12 34 56", "31,234,567"). Dots between digits are left: versions.
_SPELLED = re.compile(r"(?<![A-Za-z])(?:[A-Za-z][ .\-]{1,2}){2,}(?:[A-Za-z](?![A-Za-z]))?")
_DIGIT_GAP = re.compile(r"(?<=\d)[ ,\-](?=\d)")


def normalise(text: str) -> str:
    """The copy of `text` that is compared: percent-encoding (twice) and HTML entities decoded,
    compatibility forms folded (NFKC), accents, combining marks, format and invisible characters
    removed, look-alike letters of other scripts as Latin, every dash as "-", runs of spaces
    as one. For comparison only: it is not the text a reader should be shown."""
    text = html.unescape(unquote(unquote(text)))
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if unicodedata.category(c) not in ("Cf", "Mn", "Me"))
    text = unicodedata.normalize("NFKC", text).translate(_CONFUSABLE)
    text = _DASHES.sub("-", _INVISIBLE.sub("", text))
    return re.sub(r"[ \t\r\f\v]+", " ", text)


def squeezed(text: str) -> str:
    """Lower-case letters and digits of the normalised text, nothing else."""
    return re.sub(r"[^a-z0-9]", "", normalise(text).lower())


def _joined(plain: str) -> str:
    """`plain` with spaced-out letters and digit groups closed up."""
    closed = _SPELLED.sub(lambda m: re.sub(r"[ .\-]", "", m.group(0)) + " ", plain)
    return _DIGIT_GAP.sub("", closed)


def study_identifier(text: str) -> str | None:
    """The first study, dataset or paper identifier in `text` (normalised here), or None."""
    plain = normalise(text)
    for copy in (plain, _joined(plain)):
        found = _STUDY_ID.search(copy)
        if found:
            return found.group(0)[:40]
        word = _REPOSITORY.search(copy)
        number = _LONG_NUMBER.search(copy)
        if word and number:
            return f"{word.group(0)} ... {number.group(0)}"[:40]
    return None


def names_doi(text: str, doi: str) -> bool:
    """True when `text` holds the case's DOI or the part after its slash, whatever stands for
    the dots and the slash, forwards or backwards. Compared on letters and digits only; the
    suffix alone counts from six of them."""
    have = squeezed(text)
    whole = squeezed(doi)
    suffix = squeezed(doi.partition("/")[2])
    wanted = [whole] if whole else []
    if len(suffix) >= 6:
        wanted.append(suffix)
    return any(w in have or w[::-1] in have for w in wanted)


def words(text: str) -> list[str]:
    """Lower-case words of a normalised text, for phrase comparison."""
    return re.findall(r"[a-z0-9]+", normalise(text).lower())


_STOP = frozenset(
    "a an and are as at by for from in into is of on or the to with without using via its their "
    "analysis study data".split()
)
# Method vocabulary: a title that opens with "Single-cell RNA sequencing reveals" must not
# refuse every query about single-cell RNA sequencing.
_METHOD = frozenset(
    "single cell cells rna dna seq sequencing expression gene genes transcriptome "
    "transcriptomic transcriptional genome genomic profiling reveals".split()
)


def shared_phrase(text: str, protected: str, length: int = 3) -> str | None:
    """`length` consecutive words of `protected` (a paper title) that also occur, in that order
    and adjacent, in `text`; None if there is none. Runs made only of very common words are
    ignored, so "analysis of the" in a title does not block every query, and so are runs made
    only of method vocabulary ("single cell rna")."""
    have, want = words(text), words(protected)
    grams = {tuple(have[i : i + length]) for i in range(len(have) - length + 1)}
    for i in range(len(want) - length + 1):
        gram = tuple(want[i : i + length])
        if (
            gram in grams
            and sum(w not in _STOP for w in gram) >= 2
            and any(w not in _STOP and w not in _METHOD for w in gram)
        ):
            return " ".join(gram)
    return None


_PARTICLES = frozenset("van von der den del dos das des los las bin ibn the and".split())
# Surnames that are also everyday or bioinformatics words. Alone they refuse nothing ("long
# read", "each lane"); they count next to "et al", "lab", a year or a possessive.
_COMMON_WORDS = frozenset(
    "love read reads lane long short young white black brown green gray grey king bell hill "
    "wood park rice wolf fox bird fish lamb head hand cross field stone rose may can will sun "
    "page mark marks bass frame table peak peaks base bases chain cook day down fast file "
    "gold good hall high hope key law low man moon more new old pool price rich rule sample "
    "small strong swift west wise best block board book case core count cox fields hunt "
    "index major moss norm power ray root sharp snow south star stock strand string sum "
    "trim".split()
)
_TRANSLITERATION = str.maketrans(
    {"\u00fc": "ue", "\u00f6": "oe", "\u00e4": "ae", "\u00df": "ss", "\u00f8": "oe", "\u00e5": "aa"}
)  # fmt: skip
_CONTEXT_AFTER = (
    r"(?:'s|s'|\s+et\s+al|\s+lab|\s+labs|\s+group|\s+and\s+colleagues|\W{0,3}(?:19|20)\d{2})"
)


def _in_citation(plain: str, word: str) -> bool:
    """`word` stands like a cited name: "Love et al", "the Love lab", "Love 2014", "Love's"."""
    return bool(
        re.search(rf"(?<![a-z0-9]){re.escape(word)}{_CONTEXT_AFTER}(?![a-z])", plain)
        or re.search(rf"(?:19|20)\d{{2}}\W{{0,3}}{re.escape(word)}(?![a-z0-9])", plain)
    )


def names_person(text: str, surnames: list[str]) -> str | None:
    """A name from `surnames` that occurs in `text`; the matching word is returned.

    Every word of three or more letters of each author string is compared, accents folded
    (also "ue" for "\u00fc"), so "Okonkwo A", "Okonkwo, Ada" and "Smith-Jones" all work. A word
    of seven or more letters is also found inside a joined or spaced spelling
    ("Okonkwoetal2021", "Okon kwo"). Two-letter surnames and surnames that are everyday words
    count only where they stand like a citation. A name in another script is compared as it is."""
    plain = normalise(text).lower()
    have, tight = set(re.findall(r"[a-z0-9]+", plain)), re.sub(r"[^a-z0-9]", "", plain)
    for surname in surnames:
        raw = unicodedata.normalize("NFKC", surname).lower()
        spellings = {normalise(surname).lower(), normalise(raw.translate(_TRANSLITERATION)).lower()}
        for spelling in sorted(spellings):
            parts: list[str] = re.findall(r"[a-z]+", spelling)
            whole = "".join(parts)
            for part in [*parts, whole]:
                if part in _PARTICLES or len(part) < 2:
                    continue
                if len(part) == 2 or part in _COMMON_WORDS:
                    if part in parts and _in_citation(plain, part):
                        return part
                    continue
                if part in have or (len(part) >= 7 and part in tight):
                    return part
        other = "".join(c for c in normalise(surname).lower() if c.isalpha() and not c.isascii())
        if other and other in plain:
            return other
    return None
