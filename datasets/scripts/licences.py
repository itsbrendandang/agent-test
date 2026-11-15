"""Licence normalisation for the dataset catalogue.

One rule: never guess. A licence string that is not recognised is kept as the source wrote it,
with commercial_use "unclear". A missing licence is "unknown".

normalise(raw, url) returns a Licence:
  id              an SPDX identifier, an SPDX expression ("A AND B"), the source's own licence
                  name when there is no SPDX identifier, or "unknown"
  spdx            True when id is made only of SPDX identifiers
  commercial_use  "yes", "no" or "unclear"
  share_alike     True when the licence asks that derived work keeps the same licence
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Dict, Iterable, List, NamedTuple, Optional, Sequence, Set, Tuple, Union

UNKNOWN = "unknown"
MAX_NAME = 160


class Licence(NamedTuple):
    id: str
    spdx: bool
    commercial_use: str
    share_alike: bool


def _load_spdx() -> Dict[str, str]:
    path = Path(__file__).with_name("spdx_ids.txt")
    ids: Dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            ids[line.lower()] = line
    return ids


SPDX: Dict[str, str] = _load_spdx()

# Strings that mean "the source states no licence".
_NO_LICENCE = {
    "", "unknown", "none", "n/a", "na", "null", "notspecified", "not specified", "not-specified",
    "license-not-specified", "licence not specified", "license not specified", "unspecified",
    "no license", "no licence", "not stated", "not applicable", "undefined", "tbd", "-",
}

# Markers that sit in a rights list beside the licence but are not a licence.
_NOT_A_LICENCE = re.compile(
    r"^(open access|openaccess|info:eu-repo/semantics/\w+|closed access|restricted access|"
    r"embargoed access|copyright\b.*|©.*|\(c\).*|all rights reserved\.?)$",
    re.I,
)

# Aliases that are not plain SPDX identifiers. Lower case key.
_ALIASES: Dict[str, str] = {
    "cc0": "CC0-1.0", "cc-0": "CC0-1.0", "cc-zero": "CC0-1.0", "cc0 1.0": "CC0-1.0",
    "cc0-1.0 universal": "CC0-1.0", "cc0 1.0 universal": "CC0-1.0",
    "cc0: public domain": "CC0-1.0", "public domain (cc0)": "CC0-1.0",
    "public domain dedication (cc0)": "CC0-1.0", "creative commons zero": "CC0-1.0",
    "creative commons zero v1.0 universal": "CC0-1.0", "cc0 (public domain)": "CC0-1.0",
    "odc-by": "ODC-By-1.0", "odc by": "ODC-By-1.0", "odc-by 1.0": "ODC-By-1.0",
    "open data commons attribution license": "ODC-By-1.0",
    "open data commons attribution license v1.0": "ODC-By-1.0",
    "open data commons open database license v1.0": "ODbL-1.0",
    "open data commons public domain dedication and license v1.0": "PDDL-1.0",
    "gnu general public license version 3": "GPL-3.0",
    "gnu general public license version 2": "GPL-2.0",
    "gnu general public license v3": "GPL-3.0",
    "gnu lesser general public license v3.0": "LGPL-3.0",
    "gnu lesser general public license version 3": "LGPL-3.0",
    "mit license (mit)": "MIT",
    "open data commons attribution license (odc-by) v1.0": "ODC-By-1.0",
    "odbl": "ODbL-1.0", "odc-odbl": "ODbL-1.0", "odbl 1.0": "ODbL-1.0", "odbl-1.0": "ODbL-1.0",
    "open database license": "ODbL-1.0", "open data commons open database license": "ODbL-1.0",
    "open data commons open database license (odbl)": "ODbL-1.0",
    "open data commons open database license (odbl) v1.0": "ODbL-1.0",
    "database: open database, contents: database contents": "ODbL-1.0",
    "database: open database, contents: © original authors": "ODbL-1.0",
    "pddl": "PDDL-1.0", "odc-pddl": "PDDL-1.0", "odc pddl": "PDDL-1.0",
    "open data commons public domain dedication and license": "PDDL-1.0",
    "open data commons public domain dedication and license (pddl)": "PDDL-1.0",
    "lgpl-lr": "LGPLLR", "c-uda": "C-UDA-1.0", "o-uda": "O-UDA-1.0",
    "apache": "Apache-2.0", "apache 2.0": "Apache-2.0", "apache2": "Apache-2.0",
    "apache license 2.0": "Apache-2.0", "apache license, version 2.0": "Apache-2.0",
    "apache software license 2.0": "Apache-2.0", "apache-2": "Apache-2.0",
    "mit license": "MIT", "the mit license": "MIT", "mit licence": "MIT",
    "bsd 3-clause": "BSD-3-Clause", "bsd-3": "BSD-3-Clause", "bsd 3-clause license": "BSD-3-Clause",
    "new bsd": "BSD-3-Clause", "bsd 2-clause": "BSD-2-Clause", "bsd-2": "BSD-2-Clause",
    "gpl-2": "GPL-2.0", "gpl 2": "GPL-2.0", "gplv2": "GPL-2.0", "gpl 2.0": "GPL-2.0",
    "gpl-3": "GPL-3.0", "gpl 3": "GPL-3.0", "gplv3": "GPL-3.0", "gpl 3.0": "GPL-3.0",
    "gpl 3.0+": "GPL-3.0-or-later", "gpl 2.0+": "GPL-2.0-or-later",
    "gnu general public license v3.0": "GPL-3.0", "gnu general public license v2.0": "GPL-2.0",
    "agpl-3": "AGPL-3.0", "agplv3": "AGPL-3.0", "lgplv3": "LGPL-3.0", "lgpl 3.0": "LGPL-3.0",
    "lgpl 2.1": "LGPL-2.1", "mpl 2.0": "MPL-2.0", "mozilla public license 2.0": "MPL-2.0",
    "the unlicense": "Unlicense", "public domain mark 1.0": "CC-PDM-1.0",
    "artistic license 2.0": "Artistic-2.0", "artistic 2.0": "Artistic-2.0",
    "community data license agreement - sharing - version 1.0": "CDLA-Sharing-1.0",
    "community data license agreement - permissive - version 1.0": "CDLA-Permissive-1.0",
    "community data license agreement – permissive, version 2.0": "CDLA-Permissive-2.0",
    "community data license agreement - permissive - version 2.0": "CDLA-Permissive-2.0",
    "open government licence v3.0": "OGL-UK-3.0", "ogl-uk-3.0": "OGL-UK-3.0",
    "etalab open license 2.0": "etalab-2.0",
}

# Names without a version or variant, and source labels that are not a licence text. The value is
# (name we store, commercial_use, share_alike). "unclear" unless the label itself settles it.
_NAMED: Dict[str, Tuple[str, str, bool]] = {
    "cc": ("Creative Commons (variant not stated)", "unclear", False),
    "creative commons": ("Creative Commons (variant not stated)", "unclear", False),
    "bsd": ("BSD (variant not stated)", "yes", False),
    "gpl": ("GPL (version not stated)", "yes", True),
    "lgpl": ("LGPL (version not stated)", "yes", True),
    "agpl": ("AGPL (version not stated)", "yes", True),
    "gfdl": ("GFDL (version not stated)", "yes", True),
    "other": ("other (see source)", "unclear", False),
    "other-open": ("other (open, see source)", "unclear", False),
    "other-at": ("other (attribution, see source)", "unclear", False),
    "other-closed": ("other (closed, see source)", "unclear", False),
    "other-nc": ("other (non-commercial, see source)", "no", False),
    "other-pd": ("other (public domain, see source)", "yes", False),
    "other (specified in description)": ("other (see source)", "unclear", False),
    "public domain": ("Public domain (as stated by the source)", "yes", False),
    "publicdomain": ("Public domain (as stated by the source)", "yes", False),
    "pd": ("Public domain (as stated by the source)", "yes", False),
    "u.s. government works": ("U.S. Government Works", "unclear", False),
    "us government works": ("U.S. Government Works", "unclear", False),
    "public": ("Public (OpenML label)", "unclear", False),
    "publicly available": ("Publicly available (OpenML label)", "unclear", False),
    "openrail": ("OpenRAIL", "unclear", False),
    "openrail++": ("OpenRAIL++", "unclear", False),
    "bigscience-openrail-m": ("BigScience OpenRAIL-M", "unclear", False),
    "creativeml-openrail-m": ("CreativeML OpenRAIL-M", "unclear", False),
    "bigcode-openrail-m": ("BigCode OpenRAIL-M", "unclear", False),
    "bigscience-bloom-rail-1.0": ("BigScience BLOOM RAIL 1.0", "unclear", False),
    "data files © original authors": ("Data files © Original Authors (Kaggle label)", "unclear", False),
    "there are no restrictions on the use of this data": ("No restrictions on use (as stated by the source)", "yes", False),
    "no restrictions": ("No restrictions on use (as stated by the source)", "yes", False),
    "free for non-commercial use": ("Free for non-commercial use (as stated by the source)", "no", False),
    "academic use only": ("Academic use only (as stated by the source)", "no", False),
}

_PERMISSIVE = {
    "MIT", "MIT-0", "0BSD", "Apache-1.1", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause",
    "BSD-3-Clause-Clear", "BSD-4-Clause", "ISC", "Zlib", "BSL-1.0", "PostgreSQL", "NCSA",
    "AFL-3.0", "ECL-2.0", "Artistic-2.0", "PSF-2.0", "Python-2.0", "HPND", "W3C", "MS-PL",
    "OFL-1.1", "LPPL-1.3c", "MulanPSL-2.0", "Unlicense", "WTFPL", "CC0-1.0", "CC-PDM-1.0",
    "CC-PDDC", "PDDL-1.0", "NIST-PD", "ODC-By-1.0", "CDLA-Permissive-1.0", "CDLA-Permissive-2.0",
    "O-UDA-1.0", "etalab-2.0", "OGL-UK-1.0", "OGL-UK-2.0", "OGL-UK-3.0", "OGL-Canada-2.0",
    "NLOD-1.0", "NLOD-2.0", "DL-DE-BY-2.0", "DL-DE-ZERO-2.0", "OGDL-Taiwan-1.0", "UPL-1.0",
}
_COPYLEFT_PREFIX = (
    "GPL-", "AGPL-", "LGPL-", "LGPLLR", "MPL-", "EPL-", "EUPL-", "OSL-", "GFDL-", "CECILL-",
    "CDDL-", "ODbL-", "CDLA-Sharing-", "MS-RL", "RPL-", "SSPL-",
)
_CC = re.compile(r"^CC-BY(-NC)?(-SA|-ND)?-(\d\.\d)(-[A-Za-z]{2,3})?$")


def properties(spdx_id: str) -> Tuple[str, bool]:
    """(commercial_use, share_alike) for one SPDX identifier."""
    match = _CC.match(spdx_id)
    if match:
        return ("no" if match.group(1) else "yes", match.group(2) == "-SA")
    if spdx_id in _PERMISSIVE:
        return ("yes", False)
    if spdx_id.startswith(_COPYLEFT_PREFIX):
        return ("yes", True)
    return ("unclear", False)


_CC_URL = re.compile(
    r"creativecommons\.org/(licen[sc]es|publicdomain)/([a-z\-]+)/(\d\.\d)(?:/([a-z]{2,3}))?", re.I
)
_JURISDICTIONS = {"us": "US", "igo": "IGO", "uk": "UK", "au": "AU", "de": "DE", "nl": "NL", "at": "AT", "fr": "FR"}


def _cc_from_url(text: str) -> Optional[str]:
    match = _CC_URL.search(text)
    if not match:
        return None
    kind, code, version, place = match.group(1).lower(), match.group(2).lower(), match.group(3), match.group(4)
    if kind == "publicdomain":
        if code == "zero":
            return "CC0-1.0"
        if code == "mark":
            return "CC-PDM-1.0"
        return None
    candidate = "CC-" + code.upper() + "-" + version
    if place and place.lower() in _JURISDICTIONS:
        with_place = candidate + "-" + _JURISDICTIONS[place.lower()]
        if with_place.lower() in SPDX:
            return SPDX[with_place.lower()]
    return SPDX.get(candidate.lower())


_CC_WORDS = re.compile(r"\bcc\b|\bcc0\b|creative\s*commons|^attribution\b|\bcc[- ]?by\b|\bccby\b", re.I)


def _cc_from_words(text: str) -> Optional[Tuple[str, bool, str, bool]]:
    """Parse a Creative Commons licence written in words. Returns (id, spdx, commercial, sa)."""
    low = text.lower().replace("_", " ")
    if not _CC_WORDS.search(low):
        return None
    if re.search(r"\bcc[\s-]*0\b|cc[\s-]*zero|public\s*domain\s*dedication|\bzero\b", low):
        return ("CC0-1.0", True, "yes", False)
    by = bool(re.search(r"\bby\b|attribution|\bccby", low))
    if not by:
        return None
    nc = bool(re.search(r"\bnc\b|non[\s-]*commercial|by-?nc", low))
    sa = bool(re.search(r"\bsa\b|share[\s-]*alike|-sa\b", low))
    nd = bool(re.search(r"\bnd\b|no[\s-]*deriv", low))
    code = "CC-BY" + ("-NC" if nc else "") + ("-SA" if sa else "-ND" if nd else "")
    version = re.search(r"(?<![\d.])([1-4]\.[05])(?![\d])", low)
    commercial, share = ("no" if nc else "yes"), sa
    if not version:
        bare = re.search(r"(?<![\d.])v?([1-4])(?:\s|$|\))", low)
        if bare and re.search(r"\bv(ersion)?\s*[1-4]\b|by[\s-]*[1-4]\b|(sa|nc|nd)[\s-]*[1-4]\b", low):
            version_text = bare.group(1) + ".0"
        else:
            return (code + " (version not stated)", False, commercial, share)
    else:
        version_text = version.group(1)
    candidate = code + "-" + version_text
    for word, tag in (("igo", "IGO"), ("united states", "US"), ("us", "US")):
        if re.search(r"\b" + word + r"\b", low) and (candidate + "-" + tag).lower() in SPDX:
            return (SPDX[(candidate + "-" + tag).lower()], True, commercial, share)
    if candidate.lower() in SPDX:
        return (SPDX[candidate.lower()], True, commercial, share)
    return (candidate, False, commercial, share)


_KNOWN_URLS: Dict[str, str] = {
    "opensource.org/licenses/mit": "MIT",
    "opensource.org/license/mit": "MIT",
    "apache.org/licenses/license-2.0": "Apache-2.0",
    "opensource.org/licenses/apache-2.0": "Apache-2.0",
    "opensource.org/licenses/bsd-3-clause": "BSD-3-Clause",
    "opensource.org/licenses/bsd-2-clause": "BSD-2-Clause",
    "gnu.org/licenses/gpl-3.0": "GPL-3.0",
    "gnu.org/licenses/gpl-2.0": "GPL-2.0",
    "gnu.org/licenses/agpl-3.0": "AGPL-3.0",
    "gnu.org/licenses/lgpl-3.0": "LGPL-3.0",
    "opendatacommons.org/licenses/odbl": "ODbL-1.0",
    "opendatacommons.org/licenses/by": "ODC-By-1.0",
    "opendatacommons.org/licenses/pddl": "PDDL-1.0",
    "cdla.io/permissive-1-0": "CDLA-Permissive-1.0",
    "cdla.dev/permissive-2-0": "CDLA-Permissive-2.0",
    "cdla.io/sharing-1-0": "CDLA-Sharing-1.0",
    "nationalarchives.gov.uk/doc/open-government-licence/version/3": "OGL-UK-3.0",
    "unlicense.org": "Unlicense",
}


_HEDGED = re.compile(
    r"\bnot\s+(specified|stated|licen[sc]ed|given|provided|clear)\b|\bunspecified\b|\bexcept\b|\bunless\b"
    r"|\bvar(y|ies|ious)\b|\bmultiple\b|\bmixed\b|\bsome\s+(data|files|parts|datasets)\b|\bdepend(s|ing)?\b"
    r"|\bmost\s+data\b|\bper[\s-]dataset\b|\bsee\s+(each|individual)\b",
    re.I,
)


# Words that may stand in a plain licence statement. A text with any other word says more than
# "this licence" ("... with added limits", "... free for non-commercial purposes", "... for the
# code") and is kept as written.
_LICENCE_WORDS = {
    "creative", "commons", "cc", "ccby", "by", "nc", "sa", "nd", "attribution", "noncommercial", "non", "commercial",
    "sharealike", "share", "alike", "noderivatives", "noderivs", "no", "derivatives", "derivs", "derivative",
    "works", "international", "intl", "unported", "generic", "universal", "public", "domain", "dedication",
    "license", "licence", "licensed", "licenses", "licences", "deed", "legal", "code", "legalcode", "version", "v",
    "the", "a", "an", "under", "is", "are", "this", "dataset", "data", "work", "available", "released",
    "distributed", "terms", "of", "and", "igo", "us", "united", "states", "uk", "zero", "mark", "see", "at",
    "open", "odc", "odbl", "pddl", "database", "apache", "mit", "software", "gnu", "general", "gpl", "lgpl", "agpl",
    "lesser", "affero", "bsd", "clause", "new", "or", "later", "only",
}
_URL_IN_TEXT = re.compile(r"https?://\S+")


def _plain_statement(text: str) -> bool:
    """True when the text is only a licence name (and maybe its URL), with no other words."""
    words = re.findall(r"[a-z]+", _URL_IN_TEXT.sub(" ", text.lower()))
    return all(word in _LICENCE_WORDS for word in words)


def _one(raw: str) -> Licence:
    text = re.sub(r"\s+", " ", raw).strip().strip(".").strip()
    link = re.fullmatch(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", text)
    if link:  # a Markdown link: the label is the licence name, the target may be a licence URL
        by_label = _one(link.group(1))
        if by_label.spdx:
            return by_label
        by_target = _one(link.group(2))
        return by_target if by_target.spdx else by_label
    low = text.lower()
    if low.startswith("license:") or low.startswith("licence:"):
        text = text.split(":", 1)[1].strip()
        low = text.lower()
    if low in _NO_LICENCE:
        return Licence(UNKNOWN, False, "unclear", False)
    if low in SPDX:
        commercial, share = properties(SPDX[low])
        return Licence(SPDX[low], True, commercial, share)
    if low in _ALIASES:
        commercial, share = properties(_ALIASES[low])
        return Licence(_ALIASES[low], True, commercial, share)
    if low in _NAMED:
        name, commercial, share = _NAMED[low]
        return Licence(name, False, commercial, share)
    if _HEDGED.search(low):
        # A sentence that qualifies the licence ("not specified", "varies", "except ...") is kept
        # as written. Reading a licence out of it would be a guess.
        name = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text).strip()
        return Licence(name[:MAX_NAME], False, "unclear", False)
    if _plain_statement(text):
        from_url = _cc_from_url(text)
        if from_url:
            commercial, share = properties(from_url)
            return Licence(from_url, True, commercial, share)
        for fragment, spdx_id in _KNOWN_URLS.items():
            if fragment in low:
                commercial, share = properties(spdx_id)
                return Licence(spdx_id, True, commercial, share)
        words = _cc_from_words(_URL_IN_TEXT.sub(" ", text))
        if words:
            return Licence(*words)
    name = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text).strip()  # Markdown links keep their label
    return Licence((name or text)[:MAX_NAME], False, "unclear", False)


def normalise(raw: Union[str, Sequence[str], None], url: Optional[str] = None) -> Licence:
    """Normalise a licence string, a list of rights statements, or a licence URL."""
    values: List[str] = []
    if isinstance(raw, str):
        values = [raw]
    elif raw:
        values = [str(v) for v in raw if v is not None]
    split: List[str] = []
    for value in values:  # "A AND B" is two licences when both parts are known identifiers
        pieces = [p.strip() for p in value.split(" AND ")]
        split.extend(pieces if len(pieces) > 1 and all(_one(p).spdx for p in pieces) else [value])
    values = split
    found: List[Licence] = []
    for value in values:
        value = value.strip()
        if not value or _NOT_A_LICENCE.match(value):
            continue
        found.append(_one(value))
    if url and not any(item.spdx for item in found):
        from_url = _one(url)
        if from_url.spdx:
            found = [from_url]
    known = [item for item in found if item.id != UNKNOWN]
    if not known:
        return Licence(UNKNOWN, False, "unclear", False)
    unique: List[Licence] = []
    for item in known:
        if item.id not in [u.id for u in unique]:
            unique.append(item)
    if len(unique) > 1 and any(item.spdx for item in unique):
        # A rights list often repeats the licence in words next to its identifier.
        unique = [item for item in unique if item.spdx]
    if len(unique) == 1:
        return unique[0]
    unique.sort(key=lambda item: item.id)
    if any(item.commercial_use == "no" for item in unique):
        commercial = "no"
    elif all(item.commercial_use == "yes" for item in unique):
        commercial = "yes"
    else:
        commercial = "unclear"
    return Licence(
        " AND ".join(item.id for item in unique)[: MAX_NAME * 2],
        all(item.spdx for item in unique),
        commercial,
        any(item.share_alike for item in unique),
    )


def check_consistent(licence_id: str, commercial_use: str, share_alike: bool) -> Optional[str]:
    """None when the three fields agree with what the licence identifier implies; else the reason."""
    parts = licence_id.split(" AND ")
    if not all(part.lower() in SPDX for part in parts):
        return None  # a licence name: the flags come from the source or stay "unclear"
    flags = [properties(part) for part in parts]
    if any(flag[0] == "no" for flag in flags):
        expected = "no"
    elif all(flag[0] == "yes" for flag in flags):
        expected = "yes"
    else:
        expected = "unclear"
    if commercial_use != expected:
        return f"commercial_use is {commercial_use!r} but {licence_id} implies {expected!r}"
    if share_alike != any(flag[1] for flag in flags):
        return f"share_alike is {share_alike!r} but {licence_id} implies {not share_alike!r}"
    return None


# ---------------------------------------------------------------------------------------------
# Finding licence statements in a page (used by the sample check)
# ---------------------------------------------------------------------------------------------

_PAGE_PATTERNS: List[Tuple[re.Pattern, str]] = [
    (re.compile(r"\bCC[\s-]?0\b|\bCC[\s-]?zero\b|Creative Commons Zero|Public Domain Dedication", re.I), "CC0-1.0"),
    (re.compile(r"Open Database Licen[sc]e|\bODbL\b", re.I), "ODbL-1.0"),
    (re.compile(r"\bODC[\s-]By\b|Open Data Commons Attribution", re.I), "ODC-By-1.0"),
    (re.compile(r"\bPDDL\b", re.I), "PDDL-1.0"),
    (re.compile(r"\bMIT\s+Licen[sc]e\b|\blicen[sc]e[:\s\"']+MIT\b", re.I), "MIT"),
    (re.compile(r"Apache(\s+Software)?\s+Licen[sc]e,?\s+(Version\s+)?2\.0|\bApache[\s-]2\.0\b", re.I), "Apache-2.0"),
    (re.compile(r"\bGPL[\s-]?v?3|GNU General Public Licen[sc]e v(ersion )?3", re.I), "GPL-3.0"),
    (re.compile(r"\bCDLA[\s-]Permissive[\s-]2\.0", re.I), "CDLA-Permissive-2.0"),
    (re.compile(r"\bCDLA[\s-]Sharing[\s-]1\.0", re.I), "CDLA-Sharing-1.0"),
]
_PAGE_CC = re.compile(
    r"\bCC[\s\-_]BY(?:[\s\-_](?:NC|SA|ND))*(?:[\s\-_]v?\d\.\d)?"
    r"|Creative\s+Commons\s+Attribution[\w\s\-–,]{0,60}?(?:\d\.\d)"
    r"|Attribution(?:[\s\-–]+(?:Non[\s-]?Commercial|Share[\s-]?Alike|No[\s-]?Deriv\w*))*\s+\d\.\d",
    re.I,
)


def family(licence_id: str) -> str:
    """A licence identifier without version and jurisdiction, for a tolerant comparison."""
    out = []
    for part in licence_id.split(" AND "):
        match = re.match(r"^(CC-BY(?:-NC)?(?:-SA|-ND)?)", part)
        if match:
            out.append(match.group(1))
        else:
            out.append(re.sub(r"-(\d+(\.\d+)*)(-only|-or-later)?$", "", part))
    return " AND ".join(out)


def detect(page_text: str) -> Set[str]:
    """Licence identifiers that a page states, found by pattern. Used to re-check a record."""
    found: Set[str] = set()
    for match in _CC_URL.finditer(page_text):
        hit = _cc_from_url(match.group(0))
        if hit:
            found.add(hit)
    for match in _PAGE_CC.finditer(page_text):
        words = _cc_from_words(match.group(0))
        if words:
            found.add(words[0])
    for pattern, spdx_id in _PAGE_PATTERNS:
        if pattern.search(page_text):
            found.add(spdx_id)
    for match in re.finditer(r'"license"\s*:\s*"([^"]{2,80})"|license:([a-z0-9.\-+]{2,40})', page_text):
        value = match.group(1) or match.group(2)
        licence = _one(value)
        if licence.spdx:
            found.add(licence.id)
    return found


def summarise(ids: Iterable[str]) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for licence_id in ids:
        counts[licence_id] = counts.get(licence_id, 0) + 1
    return dict(sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])))
