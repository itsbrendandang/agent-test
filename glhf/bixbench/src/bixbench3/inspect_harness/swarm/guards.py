"""Text checks shared by the documentation search and the lessons memory.

Both must refuse text that names the study being reproduced or its data. The checks run on a
normalised copy of the text, because an identifier can be disguised: full-width or zero-width
characters, a space or hyphen between prefix and number ("GSE 12345"), a file-name suffix
("GSE12345_counts.tsv"), a percent-encoded or spaced DOI. Word boundaries (`\\b`) are not used
around identifiers: `_` counts as a word character, so `\\b` misses "GSE12345_raw".
"""

from __future__ import annotations

import re
import unicodedata

_INVISIBLE = re.compile(
    r"[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]"
)
_DASHES = re.compile(r"[\u2010-\u2015\u2212\ufe58\ufe63\uff0d]")
_SEP = r"[\s\-_:#.]*"  # what may sit between an accession prefix and its number
_NOT_LETTER = r"(?<![A-Za-z])"
_STUDY_ID = re.compile(
    # DOI: 10.1038/s41586-..., also with %2F or a space instead of the slash.
    r"(?<![\d.])10\.\d{4,9}(?:\s*/\s*|\s*%2F\s*|\s+)\S+"
    rf"|{_NOT_LETTER}(?:GSE|GSM|GDS|GPL){_SEP}\d{{3,}}"  # GEO
    rf"|{_NOT_LETTER}[SED]R[RXPSA]{_SEP}\d{{4,}}"  # SRA / ENA / DDBJ
    rf"|{_NOT_LETTER}PRJ(?:NA|EB|DB){_SEP}\d+"  # BioProject
    rf"|{_NOT_LETTER}SAM(?:N|EA|D){_SEP}\d+"  # BioSample
    rf"|{_NOT_LETTER}E[\s\-_][A-Z]{{4}}[\s\-_]\d+"  # ArrayExpress
    rf"|{_NOT_LETTER}PMC{_SEP}\d{{4,}}"
    rf"|{_NOT_LETTER}(?:PMID|pubmed)(?:\s*id)?{_SEP}\d{{5,}}"
    rf"|{_NOT_LETTER}(?:phs|EGA[SDCN]){_SEP}\d{{6,}}"  # dbGaP, EGA
    rf"|{_NOT_LETTER}PXD{_SEP}\d{{4,}}"  # PRIDE / ProteomeXchange
    rf"|{_NOT_LETTER}MSV{_SEP}\d{{6,}}"  # MassIVE
    rf"|{_NOT_LETTER}MTBLS{_SEP}\d+"  # MetaboLights
    rf"|{_NOT_LETTER}syn{_SEP}\d{{5,}}"  # Synapse
    rf"|{_NOT_LETTER}(?:doi\.org|doi\s*:|zenodo|figshare|biorxiv|medrxiv|dryad|mendeley data)",
    re.IGNORECASE,
)


def normalise(text: str) -> str:
    """NFKC, without invisible characters, with every dash as "-" and runs of spaces as one."""
    text = unicodedata.normalize("NFKC", text)
    text = _DASHES.sub("-", _INVISIBLE.sub("", text))
    return re.sub(r"[ \t\r\f\v]+", " ", text)


def study_identifier(text: str) -> str | None:
    """The first study, dataset or paper identifier in `text` (normalised here), or None."""
    found = _STUDY_ID.search(normalise(text))
    return found.group(0)[:40] if found else None


def words(text: str) -> list[str]:
    """Lower-case words of a normalised text, for phrase comparison."""
    return re.findall(r"[a-z0-9]+", normalise(text).lower())


_STOP = frozenset(
    "a an and are as at by for from in into is of on or the to with without using via its their "
    "analysis study data".split()
)


def shared_phrase(text: str, protected: str, length: int = 3) -> str | None:
    """`length` consecutive words of `protected` (a paper title) that also occur, in that order
    and adjacent, in `text`; None if there is none. Runs made only of very common words are
    ignored, so "analysis of the" in a title does not block every query."""
    have, want = words(text), words(protected)
    grams = {tuple(have[i : i + length]) for i in range(len(have) - length + 1)}
    for i in range(len(want) - length + 1):
        gram = tuple(want[i : i + length])
        if gram in grams and sum(w not in _STOP for w in gram) >= 2:
            return " ".join(gram)
    return None


def names_person(text: str, surnames: list[str]) -> str | None:
    """A surname from `surnames` (3+ letters) that occurs as a whole word in `text`."""
    have = set(words(text))
    for surname in surnames:
        parts = words(surname)
        if parts and len(parts[-1]) >= 3 and parts[-1] in have:
            return parts[-1]
    return None
