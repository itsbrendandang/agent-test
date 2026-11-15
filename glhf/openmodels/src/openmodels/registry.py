"""The model registry (models.yaml): which models the grid can run, where each is served, what a
second of it costs. Everything that deploys or estimates reads this file; `validate` is the one
place its rules live, and it also checks each Modal app file against its registry entry."""

from __future__ import annotations

import ast
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[2]  # glhf/openmodels
REGISTRY = ROOT / "models.yaml"
KINDS = ("modal-app", "api", "not-deployed")
STATUSES = ("smoke-tested", "served", "waiting", "prepared", "not-deployed")
# The agents compact their context at 100,000 tokens (bixbench_v1.solvers), and one more model
# call with its tool output arrives before that takes effect. Below this a model cannot honour
# the setting, and the registry must say so in `limits`.
CONTEXT_NEEDED = 120_000
SERVICE = "openmodels"  # openai-api/openmodels/<repo> -> OPENMODELS_BASE_URL, OPENMODELS_API_KEY
MAX_SCALEDOWN_SECONDS = 300
_REVISION = re.compile(r"^[0-9a-f]{40}$")
_NAME = re.compile(r"^[a-z0-9][a-z0-9.-]{1,40}$")


class RegistryError(ValueError):
    """models.yaml, or an app file, breaks a rule."""


@dataclass(frozen=True)
class Prices:
    read_from: str
    gpu_per_hour: dict[str, float]
    cpu_core_per_hour: float
    memory_gib_per_hour: float
    volume_gib_per_month: float

    def per_second(self, gpu: str, gpu_count: int, cpu: float, memory_gib: float) -> float:
        """Dollars per second of one container: its GPUs plus the CPU and memory it reserves."""
        if gpu not in self.gpu_per_hour:
            raise RegistryError(f"no price for GPU {gpu!r}; known: {sorted(self.gpu_per_hour)}")
        hourly = (
            self.gpu_per_hour[gpu] * gpu_count
            + self.cpu_core_per_hour * cpu
            + self.memory_gib_per_hour * memory_gib
        )
        return hourly / 3600


@dataclass(frozen=True)
class Model:
    name: str
    kind: str
    status: str
    inspect_model: str | None = None
    hf_repo: str | None = None
    revision: str | None = None
    gated: bool | None = None
    license: str | None = None
    weights_gb: float | None = None
    app_file: str | None = None
    app_name: str | None = None
    gpu: str | None = None
    gpu_count: int = 1
    cpu: float = 0
    memory_gib: float = 0
    price_per_second: float | None = None
    startup_timeout_seconds: int = 0
    scaledown_seconds: int = 0
    context_length: int | None = None
    max_output_tokens: int | None = None
    tool_call_parser: str | None = None
    reasoning_parser: str | None = None
    usd_per_mtok: dict[str, Any] = field(default_factory=dict)  # api models: input, cached, output
    limits: str = ""
    notes: str = ""

    @property
    def on_modal(self) -> bool:
        return self.kind == "modal-app"


@dataclass(frozen=True)
class Registry:
    prices: Prices
    models: tuple[Model, ...]

    def get(self, name: str) -> Model:
        for model in self.models:
            if model.name == name:
                return model
        raise RegistryError(f"unknown model {name!r}; known: {[m.name for m in self.models]}")


def app_constants(path: Path) -> dict[str, Any]:
    """The upper-case constants at the top level of a Modal app file, read without importing it
    (importing needs the `modal` package, which is not in this project's virtualenv)."""
    found: dict[str, Any] = {}
    for node in ast.parse(path.read_text(encoding="utf-8")).body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1:
            target = node.targets[0]
            if isinstance(target, ast.Name) and target.id.isupper():
                try:
                    found[target.id] = ast.literal_eval(node.value)
                except ValueError:
                    pass  # a computed value: not one of the constants we check
    return found


def _check_app(model: Model, root: Path) -> list[str]:
    problems: list[str] = []
    path = root / str(model.app_file)
    if not path.is_file():
        return [f"{model.name}: app file {model.app_file} not found"]
    if "modal" in {part.lower().removesuffix(".py") for part in path.relative_to(root).parts}:
        problems.append(f"{model.name}: a file or folder named 'modal' shadows the package")
    constants = app_constants(path)
    expected = {
        "APP_NAME": model.app_name,
        "MODEL": model.hf_repo,
        "REVISION": model.revision,
        "GPU": model.gpu,
        "GPU_COUNT": model.gpu_count,
        "CPU": model.cpu,
        "MEMORY_GIB": model.memory_gib,
        "CONTEXT_LENGTH": model.context_length,
        "MAX_OUTPUT_TOKENS": model.max_output_tokens,
        "TOOL_CALL_PARSER": model.tool_call_parser,
        "SCALEDOWN_SECONDS": model.scaledown_seconds,
        "STARTUP_TIMEOUT_SECONDS": model.startup_timeout_seconds,
    }
    for key, value in expected.items():
        if constants.get(key) != value:
            problems.append(
                f"{model.name}: {model.app_file} has {key}={constants.get(key)!r}, "
                f"models.yaml says {value!r}"
            )
    if constants.get("MAX_CONTAINERS") != 1 or constants.get("MIN_CONTAINERS") != 0:
        problems.append(f"{model.name}: the app must set MAX_CONTAINERS=1 and MIN_CONTAINERS=0")
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.keyword) and node.arg == "unauthenticated":
            if not (isinstance(node.value, ast.Constant) and node.value.value is False):
                problems.append(f"{model.name}: the app must not set unauthenticated=True")
    return problems


def validate(data: dict[str, Any], root: Path = ROOT) -> Registry:
    """Build the registry from the parsed YAML, or raise RegistryError listing every problem."""
    problems: list[str] = []
    try:
        prices = Prices(**data["prices"])
    except (KeyError, TypeError) as error:
        raise RegistryError(f"models.yaml: bad `prices` block: {error}") from error
    models: list[Model] = []
    seen: set[str] = set()
    for raw in data.get("models") or []:
        try:
            model = Model(**raw)
        except TypeError as error:
            problems.append(f"{raw.get('name', '?')}: {error}")
            continue
        models.append(model)
        name = model.name
        if not _NAME.match(name) or name in seen:
            problems.append(f"{name}: names are unique, lower case, letters digits . and -")
        seen.add(name)
        if model.kind not in KINDS:
            problems.append(f"{name}: kind {model.kind!r} is not one of {KINDS}")
        if model.status not in STATUSES:
            problems.append(f"{name}: status {model.status!r} is not one of {STATUSES}")
        if model.kind == "api":
            if not model.inspect_model or model.inspect_model.startswith("openai-api/"):
                problems.append(f"{name}: an api model needs a vendor `inspect_model` id")
            price = model.usd_per_mtok
            if not all(
                isinstance(price.get(k), int | float) for k in ("input", "cached_input", "output")
            ):
                problems.append(f"{name}: usd_per_mtok needs input, cached_input and output")
            if not price.get("source"):
                problems.append(f"{name}: usd_per_mtok needs a `source` that can be cited")
            continue
        if not model.hf_repo or not _REVISION.match(model.revision or ""):
            problems.append(f"{name}: needs hf_repo and a pinned 40-character revision")
        if model.gated is None:
            problems.append(
                f"{name}: `gated` must be true or false (checked on the Hugging Face API)"
            )
        if model.kind == "not-deployed":
            if model.status not in ("not-deployed", "waiting"):
                problems.append(
                    f"{name}: kind not-deployed goes with status not-deployed or waiting"
                )
            continue
        # modal-app
        if model.gated and model.status != "waiting":
            problems.append(f"{name}: a gated model waits for the owner; status must be waiting")
        if model.inspect_model != f"openai-api/{SERVICE}/{model.hf_repo}":
            problems.append(f"{name}: inspect_model must be openai-api/{SERVICE}/{model.hf_repo}")
        if not model.tool_call_parser:
            problems.append(f"{name}: the agents need tool calls; name the tool_call_parser")
        if not model.context_length or not model.max_output_tokens:
            problems.append(f"{name}: state context_length and max_output_tokens")
        elif model.context_length < CONTEXT_NEEDED and not model.limits:
            problems.append(
                f"{name}: context {model.context_length} is under the {CONTEXT_NEEDED} the "
                "agents need; say so in `limits`"
            )
        if not 0 < model.scaledown_seconds <= MAX_SCALEDOWN_SECONDS:
            problems.append(f"{name}: scaledown_seconds must be 1..{MAX_SCALEDOWN_SECONDS}")
        if model.startup_timeout_seconds <= 0:
            problems.append(f"{name}: startup_timeout_seconds must be set")
        try:
            rate = prices.per_second(str(model.gpu), model.gpu_count, model.cpu, model.memory_gib)
        except RegistryError as error:
            problems.append(f"{name}: {error}")
        else:
            if model.price_per_second is None or abs(model.price_per_second - rate) > 5e-7:
                problems.append(
                    f"{name}: price_per_second {model.price_per_second} does not match the "
                    f"price table ({rate:.6f})"
                )
        problems.extend(_check_app(model, root))
    if problems:
        raise RegistryError("models.yaml:\n  " + "\n  ".join(problems))
    return Registry(prices, tuple(models))


def load(path: Path = REGISTRY) -> Registry:
    return validate(yaml.safe_load(path.read_text(encoding="utf-8")), path.parent)
