#!/usr/bin/env python3
"""Fetch science-QA evaluation datasets for the agent swarm, into glhf/data/.

These are *benchmark* datasets (questions with known answers), used to measure the
swarm — not training data. Nothing here is uploaded into a model. Each dataset is
pinned to a revision so a run is reproducible, mirroring bixbench_v1/dataset.py.

Usage:
  python glhf/scripts/fetch_eval_data.py --list
  python glhf/scripts/fetch_eval_data.py --all
  python glhf/scripts/fetch_eval_data.py lab-bench gpqa --sample 5
  python glhf/scripts/fetch_eval_data.py pubmedqa --dest /tmp/evaldata

Requires: pip install "huggingface_hub>=0.23" "datasets>=2.19"
Gated sets (gpqa) need: huggingface-cli login  (and accept terms on the dataset page)
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, field
from pathlib import Path

# glhf/data/ is already gitignored ("Benchmark data and run outputs (never commit)").
DEFAULT_DEST = Path(__file__).resolve().parents[1] / "data"


@dataclass(frozen=True)
class EvalDataset:
    key: str  # cli name / folder name
    repo_id: str  # Hugging Face dataset id
    revision: str  # pinned commit/tag; "main" if no stable tag is published
    config: str | None = None  # datasets config (subset) to load
    split: str = "train"  # split to sample from
    note: str = ""
    # files-only download (snapshot) instead of the `datasets` loader
    file_patterns: list[str] = field(default_factory=list)


# Pins: replace "main" with a commit hash once you lock a run (see dataset.py's HF_REVISION).
REGISTRY: dict[str, EvalDataset] = {
    d.key: d
    for d in [
        EvalDataset(
            key="lab-bench",
            repo_id="futurehouse/lab-bench",
            revision="main",
            config="LitQA2",  # also: SeqQA, FigQA, TableQA, ProtocolQA, DbQA, SuppQA, CloningScenarios
            split="train",
            note="FutureHouse LAB-Bench: literature/protocol/db research skills. Best fit.",
        ),
        EvalDataset(
            key="gpqa",
            repo_id="Idavidrein/gpqa",
            revision="main",
            config="gpqa_diamond",  # also: gpqa_main, gpqa_extended
            split="train",
            note="Graduate 'Google-proof' bio/chem/physics MCQs. GATED: login + accept terms.",
        ),
        EvalDataset(
            key="pubmedqa",
            repo_id="qiaojin/PubMedQA",
            revision="main",
            config="pqa_labeled",  # also: pqa_artificial, pqa_unlabeled
            split="train",
            note="Biomedical yes/no/maybe QA over abstracts.",
        ),
        EvalDataset(
            key="sciq",
            repo_id="allenai/sciq",
            revision="main",
            split="train",
            note="Easy science MCQs with supporting text. Cheap smoke tests / demos.",
        ),
        # BixBench is handled by bixbench_v1/dataset.py:download() (zips + grading key).
        # Listed here for discovery; use the existing adapter for real runs.
        EvalDataset(
            key="bixbench",
            repo_id="futurehouse/BixBench",
            revision="f8cc3bdcc6357c88b8c3648306522b9c422dc95a",
            file_patterns=["BixBench.jsonl", "*.zip"],
            note="Core benchmark. Prefer bixbench_v1.dataset.download() for runs.",
        ),
    ]
}


def fetch(ds: EvalDataset, dest: Path, sample: int) -> None:
    out = dest / ds.key
    out.mkdir(parents=True, exist_ok=True)

    if ds.file_patterns:
        from huggingface_hub import snapshot_download

        snapshot_download(
            repo_id=ds.repo_id,
            repo_type="dataset",
            revision=ds.revision,
            local_dir=str(out),
            allow_patterns=ds.file_patterns,
        )
        print(f"  files -> {out}")
        return

    from datasets import load_dataset

    data = load_dataset(
        ds.repo_id,
        ds.config,
        revision=ds.revision,
    )
    # Save the whole thing to disk (Arrow format, fast reload with load_from_disk).
    data.save_to_disk(str(out / "hf_dataset"))
    print(f"  dataset -> {out / 'hf_dataset'}  splits={list(data.keys())}")

    if sample > 0:
        split = ds.split if ds.split in data else next(iter(data))
        rows = data[split].select(range(min(sample, len(data[split]))))
        sample_path = out / "sample.json"
        sample_path.write_text(
            json.dumps([dict(r) for r in rows], indent=2, default=str, ensure_ascii=False),
            encoding="utf-8",
        )
        print(f"  sample ({len(rows)} rows) -> {sample_path}")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("datasets", nargs="*", help="dataset keys to fetch (see --list)")
    p.add_argument("--all", action="store_true", help="fetch every dataset in the registry")
    p.add_argument("--list", action="store_true", help="show available datasets and exit")
    p.add_argument("--dest", type=Path, default=DEFAULT_DEST, help=f"output dir (default: {DEFAULT_DEST})")
    p.add_argument("--sample", type=int, default=3, help="rows to dump to sample.json (0 = none)")
    args = p.parse_args()

    if args.list or (not args.datasets and not args.all):
        width = max(len(k) for k in REGISTRY)
        for key, ds in REGISTRY.items():
            cfg = f" [{ds.config}]" if ds.config else ""
            print(f"  {key:<{width}}  {ds.repo_id}{cfg}\n  {'':<{width}}  {ds.note}")
        if not args.list:
            print("\nNothing fetched. Pass dataset keys or --all.")
        return

    keys = list(REGISTRY) if args.all else args.datasets
    for key in keys:
        if key not in REGISTRY:
            raise SystemExit(f"unknown dataset {key!r}; try --list")
        print(f"[{key}] {REGISTRY[key].repo_id}")
        fetch(REGISTRY[key], args.dest, args.sample)
    print(f"\nDone. Data in {args.dest} (gitignored).")


if __name__ == "__main__":
    main()
