"""CPU-only helpers for every model: fetch weights into the Volume, and ask vLLM which flags it
knows. No GPU is used, so this app can run before any GPU is paid for.

    modal run apps/weights.py::fetch --repo Qwen/Qwen3.6-35B-A3B-FP8 --revision <40 hex>
    modal run apps/weights.py::flags --names=--tool-call-parser,qwen3_coder

Use `uv run openmodels weights|preflight --model NAME`: they add the paid-calls guard and the
ledger line. The image is the same as the serving apps' image (same vLLM version), so the cached
weights and the flag check hold for them.
"""

import json

import modal

VLLM_VERSION = "0.33.0"  # keep in step with the serving apps

image = (
    modal.Image.from_registry("nvidia/cuda:12.9.0-devel-ubuntu22.04", add_python="3.12")
    .entrypoint([])
    .uv_pip_install(f"vllm=={VLLM_VERSION}", "huggingface-hub")
    .env({"HF_XET_HIGH_PERFORMANCE": "1"})
)
hf_cache = modal.Volume.from_name("openmodels-hf-cache", create_if_missing=True)

app = modal.App("openmodels-weights")


@app.function(
    image=image, volumes={"/root/.cache/huggingface": hf_cache}, cpu=4, memory=8192, timeout=3600
)
def download(repo: str, revision: str) -> dict:
    """Fetch one pinned revision. No token is used, so a gated repo fails here. Safe to repeat."""
    import os

    from huggingface_hub import snapshot_download

    path = snapshot_download(repo, revision=revision)
    hf_cache.commit()
    size = sum(os.path.getsize(os.path.join(d, f)) for d, _, files in os.walk(path) for f in files)
    return {"path": path, "gigabytes": round(size / 1e9, 2)}


@app.function(image=image, cpu=2, memory=8192, timeout=900)
def known(names: list[str]) -> dict:
    """For each flag or parser name: does the installed vLLM's source define it? (`vllm serve
    --help` cannot be used here: without a GPU vLLM stops with "Failed to infer device type".)
    A flag `--max-model-len` counts as known when the source has `--max-model-len` or the field
    `max_model_len`; a parser name when the source has it in quotes."""
    import re
    from importlib.metadata import version
    from pathlib import Path

    import vllm

    text = "\n".join(p.read_text(errors="ignore") for p in Path(vllm.__file__).parent.rglob("*.py"))
    found = {}
    for name in names:
        if name.startswith("--"):
            field = name[2:].replace("-", "_")
            found[name] = (
                name in text or re.search(rf"\b{re.escape(field)}\b\s*[:=]", text) is not None
            )
        else:
            found[name] = f'"{name}"' in text or f"'{name}'" in text
    return {"vllm": version("vllm"), "known": found}


@app.local_entrypoint()
def fetch(repo: str, revision: str) -> None:
    print("RESULT " + json.dumps(download.remote(repo, revision)))


@app.local_entrypoint()
def flags(names: str) -> None:
    print("RESULT " + json.dumps(known.remote(names.split(","))))
