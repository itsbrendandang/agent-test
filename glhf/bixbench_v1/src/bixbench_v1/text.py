"""Answer text helpers shared by the grader and the answer ledger."""

from __future__ import annotations

import math
import re

_PLAIN = re.compile(r"^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$")
_THOUSANDS = re.compile(r"^[-+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$")
_TIMES_TEN = re.compile(
    r"^([-+]?(?:\d+(?:\.\d*)?|\.\d+))\s*[x\u00d7*]\s*10\s*\^?\s*\(?([-+]?\d+)\)?$"
)


def normalise(text: str) -> str:
    """The official string cleaning (bixbench/graders.py): letters and digits only, lower case."""
    return re.sub(r"[^a-zA-Z0-9]", "", text).lower()


def _numeric_literal(text: str) -> str | None:
    """`text` as a plain float literal if it is one number and nothing else, or None.

    Accepts a trailing percent sign, thousands separators (4,550), a unicode minus and the
    forms 1.9E-05 and 1.9 x 10^-5. Words, units and several numbers are not a number."""
    cleaned = text.strip().replace("\u2212", "-").replace("\u00a0", " ")
    cleaned = cleaned.removesuffix("%").strip()
    if _THOUSANDS.match(cleaned):
        cleaned = cleaned.replace(",", "")
    power = _TIMES_TEN.match(cleaned)
    if power:
        cleaned = f"{power.group(1)}e{power.group(2)}"
    return cleaned if _PLAIN.match(cleaned) else None


def parse_number(text: str) -> float | None:
    literal = _numeric_literal(text)
    if literal is None:
        return None
    value = float(literal)
    return value if math.isfinite(value) else None


def significant_digits(text: str) -> int | None:
    """Significant digits written in a numeric answer (trailing zeros of an integer do not count)."""
    literal = _numeric_literal(text)
    if literal is None:
        return None
    mantissa = re.split(r"[eE]", literal.lstrip("+-"))[0]
    if "." not in mantissa:
        mantissa = mantissa.rstrip("0") or "0"
    digits = mantissa.replace(".", "").lstrip("0")
    return max(1, len(digits))


def round_significant(value: float, digits: int) -> float:
    if value == 0:
        return 0.0
    return round(value, digits - 1 - math.floor(math.log10(abs(value))))
