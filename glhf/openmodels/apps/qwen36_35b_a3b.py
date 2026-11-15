"""Qwen3.6-35B-A3B (FP8) behind an OpenAI-compatible vLLM server on one Modal GPU.

    modal run    apps/weights.py::fetch --repo ... --revision ...   # weights -> Volume, on CPU, once
    modal deploy apps/qwen36_35b_a3b.py             # the server; scales to zero when idle
    modal app stop -y openmodels-qwen36-35b-a3b     # stop it for good

Use `uv run openmodels check|grid` and not these commands directly: they add the paid-calls
guard, the cost ledger and the stop on error.

The pattern is Modal's vLLM example (modal.com/docs/examples/llm_inference): vLLM started with
`subprocess.Popen` inside an `@app.server` class, weights cached in a Volume. Differences:
- The endpoint is NOT public. `unauthenticated=True` is left out, so Modal's proxy asks for a
  proxy token (`Authorization: Bearer wk-...ws-...`) on every path and answers 401 without it,
  before the request can wake a GPU.
- One container at most, none kept warm, and it scales down after 5 idle minutes.
- The weights are downloaded by a CPU function (apps/weights.py), and the server runs with the Hugging Face hub
  offline, so GPU time is never spent on a download.
The constants below are checked against ../models.yaml by a test.
"""

import json
import subprocess

import modal

APP_NAME = "openmodels-qwen36-35b-a3b"
MODEL = "Qwen/Qwen3.6-35B-A3B-FP8"  # Apache-2.0, not gated; 37.5 GB of weights
REVISION = "c653bba46dfa06e9658dcc0b0dc87fe4685f14a2"  # pinned: the repo can change
GPU = "L40S"  # 48 GB. The weights take 35 GiB; the rest holds the context (see below)
GPU_COUNT = 1
CPU = 4
MEMORY_GIB = 32

# The agents compact their context at 100,000 tokens, so 131,072 leaves room for one more call.
# The model's own limit is 262,144. Only 10 of its 40 layers keep a per-token cache (about
# 20 KB a token), so 131,072 tokens need about 2.7 GB of GPU memory.
CONTEXT_LENGTH = 131_072
MAX_OUTPUT_TOKENS = 16_384  # default cap on one reply (thinking included) when a request sets none
TOOL_CALL_PARSER = (
    "qwen3_coder"  # vLLM's recipe for this model (recipes.vllm.ai/Qwen/Qwen3.6-35B-A3B)
)
REASONING_PARSER = "qwen3"  # thinking is on, as the model ships; it comes back as reasoning content

VLLM_VERSION = "0.33.0"
PORT = 8000
MIN_CONTAINERS = 0  # nothing kept warm
MAX_CONTAINERS = 1
SCALEDOWN_SECONDS = 300
STARTUP_TIMEOUT_SECONDS = 1200

image = (
    modal.Image.from_registry("nvidia/cuda:12.9.0-devel-ubuntu22.04", add_python="3.12")
    .entrypoint([])
    .uv_pip_install(f"vllm=={VLLM_VERSION}", "huggingface-hub")
    .env({"HF_XET_HIGH_PERFORMANCE": "1"})
)
hf_cache = modal.Volume.from_name("openmodels-hf-cache", create_if_missing=True)
vllm_cache = modal.Volume.from_name("openmodels-vllm-cache", create_if_missing=True)
VOLUMES = {"/root/.cache/huggingface": hf_cache, "/root/.cache/vllm": vllm_cache}

app = modal.App(APP_NAME)


def serve_command() -> list[str]:
    return [
        "vllm", "serve", MODEL,
        "--revision", REVISION,
        "--served-model-name", MODEL,
        "--host", "0.0.0.0",
        "--port", str(PORT),
        "--tensor-parallel-size", str(GPU_COUNT),
        "--max-model-len", str(CONTEXT_LENGTH),
        "--override-generation-config", json.dumps({"max_new_tokens": MAX_OUTPUT_TOKENS}),
        "--gpu-memory-utilization", "0.94",
        "--max-num-seqs", "4",  # the harness sends one request at a time; a small batch saves memory
        "--language-model-only",  # no image or video input: text only
        "--trust-remote-code",
        "--enable-auto-tool-choice",
        "--tool-call-parser", TOOL_CALL_PARSER,
        "--reasoning-parser", REASONING_PARSER,
        "--uvicorn-log-level=info",
    ]  # fmt: skip


@app.server(
    image=image.env({"HF_HUB_OFFLINE": "1"}),  # never download on GPU time
    gpu=f"{GPU}:{GPU_COUNT}",
    cpu=CPU,
    memory=MEMORY_GIB * 1024,
    volumes=VOLUMES,
    port=PORT,
    startup_timeout=STARTUP_TIMEOUT_SECONDS,
    scaledown_window=SCALEDOWN_SECONDS,
    min_containers=MIN_CONTAINERS,
    max_containers=MAX_CONTAINERS,
    # unauthenticated is left at its default (False): a proxy token is required.
)
class Server:
    @modal.enter()
    def start(self) -> None:
        command = serve_command()
        print(*command)
        self.process = subprocess.Popen(command)

    @modal.exit()
    def stop(self) -> None:
        self.process.terminate()
