#!/usr/bin/env python3
"""Autoresearch: the AI picks its own experiments on a dataset, runs them, and reports findings.

Point it at a CSV/TSV. It:
  1. profiles the columns (types, basic stats),
  2. asks the model to propose its own testable hypotheses, each as a SAFE analysis
     (a correlation, or a two-group comparison) over named columns,
  3. runs each analysis itself with pandas/scipy (a fixed, safe menu -- no arbitrary code),
  4. asks the model to interpret the results and say what holds up and what is uncertain.

This is a STANDALONE demo tool. It does NOT touch the BixBench3 swarm or any benchmark code.
It is the "AI runs experiments independently" idea in a small, safe form.

Setup:
  pip install pandas scipy
  # put your key in .env at the repo root (gitignored): ANTHROPIC_API_KEY=sk-ant-...

Usage:
  python3 glhf/scripts/autoresearch.py --data mydata.csv
  python3 glhf/scripts/autoresearch.py --data mydata.tsv --n 4 --model claude-3-5-sonnet-20241022
  python3 glhf/scripts/autoresearch.py --data mydata.csv --dry-run   # profile + prompt only, no API
"""

from __future__ import annotations

import argparse
import json
import os
import re
import urllib.request
from pathlib import Path

import pandas as pd

REPO = Path(__file__).resolve().parents[2]
OUT_ROOT = REPO / "glhf" / "data" / "autoresearch"


def load_dotenv() -> None:
    env = REPO / ".env"
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def claude(prompt: str, model: str, max_tokens: int = 1500) -> str:
    load_dotenv()
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise SystemExit("ANTHROPIC_API_KEY not set. Add it to .env at the repo root, or use --dry-run.")
    body = json.dumps({"model": model, "max_tokens": max_tokens,
                       "messages": [{"role": "user", "content": prompt}]}).encode()
    req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=body,
                                 headers={"x-api-key": key, "anthropic-version": "2023-06-01",
                                          "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=90) as resp:
        out = json.loads(resp.read())
    return "".join(b.get("text", "") for b in out.get("content", []))


def profile(df: pd.DataFrame, max_cols: int = 40) -> dict:
    """A compact, model-readable description of the dataset's columns."""
    cols = []
    for name in list(df.columns)[:max_cols]:
        s = df[name]
        numeric = pd.api.types.is_numeric_dtype(s)
        info = {"name": str(name), "kind": "numeric" if numeric else "categorical",
                "n_missing": int(s.isna().sum())}
        if numeric:
            d = s.describe()
            info |= {"min": round(float(d["min"]), 4), "max": round(float(d["max"]), 4),
                     "mean": round(float(d["mean"]), 4)}
        else:
            vc = s.astype("string").value_counts().head(6)
            info["top_values"] = {str(k): int(v) for k, v in vc.items()}
            info["n_unique"] = int(s.nunique())
        cols.append(info)
    return {"rows": int(len(df)), "columns": cols}


PROPOSE_PROMPT = """You are a data scientist. Here is a dataset profile (JSON):

{profile}

Propose {n} testable hypotheses you can investigate with THIS data. For each, choose ONE safe analysis:
  - "correlation": relationship between two NUMERIC columns -> fields: x, y
  - "group_compare": difference in a NUMERIC column between two groups of a CATEGORICAL column
       -> fields: value (numeric col), group (categorical col)

Return ONLY a JSON array, each item:
{{"hypothesis": "...", "analysis": "correlation"|"group_compare",
  "x": "...", "y": "...",            // for correlation
  "value": "...", "group": "..."}}   // for group_compare
Use exact column names from the profile. No prose outside the JSON."""


def run_correlation(df: pd.DataFrame, x: str, y: str) -> dict:
    from scipy import stats
    sub = df[[x, y]].dropna()
    if len(sub) < 3:
        return {"ok": False, "why": "not enough non-missing rows"}
    r, p = stats.pearsonr(sub[x], sub[y])
    return {"ok": True, "n": int(len(sub)), "pearson_r": round(float(r), 4),
            "p_value": round(float(p), 6)}


def run_group_compare(df: pd.DataFrame, value: str, group: str) -> dict:
    from scipy import stats
    sub = df[[value, group]].dropna()
    groups = sub[group].astype("string").value_counts()
    if len(groups) < 2:
        return {"ok": False, "why": "fewer than two groups"}
    a_name, b_name = groups.index[0], groups.index[1]
    a = sub[sub[group].astype("string") == a_name][value]
    b = sub[sub[group].astype("string") == b_name][value]
    if len(a) < 2 or len(b) < 2:
        return {"ok": False, "why": "a group has fewer than two rows"}
    t, p = stats.ttest_ind(a, b, equal_var=False)
    return {"ok": True, "group_a": str(a_name), "group_b": str(b_name),
            "mean_a": round(float(a.mean()), 4), "mean_b": round(float(b.mean()), 4),
            "t": round(float(t), 4), "p_value": round(float(p), 6)}


def run_one(df: pd.DataFrame, exp: dict) -> dict:
    kind = exp.get("analysis")
    cols = set(df.columns.astype(str))
    try:
        if kind == "correlation":
            x, y = str(exp.get("x")), str(exp.get("y"))
            if x not in cols or y not in cols:
                return {"ok": False, "why": f"unknown column(s): {x}, {y}"}
            return run_correlation(df, x, y)
        if kind == "group_compare":
            v, g = str(exp.get("value")), str(exp.get("group"))
            if v not in cols or g not in cols:
                return {"ok": False, "why": f"unknown column(s): {v}, {g}"}
            return run_group_compare(df, v, g)
        return {"ok": False, "why": f"unknown analysis {kind!r}"}
    except Exception as e:
        return {"ok": False, "why": f"analysis error: {e}"}


def extract_json(text: str) -> list:
    m = re.search(r"\[.*\]", text, re.DOTALL)
    return json.loads(m.group(0)) if m else []


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--data", required=True, type=Path, help="CSV or TSV file")
    p.add_argument("--n", type=int, default=3, help="hypotheses to propose (default 3)")
    p.add_argument("--model", default="claude-3-5-sonnet-20241022", help="Anthropic model id")
    p.add_argument("--dry-run", action="store_true", help="profile + show the prompt; no API call")
    args = p.parse_args()

    sep = "\t" if args.data.suffix.lower() in (".tsv", ".tab") else ","
    df = pd.read_csv(args.data, sep=sep)
    prof = profile(df)
    print(f"Dataset: {args.data.name}  ({prof['rows']} rows, {len(prof['columns'])} columns)")

    propose = PROPOSE_PROMPT.format(profile=json.dumps(prof, indent=2), n=args.n)
    if args.dry_run:
        print("\n--- profile ---\n" + json.dumps(prof, indent=2))
        print("\n--- prompt the model would get ---\n" + propose)
        return

    print("\n[1/3] AI proposing its own experiments...")
    experiments = extract_json(claude(propose, args.model))
    if not experiments:
        raise SystemExit("The model did not return usable experiments. Try --n 3 or another model.")

    print(f"[2/3] Running {len(experiments)} experiments (safe analyses)...")
    results = []
    for i, exp in enumerate(experiments, 1):
        res = run_one(df, exp)
        results.append({"experiment": exp, "result": res})
        tag = "OK" if res.get("ok") else f"skipped ({res.get('why')})"
        print(f"  {i}. {exp.get('hypothesis', '')[:70]} -> {tag}")

    print("[3/3] AI interpreting the results...")
    interpret = (
        "You proposed these experiments and here are the computed results (JSON). Write a short "
        "report: for each, state what the data shows, whether it supports the hypothesis, and how "
        "confident you are. Flag anything uncertain or underpowered. Be honest about nulls.\n\n"
        + json.dumps(results, indent=2)
    )
    report_text = claude(interpret, args.model, max_tokens=1800)

    OUT_ROOT.mkdir(parents=True, exist_ok=True)
    stem = args.data.stem
    (OUT_ROOT / f"{stem}.results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    (OUT_ROOT / f"{stem}.report.md").write_text(
        f"# Autoresearch report: {args.data.name}\n\n{report_text}\n", encoding="utf-8")

    print("\n===== REPORT =====\n")
    print(report_text)
    print(f"\nSaved: {OUT_ROOT / (stem + '.report.md')} and .results.json")


if __name__ == "__main__":
    main()
