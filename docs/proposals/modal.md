# Proposal: run the BixBench v1 adapter on Modal

Status: plan only. Nothing here has been run on Modal. No Modal app, volume, image, sandbox or
secret was created while writing it.

## 0. Short answer

**Do not build this before the laptop run has been tried.** The full set (59 capsules, both
solvers) is 2.2 hours of laptop time at the pilot's measured speed and 5.9 hours at the planning
figure of 3 minutes per capsule per solver. It needs no new code. The Modal route needs about
24 hours of engineering and, more important, a different sandbox image: the official image is
published for linux/arm64 only and Modal runs linux/amd64 only, so it cannot be imported and
must be rebuilt (section 4). Modal compute itself is cheap (under 10 USD, section 10); it is not
the reason to wait. Section 14 gives the reasoning and the conditions under which this becomes
worth doing.

If it is built, build **option C** (Inspect and the model calls stay on the laptop; only the
analysis sandbox runs on Modal), as a thin subclass of the published `inspect-sandboxes` Modal
provider. Option A is C plus a wrapper and can follow. Option B is rejected.

## 1. What was read, and what is from memory

| Source | Version | How |
|---|---|---|
| Repo | `main` at `1cbed9e`, with other agents' uncommitted changes in the working tree | `glhf/bixbench_v1/src/bixbench_v1/{runner,task,staging,dataset,cli,solvers}.py`, `sandbox/compose.yaml`, `README.md`, `engine/src/bixv1/store.ts`. Function names are cited, not line numbers, because the files are changing. |
| `modal` | **1.6.4** | Installed as a uv tool: `~/.local/share/uv/tools/modal/lib/python3.14/site-packages/modal/`. It is **not** in the adapter's virtualenv (`uv pip show modal` there finds nothing). All Modal signatures below are copied from this source. |
| `inspect_ai` | **0.3.220** | `glhf/bixbench_v1/.venv/lib/python3.14/site-packages/inspect_ai/`. |
| `inspect-sandboxes` | **0.6.1** | Not installed. The wheel was downloaded from PyPI to `/tmp/isb` and read, not installed. Requires `modal>=1.5.0`, `inspect-ai>=0.3.211`. |
| Image | `futurehouse/bixbench:aviary-notebook-env` | `docker image inspect`, `docker history`, `docker manifest inspect`, Docker Hub tags API. |
| Pilot | `glhf/bixbench_v1/runs/pilot-sonnet-5-5/{budget.json,report.md,*/run.json}` | 3 capsules, 8 questions. |

From memory and **to be checked before relying on them**: every Modal price (section 10), the
24-hour maximum for function and sandbox timeouts, that Modal sandboxes run as root under gVisor,
provider rate-limit rules, and that Inspect refuses two concurrent `eval()` calls in one process.

## 2. How the adapter uses the sandbox today

Facts the design depends on:

1. `task.bixbench_v1` hard-codes the provider: `sandbox=("docker", os.environ.get("BIXBENCH_V1_COMPOSE", str(COMPOSE)))`.
   The compose file can be replaced by an environment variable; the provider type cannot.
2. `runner.run_capsule` passes per-run paths through `os.environ` (`BIXBENCH_V1_IMAGE`,
   `BIXBENCH_V1_DATA_DIR`, `BIXBENCH_V1_OUTPUTS_DIR`), which the compose file interpolates.
   This is process-global, so two runs cannot share a process.
3. The compose file mounts exactly two things: the staged data at `/data` read-only and a host
   directory at `/outputs`. `network_mode: none`, `working_dir: /home`, `command: sleep infinity`.
4. `/outputs` is a **bind mount**. The solver's code (not the model) writes
   `/outputs/answers.json`, `METHODS.md`, `glhf/{ledger.json,FINDINGS.md}` with
   `sandbox().write_file`, and `_COLLECT` copies small scripts to `/outputs/glhf/work/`. After
   `inspect_eval` returns, `run_capsule` reads `out_dir/outputs/answers.json` from the host.
   Modal has no bind mounts, so this is the one data path that must be redesigned.
5. The swarm depends on `sandbox().exec(..., user=...)` and on the `user=` argument of
   `bash_session`, `python` and `text_editor`: `root`, `deriv_a`, `deriv_b`. `_SETUP` runs
   `useradd`, `chown`, `chmod 700`. The critic's blindness is enforced by Unix permissions.
6. `bash_session` and `text_editor` inject a helper binary into the sandbox with
   `write_file` and start it as root (`inspect_ai/tool/_sandbox_tools_utils/sandbox.py`,
   `_inject_container_tools_code`). The amd64 binary is in the wheel
   (`inspect_ai/binaries/inspect-sandbox-tools-amd64-v17`), so no network is needed for it.
7. The key never enters Inspect. `run_capsule` builds `public_view`, deletes the key, and
   `grade_run` rebuilds it from the question file after the sandbox is gone.
8. The CLI is sequential and resumable: a run whose `run.json` has `status == "done"` is skipped.
   `budget.json` is written by the one process.

## 3. Options

### A. One Modal function per capsule, each running the Inspect task against `modal.Sandbox`

A Modal function (small CPU container with the harness installed and the model keys) is called
once per (capsule, solver). Inside, it runs `inspect_eval` with a Modal sandbox provider and
returns the run folder.

- For: the laptop can be closed; fan-out is one `.spawn()` per run; concurrency is a function setting.
- Against: the model keys must be stored in Modal; a harness image must be built from two local
  packages (`bixbench_v1` depends on `../bixbench` by path); results need a return path and a
  pull step; two layers of timeout and retry; failures are harder to see. About 8 hours more
  than C.

### B. The whole harness in one large Modal container with a local (no-Docker) sandbox

Rejected. It breaks the two properties the README's integrity table promises:

- **Network.** The harness must reach the model API, and the model's code runs in the same
  container. `App.function` has only `block_network: bool = False` (all or nothing; the
  domain allow-list exists only on `Sandbox.create`). Network-off is impossible.
- **Keys.** The harness process holds the API keys. The agents' code runs as root in the same
  container (the reconciler role is root) and can read `/proc/<pid>/environ`.
- Inspect's `local` provider ignores `user` (`LocalSandboxEnvironment.exec`: "The 'user'
  parameter is ignored"), so the blind critic would not be blind without writing a new provider.
- The harness would have to be installed into the analysis image's conda Python, changing the
  environment under test.

It is the cheapest in compute (about 1 USD) and that does not matter.

### C. Modal only for the analysis sandbox; Inspect and the model calls stay on the laptop

`bixbench-v1 run` runs as now. Only the sandbox provider changes from `docker` to a Modal one.

- For: smallest change. Model keys, the question file and the capsule zips never leave the
  laptop. `run.json`, `logs/`, `grade.json`, `budget.json` and the report are written exactly
  where they are today, so the report and the engine's results API need no change. Resuming is
  the existing `status == "done"` check. Everything built for C is also needed by A.
- Against: the laptop must stay awake and online for the run (about 1 hour at 8 jobs). Every
  tool call is a round trip from the laptop to Modal. Parallelism has to be added to the CLI
  (section 8).

### Recommendation

**C**, then A only if being tied to the laptop turns out to hurt. Do not write a provider from
scratch: `inspect_ai` 0.3.220 already names the package (`registry.py`:
`_SANDBOX_PACKAGES = {..., "modal": "inspect-sandboxes", ...}`), and `inspect-sandboxes` 0.6.1
`ModalSandboxEnvironment` already does the hard parts:

- `exec(user=...)` is emulated with `su -p`, because (its own comment, and confirmed in the
  Modal source) "Modal's Sandbox.exec() has no user parameter";
- compose `network_mode: none` becomes `block_network=True`;
- `x-modal.volumes` entries (`name`, `mount_path`, `read_only`) become
  `modal.Volume.from_name(name).with_mount_options(read_only=...)`;
- `write_file`, `read_file`, timeout retries, cleanup of leaked sandboxes.

Two things it does not do, which is why a subclass of about 120 lines is needed: it cannot mount
a **sub-path** of a Volume (its `ModalVolumeSpec` has no `sub_path`), and it has no way to bring
`/outputs` back to the host.

## 4. The image: it must be rebuilt for amd64

Verified:

- `docker manifest inspect futurehouse/bixbench:aviary-notebook-env` lists one platform,
  `linux/arm64` (digest `sha256:ccc54347…`, 5.66 GB compressed, 16 layers; 18.3 GB unpacked),
  plus an attestation. The Docker Hub tags API shows this is the only tag of the repository.
- Modal 1.6.4, `Image.from_registry` docstring: "The image must be built for the `linux/amd64`
  platform."

So `modal.Image.from_registry("futurehouse/bixbench:aviary-notebook-env")` cannot work, for any
option. An amd64 image must be built. That image is **not** the official image: conda will
solve to different builds, and results on it are not strictly comparable with the laptop pilot.
`run.json` must say which image a run used.

Build recipe, recoverable from the local image without the upstream repository
(`docker history --no-trunc futurehouse/bixbench:aviary-notebook-env`):

1. Base `continuumio/miniconda3` 24.9.2-0 (Debian 12, Python 3.12; multi-arch upstream).
2. `apt-get install wget gpg software-properties-common build-essential`.
3. `conda install mamba=2.0.5 -c conda-forge`.
4. `mamba install -c conda-forge r-base=4.3.3 r-recommended=4.3 r-irkernel=1.3.2 …` (full
   pinned list is in the history output; 2.8 GB layer).
5. Kernel specs for Python and R.
6. `mamba install -c conda-forge -c bioconda biokit=0.5.0 gseapy=1.1.4 blast=2.16.0
   clipkit=2.3.0 fastqc=0.12.1 iqtree=2.3.6 mafft=7.526 metaeuk=7.bba0d80 mygene=3.2.2
   perl=5.32.1 phykit=2.0.1 …` (4.3 GB layer).
7. `COPY requirements.txt .` then `mamba install -c conda-forge --file requirements.txt`. The
   file is in the image: `docker run --rm --network none IMAGE cat /envs/requirements.txt`
   (23 lines: `anndata==0.11.1`, `biopython==1.84`, …).
8. `udocker --allow-root install && udocker --allow-root pull ezlabgva/busco:v5.8.0_cv1` (1.25 GB).
9. `WORKDIR /workspace`, clean caches. Add `RUN mkdir -p /data /outputs /home`.

If Future-House publish their Dockerfile (check their BixBench repository), use it instead and
diff it against the history.

Steps:

- Write `glhf/bixbench_v1/sandbox/modal/Dockerfile` and `requirements.txt` from the above, with
  every version pinned as in the history.
- Optional local check, no cloud: `docker buildx build --platform linux/amd64` under emulation.
  Slow (hours) but proves the pins solve on amd64.
- Build on Modal once and publish under a name, so runs reference a fixed image
  (signatures from `modal/_image.py`):

  ```python
  def from_dockerfile(path, *, force_build=False, context_dir=None, ignore=AUTO_DOCKERIGNORE,
                      build_args={}, registry_secret=None, secrets=None, env=None, gpu=None,
                      add_python=None) -> "_Image"
  async def build(self, app: "modal.app._App | None" = None) -> "_Image"
  async def publish(self, name: str, *, environment_name=None, experimental_options=None, client=None) -> None
  def from_name(name: str, *, environment_name=None, client=None) -> "_Image"
  ```

  ```python
  image = modal.Image.from_dockerfile("sandbox/modal/Dockerfile", context_dir="sandbox/modal")
  with modal.enable_output():
      image.build(app=modal.App.lookup("bixbench-v1-sandbox", create_if_missing=True))
  image.publish("bixbench-v1-env:amd64-1")      # runs use modal.Image.from_name("bixbench-v1-env:amd64-1")
  ```

- Do not pass `add_python`: the image has Python 3.12 and pip. In `_registry_setup_commands`
  the comment reads "past 2024.10, client dependencies are mounted at runtime", so with a
  current image-builder version Modal does not pip-install its own dependencies into the conda
  environment. Check the workspace's builder version is later than 2024.10 before building;
  otherwise the analysis environment is modified.
- After the build, in a sandbox: record `conda list --explicit` and R `installed.packages()`
  and diff against the same two lists from the arm64 image. Commit the diff next to the
  Dockerfile. This is the evidence for how far the two environments differ.
- `run.json`: `runner._image_digest` calls `docker image inspect`; for Modal runs record
  `settings.image = "bixbench-v1-env:amd64-1"`, `settings.image_id = image.object_id` (`im-…`),
  and a new `settings.sandbox = "modal"` (`"docker"` otherwise). Added fields only; nothing read
  by `report.py` or `engine/src/bixv1/store.ts` changes.

## 5. Data on a Volume, and the answer boundary

The rule from `staging.py` and `compose.yaml` is: the sandbox sees the allow-listed files of one
capsule at `/data`, read-only, and nothing else. On Modal the same rule is kept by uploading
**only staged output** and mounting **only one capsule's data sub-directory**.

Signatures (`modal/volume.py`):

```python
def from_name(name: str, *, environment_name=None, create_if_missing=False, version=None,
              create_options=None, client=None) -> "_Volume"
def with_mount_options(self, *, read_only: bool | None = None,
                       sub_path: str | PurePosixPath | None = None) -> "_Volume"
async def batch_upload(self, force: bool = False) -> AsyncGenerator["_AbstractVolumeUploadContextManager", None]
def put_file(self, local_file, remote_path, mode=None)
def put_directory(self, local_path, remote_path, recursive=True)
async def listdir(self, path: str, *, recursive: bool = False) -> list[FileEntry]   # FileEntry: path, type, mtime, size
```

`with_mount_options` docstring: "read_only: Set this to True to make the Volume read only from
within containers. sub_path: Only mount this sub_path directory from the Volume. If the
directory doesn't exist in the Volume, it will be created when the container starts up."

### What goes where

| File | Holds | Laptop | Volume `bixbench-v1-staged` | Sandbox | Orchestrator function (option A only) |
|---|---|---|---|---|---|
| `glhf/data/bixbench_v1/hub/BixBench.jsonl` | ideal answers, distractors, hypothesis, result, paper | yes | **never** | **never** | **never** |
| `hub/CapsuleFolder-<uuid>.zip` | data and the solution notebooks | yes | **never** | **never** | **never** |
| `staged/<uuid>/data/**` | the allow-listed input files | yes | `/<uuid>/data/**` | `/data` (read-only, this capsule only) | read-only, for `verify_staged` |
| `staged/<uuid>/manifest.json` | zip name and hash, included paths, names of excluded members | yes | `/<uuid>/manifest.json` | not mounted (outside the sub-path) | read-only |
| `.env`, `~/.modal.toml` | model keys, Modal token | yes | never | never | keys via a Modal Secret, see section 7 |
| `PublicQuestion` list | id, question text, shuffled options | built here | no | only inside the prompt | passed as the function argument |
| `runs/**/grade.json`, grading key | verdicts; the key is rebuilt in memory | yes | never | never | never (grading stays on the laptop) |

The mount, per run:

```python
data = modal.Volume.from_name("bixbench-v1-staged").with_mount_options(
    read_only=True, sub_path=f"/{capsule.uuid}/data")
# Sandbox.create(..., volumes={"/data": data})   and no other volume
```

### Upload: new command `bixbench-v1 modal-upload [--capsules … | --all]`

For each capsule **of the question file** (59; the hub folder has 64 zips, and the README's
audit found executed notebooks inside the data folders of unused ones, so select capsules from
the question file, never by globbing zips):

1. `staging.stage_capsule(hub/zip, staged/<uuid>)`, `staging.verify_staged`, and
   `staging.leak_scan(data_dir, secrets)` with the capsule's `long_secrets()`. All on the
   laptop, exactly as `run_capsule` step 1 does. Any `IntegrityError` or leak stops the upload.
2. `with vol.batch_upload() as batch: batch.put_directory(staged/<uuid>/data, f"/{uuid}/data");
   batch.put_file(staged/<uuid>/manifest.json, f"/{uuid}/manifest.json")`.
3. Read back `vol.listdir(f"/{uuid}/data", recursive=True)` and require: the set of file paths
   equals `manifest.paths`; each size equals the manifest's `bytes`; no entry has type
   `SYMLINK`; `staging.exclusion_reason("CapsuleData/" + path)` is `None` for every path.
4. After all capsules, list the Volume root and require that it holds only `<uuid>/data` and
   `<uuid>/manifest.json` for known uuids: no `.zip`, no `.jsonl`, no `.ipynb` anywhere.

Size: 1,084 files, 13.5 GB unpacked (README, `audit`). The hub download is 5.5 GB; staging all
59 capsules needs 13.5 GB of local disk first (only 3 are staged now, 20 MB).

### Checks at run time

- The laptop still runs `stage_capsule` / `verify_staged` / `leak_scan` / `check_prompt` before
  every run, unchanged. The local staged copy is the reference.
- Because a missing `sub_path` is silently created empty, the provider must check the mount
  after the sandbox starts and before the solver runs:
  the sorted output of `find /data -type f -printf '%P\t%s\n'` equals the manifest's paths and
  byte sizes (pass a hash of that list in the config, not just the count); otherwise raise
  `staging.IntegrityError` and terminate the sandbox.
- Probe (smoke test, section 12): inside the sandbox `touch /data/x` fails;
  `find / -xdev \( -name '*.ipynb' -o -name 'BixBench.jsonl' -o -name 'CapsuleFolder-*.zip' -o -name manifest.json \)`
  prints nothing; `mount | grep -c /__modal/volumes` shows one volume.
- Only the upload command writes to the Volume. Name the Volume after the dataset revision
  (`bixbench-v1-staged-f8cc3bdc`) so a new revision cannot mix with the old one.

### `/outputs`

Not a Volume. It is a plain directory in the sandbox's own filesystem, and the provider copies
it out when the sample ends (section 6). Reasons: Volumes need a commit and a reload to be seen
elsewhere, concurrent writers are "last write wins", and Unix ownership on a network mount is
not something to rely on. As a side effect the role users' permissions on `/outputs` are real,
which they are not on a macOS bind mount (README, "Problems to know about").

## 6. The provider subclass

New file `glhf/bixbench_v1/src/bixbench_v1/modal_sandbox.py`; new optional dependency group
`modal = ["inspect-sandboxes==0.6.1", "modal>=1.6,<2"]` in `pyproject.toml` (pinned exactly,
because the subclass calls two private static methods of the provider). The module is imported
only when the Modal provider is selected, so the Docker path does not need the packages.

Signatures used (`modal/sandbox/_sandbox.py`, 1.6.4; unused parameters elided with `…`):

```python
async def create(*args: str, app=None, name=None, tags=None, image: _Image | None = None,
    env: dict[str, str | None] | None = None, secrets: Collection[_Secret] | None = None, …,
    timeout: int | None = 300, idle_timeout: int | None = None, workdir: str | None = None, …,
    cpu: float | tuple[float, float] | None = None, memory: int | tuple[int, int] | None = None, …,
    block_network: bool = False, outbound_cidr_allowlist=None, outbound_domain_allowlist=None, …,
    volumes: dict[str | os.PathLike, _Volume | _CloudBucketMount] = {}, …,
    encrypted_ports=[], h2_ports=[], unencrypted_ports=[], …,
    include_oidc_identity_token: bool = False, …) -> "_Sandbox"
async def exec(self, *args: str, stdout=StreamType.PIPE, stderr=StreamType.PIPE,
    timeout: int | None = None, workdir: str | None = None, env=None, secrets=None,
    text: bool = True, bufsize=-1, pty: bool = False, …)          # no `user`
async def terminate(self, *, wait: bool = False) -> int | None
async def lookup(name: str, *, client=None, environment_name=None, create_if_missing=False) -> "_App"   # modal.App
```

Note the default sandbox lifetime is **300 seconds**; it must be set. The source also says
"Ephemeral disk requests are not supported on Sandboxes", so disk size cannot be chosen.

Sketch:

```python
class BixModalConfig(BaseModel, frozen=True):
    image: str                 # published image name, e.g. "bixbench-v1-env:amd64-1"
    staged_volume: str
    capsule_uuid: str
    expected_listing_sha256: str   # hash of the manifest's sorted "path\tbytes" lines
    outputs_dir: str           # directory on the machine that runs Inspect
    timeout_seconds: int       # time_limit_seconds + TIME_BACKSTOP_SECONDS + 600
    cpu: float = 4.0
    memory_mib: int = 16384

@sandboxenv(name="bixbench_modal")
class BixModalSandbox(ModalSandboxEnvironment):
    @classmethod
    async def sample_init(cls, task_name, config, metadata):
        app = await cls._lookup_app("bixbench-v1-sandbox")
        data = modal.Volume.from_name(config.staged_volume).with_mount_options(
            read_only=True, sub_path=f"/{config.capsule_uuid}/data")
        sandbox = await cls._create_sandbox(["sleep", "infinity"], dict(
            app=app, image=modal.Image.from_name(config.image), workdir="/home",
            block_network=True, volumes={"/data": data},
            cpu=config.cpu, memory=config.memory_mib, timeout=config.timeout_seconds))
        # no env=, no secrets=, no ports, no allow-lists, include_oidc_identity_token left False
        env = cls(sandbox, working_dir="/home"); env.bix = config
        # then: tag and register for cleanup as the parent does; check the /data file count;
        # run the network probe of section 7; mkdir -p /outputs
        return {"default": env}

    @classmethod
    async def sample_cleanup(cls, task_name, config, environments, interrupted):
        # Always, also when interrupted: tar /outputs to stdout (exec(..., text=False)), cap the
        # size (50 MB), extract into config.outputs_dir, then let the parent terminate.
        ...
```

Details that matter:

- The sandbox is untrusted. Extract the tar with `tarfile`'s `filter="data"`, refuse absolute
  paths, `..`, links and devices, and cap total size and member count.
- The parent's `sample_cleanup` returns early when `interrupted` is true and leaves the sandbox
  to the task-level cleanup. The subclass must copy `/outputs` out first in both cases, inside
  `try/except`, so a partial answer file is still collected.
- Pass the config with `SandboxEnvironmentSpec("bixbench_modal", config)`; implement
  `config_deserialize` so a saved log can be reloaded. The config is written to the eval log;
  it holds no secret.
- `task.bixbench_v1` gains a parameter `sandbox: SandboxEnvironmentType | None = None`
  (default: the present Docker tuple). `run_capsule` gains `sandbox: str = "docker"` and builds
  the config; the CLI gains `--sandbox docker|modal`, `--modal-image`, `--modal-volume`.
  With `--sandbox modal` the three `BIXBENCH_V1_*` environment variables are not used.
- Sizing: 4 cores and 16 GiB by default. Docker Desktop here has 7.7 GB and the README warns
  the six bix-61 capsules may need more; on Modal give those capsules 32 GiB via a per-capsule
  override table.

## 7. Network off, and keys

### Network

Enforced by `block_network=True`. In `modal/sandbox/_common.py`,
`_build_outbound_network_access` returns
`api_pb2.NetworkAccess(network_access_type=NetworkAccessType.BLOCKED)` for it, and the same
module raises `InvalidError` if it is combined with open ports ("Cannot specify open ports when
`block_network` is enabled"), a CIDR allow-list, a domain allow-list or an inbound allow-list.
The subclass passes none of those.

Verified in three layers:

1. No cloud (unit test): patch `_create_sandbox`, call `sample_init`, assert the keyword
   arguments: `block_network is True`; none of `outbound_cidr_allowlist`,
   `outbound_domain_allowlist`, `cidr_allowlist`, `*_ports`, `proxy`, `env`, `secrets`,
   `include_oidc_identity_token` present; `volumes` has exactly the key `/data`.
2. Every run (cheap, inside `sample_init`, as root, before the solver starts): a probe script
   that must fail on all of: `getent hosts api.anthropic.com`; a 5-second TCP connect to
   `1.1.1.1:443` and to `api.anthropic.com:443` with Python's `socket`; `curl -m 5 https://pypi.org`.
   If any succeeds, raise `staging.IntegrityError` and terminate. Record
   `settings.network = "none"` and `settings.network_probe = "passed"` in `run.json` (today
   `"network": "none"` is written without a check).
3. Cloud smoke test (section 12): the probe of `tests/test_e2e.py` ported to the Modal sandbox.

Note the README's known limit applies unchanged: at least 17 questions name an online resource
and cannot be answered as asked with the network off.

### Keys

Option C: `cli.cmd_run` calls `load_env(REPO / ".env")` on the laptop as now. Keys exist only in
the laptop process. Nothing in Modal holds them: `Sandbox.create` is called with no `env` and no
`secrets`, and `exec` is called with no `env` beyond what a tool call passes. The Modal token in
`~/.modal.toml` is used by the laptop's client only; a sandbox is given no Modal credentials
(`include_oidc_identity_token` stays `False`).

Option A: a Modal Secret holding only the provider keys the run needs, created by a person in
a terminal so that no agent or script reads `.env`:

```
modal secret create bixbench-v1-model-keys ANTHROPIC_API_KEY=… OPENAI_API_KEY=…
```

Do not use `--from-dotenv` or `modal.Secret.from_dotenv`: they would upload every variable of
the repository's `.env`. Attach it to the orchestrator function only
(`def from_name(name, *, environment_name=None, required_keys=[], client=None)`):

```python
@app.function(image=harness_image,
              secrets=[modal.Secret.from_name("bixbench-v1-model-keys", required_keys=["ANTHROPIC_API_KEY"])],
              volumes={"/staged": staged.with_mount_options(read_only=True)},
              timeout=…, max_containers=JOBS, retries=0)
def solve(spec: dict) -> dict: ...
```

The sandbox is a separate container created by that function with no `secrets`. The judge key
is not needed in Modal at all, because grading stays on the laptop.

Verified for both options by a probe inside the sandbox, as root: `env`, `/proc/1/environ` and
`/proc/self/environ` contain no name matching `KEY|TOKEN|SECRET|ANTHROPIC|OPENAI|MODAL_TOKEN`;
`find / -xdev -name '.env' -o -name '.modal.toml'` prints nothing. Run it in the smoke test and
cheaply at the start of every run.

## 8. Concurrency and rate limits

The CLI runs one run at a time. Inspect refuses concurrent `eval()` calls in one process (from
memory; check), and `run_capsule` uses `os.environ`, so parallelism must be by process.

New flag `bixbench-v1 run --jobs N` (default 1; works for Docker too):

- The parent builds the list of pending units (capsule, question ids, solver) with the existing
  skip rule, then runs up to N children, each `python -m bixbench_v1.cli solve-one <spec.json>`
  (new internal subcommand that calls `run_capsule` for one unit and exits).
- The parent alone grades (`grade_run`), writes `budget.json` and the report. One writer.
- Token cap with parallel runs: start a unit only if
  `spent + sum(worst case of running units) + worst case of this unit <= cap`, where worst case
  is the existing `backstop_tokens(max_tokens) + JUDGE_RESERVE_TOKENS`.

What one run asks of the provider, from the pilot's `run.json` usage (Sonnet, prompt caching on):

| Per concurrent run | single | glhf |
|---|---|---|
| All tokens per minute | about 124,000 | about 127,000 |
| of which cache reads | about 90% | about 90% |
| Cache writes + uncached input per minute | about 14,000 | about 15,500 |
| Output tokens per minute | about 4,200 | about 4,600 |

So `N <= min(ITPM / 16,000, OTPM / 5,000)` if the provider does not count cache reads against
the input limit, and `N <= ITPM / 127,000` if it does. Read the real limits from the provider's
console for the account's tier (not recorded here; tier rules from memory are not reliable).
Start with `--jobs 4`, read the eval logs for retried calls, then raise to 8.

Why this matters beyond speed: Inspect retries a 429 with back-off, and the solvers' clocks are
wall-clock (`time_limit`, `Clock`, the role time shares). Time spent waiting on a rate limit is
taken from the role's budget and can change an answer. Pick N so that retries are rare, use
the same N for both solvers, and record `settings.jobs` in `run.json`.

Modal side: 8 sandboxes of 4 cores is small; workspace limits on concurrent sandboxes and on
sandbox creation rate exist (numbers not checked). For option A use `max_containers=N` on the
function; do not use function `retries`, because a retried input would spend tokens twice and
overwrite a run (resuming is handled by `run.json`, below).

## 9. Resuming, and getting results into `glhf/bixbench_v1/runs`

Layout that must hold (read by `report.py` and by `engine/src/bixv1/store.ts`):
`runs/<run>/<capsule>[/<question>]/<solver>/{run.json, grade.json, logs/*.eval, outputs/answers.json, outputs/METHODS.md, outputs/glhf/{ledger.json,FINDINGS.md,work/}}`
plus `runs/<run>/{budget.json, report.json, report.md}`.

Option C: nothing moves. `run_capsule` runs on the laptop with `out_dir` under
`glhf/bixbench_v1/runs/<run>/…`; Inspect writes `logs/` there; the provider's cleanup writes
`outputs/` there; `run.json`, `grade.json`, `budget.json`, the report are written by the same
code as today. Resume by running the same command again: runs with `status == "done"` are
skipped, a run left at `"running"` or `"failed"` is run again (as today). After a crash, leaked
sandboxes are found by tag and terminated (`inspect sandbox cleanup modal`, provided by the
provider's `cli_cleanup`), and each sandbox also ends by its own `timeout`.

Option A:

1. The laptop does steps 1 and 2 of `run_capsule` (stage, verify, leak scan, public view,
   prompt check) and sends the function a spec: capsule key, uuid, `PublicQuestion` dicts,
   solver, model, budgets, seed. No `Question` object, so no ideal answer, is serialised. This
   needs `run_capsule` split into `prepare_run()` (host only) and `solve(spec, out_dir)`.
2. The function re-runs `staging.verify_staged("/staged/<uuid>")`, runs `inspect_eval`, and
   writes the run folder (without `grade.json`) to a second Volume `bixbench-v1-runs` at
   `/<run>/<capsule>/<solver>/`, then `commit()`. It also returns the small JSON summary.
3. The laptop records `{unit: function_call_id}` in `runs/<run>/modal_calls.json` when it calls
   `solve.spawn(spec)` (`async def spawn(self, *args, **kwargs) -> "_FunctionCall[ReturnType]"`;
   later `FunctionCall.from_id(function_call_id)` and `get(timeout=…)`), so a closed laptop can
   reattach.
4. New command `bixbench-v1 modal-pull --out runs/<run>` downloads finished run folders from
   the runs Volume into `glhf/bixbench_v1/runs/<run>/`, then runs the existing `grade_run` and
   `_write_report` locally and rebuilds `budget.json` from the `run.json` files.
   Resume rule: a unit is skipped if its `run.json` is `done` locally or on the runs Volume.

In both options grading happens on the laptop after the sandbox is gone, which is what
`runner.py`'s header promises, and `grade.json` never exists in Modal.

## 10. Cost of Modal compute for the full set

Prices **from memory, to be checked on modal.com/pricing before any run**:

| Item | Price per second | Per hour |
|---|---|---|
| Function CPU, per physical core | 0.0000131 USD | 0.047 USD |
| Function memory, per GiB | 0.00000222 USD | 0.008 USD |
| Sandbox CPU, per core | 0.00003942 USD | 0.142 USD |
| Sandbox memory, per GiB | 0.00000672 USD | 0.024 USD |
| Volume storage, image storage | not known | check |
| Free credit on the Starter plan | 30 USD per month | check |

Run time, two figures:

- Planning figure given for this proposal: 3 minutes per capsule per solver.
  59 x 2 x 3 = 354 run-minutes = 21,240 s.
- Measured in the pilot (`budget.json`, 3 capsules): single 26.3, 61.2, 65.7 s (mean 51 s);
  glhf 41.6, 114.1, 95.6 s (mean 84 s). 59 x (51 + 84) = 7,960 s = 133 run-minutes. Three small
  capsules are a weak basis; the large ones will be slower.
- Modal overhead per run (create the sandbox, load an 18 GB image on a cold worker, inject the
  tools binary, copy `/outputs` out): assumed 60 s, **not measured**. 118 runs x 60 = 7,080 s.

Sandbox of 4 cores and 16 GiB: 4 x 0.00003942 + 16 x 0.00000672 = 0.000265 USD/s (0.95 USD/h).

| Option | What is billed | At 3 min per run | At the measured pilot speed |
|---|---|---|---|
| A | sandboxes, plus a 1-core 2-GiB function per run (0.0000175 USD/s) | 28,320 s x 0.000283 = **8.0 USD** | 15,040 s x 0.000283 = **4.3 USD** |
| B | one 8-core 32-GiB function container (0.000176 USD/s), 4 runs at a time, one cold start | 5,610 s = **1.0 USD** | 2,290 s = **0.4 USD** |
| C | sandboxes only | 28,320 s x 0.000265 = **7.5 USD** | 15,040 s x 0.000265 = **4.0 USD** |

Add once: the image build (roughly an hour of a build container; guess under 1 USD) and the
smoke tests (cents). With `--unit question` (205 runs per solver) the README's estimate is
about three times the cost: about 12 to 24 USD for A or C.

For scale, the model spend is larger and identical in every option: the pilot's report
estimates 1.04 USD for 8 questions with both solvers, about 0.13 USD per question, so roughly
27 USD for 205.

Wall clock: laptop, sequential, 2.2 h (measured speed) to 5.9 h (3 min per run). Modal with
`--jobs 8`: about 30 to 60 minutes, if the rate limits allow 8.

## 11. Tasks and hours

For option C. Steps 0 to 7 need no cloud. Steps 8 to 12 create Modal resources and cost money.

| # | Task | Hours |
|---|---|---|
| 0 | **Run the full set on the laptop first** (existing command, README). No engineering. Note per-capsule seconds, peak memory, failures. | 0 (2 to 6 h unattended) |
| 1 | Reconstruct the amd64 Dockerfile and `requirements.txt` from `docker history` and the image (section 4); pin everything. Optional emulated local build. | 3 (plus build wait) |
| 2 | `task.py`: `sandbox` parameter. `runner.py`: `sandbox=` argument, config construction, `settings.sandbox`, `image_id` for Modal, probes recorded. `cli.py`: `--sandbox`, `--modal-image`, `--modal-volume`. Docker behaviour unchanged. | 2 |
| 3 | `modal_sandbox.py`: `BixModalConfig`, `BixModalSandbox` (create, `/data` count check, network and key probes, `/outputs` copy-out with safe extraction). `pyproject.toml` optional group. | 4 |
| 4 | `bixbench-v1 modal-upload`: stage, verify, leak-scan, upload, read-back check, whole-Volume check. | 2 |
| 5 | `--jobs N`: `solve-one` subcommand, parent scheduler, cap reservation, single-writer `budget.json`. | 3 |
| 6 | No-cloud tests (section 12). `ruff`, `mypy --strict`, existing tests still green. | 3 |
| 7 | README section, `docs/running.md`, `docs/status.md` (image differs from the official one). | 1 |
| 8 | **Needs approval to use the cloud.** Build and publish the image; diff package lists against the arm64 image. | 2 (plus about 1 h build) |
| 9 | Upload the staged Volume (13.5 GB from the laptop) and run its checks. | 1 (plus upload time) |
| 10 | Smoke: `--model mock` on one capsule with all probes; then the 3 pilot capsules with the real model on Modal; compare answers, tokens and seconds with the laptop pilot. | 2 |
| 11 | Fix what the smoke run finds (expect: `su`/`useradd` under gVisor, `udocker`, cold-start time). | 2 |
| 12 | Full run with `--jobs 4` then 8; watch retries; grade; report. | 2 |
| | **Total for C** | **about 24** |
| A1 | Option A on top: harness image with both local packages, `solve` function, Secret, `prepare_run`/`solve` split, spawn and reattach, runs Volume, `modal-pull`, tests. | +8 |

## 12. Tests that need no cloud

All in `glhf/bixbench_v1/tests/`, run by `uv run pytest -q`. The Modal client is never called:
`_create_sandbox` and `_lookup_app` are patched, and a fake sandbox object backed by a local
temporary directory stands in for `modal.Sandbox`.

1. **Creation arguments** (`test_modal_boundary.py`): the assertions of section 7, layer 1,
   plus: the Volume passed for `/data` has `_mount_options.read_only is True` and
   `_mount_options.sub_path == f"/{uuid}/data"`; `timeout` equals
   `time_limit_seconds + TIME_BACKSTOP_SECONDS + 600`; `workdir == "/home"`; the command is
   `sleep infinity`.
2. **Empty or wrong `/data` is refused**: the fake's `/data` listing does not hash to
   `expected_listing_sha256`; `sample_init` raises `IntegrityError` and terminates the sandbox.
3. **Probe failure is refused**: the fake's network probe "succeeds"; `sample_init` raises.
4. **Outputs copy-out**: a tar built in the test is extracted to `outputs_dir`; a tar with an
   absolute path, a `..` member, a symlink, or more than the size cap is refused and nothing is
   written outside `outputs_dir`. Also runs when `interrupted=True`.
5. **Upload plan** (`test_modal_upload.py`), with a fake Volume that records `put_directory` /
   `put_file` and serves `listdir`: for the synthetic capsule of `conftest.py`, only
   `<uuid>/data/**` and `<uuid>/manifest.json` are uploaded; no path contains `.zip`, `.jsonl`,
   `.ipynb` or "notebook"; none of the `SENTINELS` strings is in any uploaded byte; a staged
   folder with an extra file, or a read-back listing with an extra or missing file, stops the
   upload.
6. **Spec carries no secret** (needed for A, cheap for C): the JSON given to `solve-one`
   contains none of the `SENTINELS` and validates as `PublicQuestion` only.
7. **Provider selection**: `bixbench_v1(..., sandbox=None)` still yields the Docker tuple and
   `tests/test_boundary.py` (which parses `compose.yaml`) still passes; with the Modal spec the
   task's sandbox type is `bixbench_modal`. Importing `bixbench_v1.task` without `modal`
   installed works.
8. **`--jobs`**: with `--model mock` and Docker (skipped when Docker is not running, like
   `test_e2e.py`): two jobs produce the same run folders as one; `budget.json` is valid JSON
   with every run listed once; the cap is not exceeded when two runs would each fit alone but
   not together; a second invocation skips everything.
9. **Results API unchanged**: run `engine/test/bixv1-api.test.ts` against a run folder whose
   `run.json` has the new `settings.sandbox`, `settings.network_probe`, `settings.jobs` fields.
10. **Dockerfile pins**: a test that parses `sandbox/modal/Dockerfile` and fails on any
    unpinned `mamba install` / `pip install` argument.

The cloud smoke test (step 10) is separate, opt-in (`BIXBENCH_V1_MODAL_SMOKE=1`), and is the
only place the real probes run.

## 13. Risks

| Risk | Effect | What to do |
|---|---|---|
| **The amd64 rebuild is a different environment** from the official arm64 image. | Numbers from Modal and from the laptop are not the same experiment. | Pin as in the image history; diff package lists; rerun the 3 pilot capsules on Modal and compare; state the image in every report. Never mix images inside one comparison of the two solvers. |
| A pinned conda package has no amd64 build at that version, or the solve fails. | Build blocked. | Find out with the optional emulated local build before spending cloud time. |
| gVisor: `su -p`, `useradd`, `chown`, `chmod 700` semantics; `udocker` (BUSCO) may not run. | Swarm setup or blind check fails; BUSCO questions fail. | The solver already raises if setup or the blind check fails, so it cannot pass silently. Test `udocker run` in the smoke step. |
| `sub_path` to a missing directory is created empty. | A run on an empty `/data` that looks valid. | The file-count check in `sample_init` (section 5). |
| Outputs are copied only at cleanup. | If the laptop process dies mid-run, that run's outputs are lost (with Docker's bind mount they are not). | The run is marked `running`/`failed` and is rerun; cost is one run's tokens. |
| Laptop sleeps or loses the network during option C. | Runs fail mid-way; sandboxes live until their timeout. | `caffeinate`; per-sandbox `timeout`; `inspect sandbox cleanup modal`; resume. |
| Rate-limit waits eat the solvers' wall-clock budgets. | Answers change with the level of parallelism. | Section 8: choose N so retries are rare; same N for both solvers; record it. |
| Round-trip latency of every tool call (laptop to Modal). | Slower runs than local Docker; a 600 s tool timeout behaves differently. | Measure on the 3 pilot capsules; if large, that is the argument for option A. |
| Cold start of an 18 GB image on each new worker. | Minutes added per run; the 60 s assumption may be low. | Measure in the smoke step; keep N modest so workers are reused. |
| Subclass depends on private methods of `inspect-sandboxes` (`_create_sandbox`, `_lookup_app`). | Breaks on upgrade. | Exact pin; test 1 fails loudly if the names change. |
| Modal API churn: `sandbox_v2` defaults to true in this client; `.read_only()` is silently deprecated for `with_mount_options`. | Behaviour differs from older docs and examples. | Use only the signatures quoted here; re-read the source on upgrade. |
| Prices and limits here are from memory. | Wrong estimate. | Check the pricing page and workspace limits before step 8. Set a workspace spend limit. |
| A second copy of benchmark data in a cloud account. | Licence and "never commit benchmark data" intent. | Only staged inputs are uploaded (no notebooks, no answers); private workspace; delete the Volume after the run. |
| Option A only: model keys stored in Modal; a function container holds workspace credentials. | Larger blast radius than today. | Dedicated low-limit provider keys; Secret attached to one function; delete after the run. |

## 14. Is this worth doing before the laptop run has been tried?

**No.**

1. **The laptop run is short and free of engineering.** 59 capsules x 2 solvers x 3 minutes is
   5.9 hours, one unattended afternoon or night; at the pilot's measured 51 s and 84 s per run
   it is 2.2 hours. The command exists and resumes. Modal at 8 jobs would save 2 to 5 hours of
   unattended machine time, once, for about 24 hours of work.
2. **Modal cannot run the benchmark's image.** The official image is arm64-only and Modal is
   amd64-only. Apple Silicon is the platform where the official image runs natively. The laptop
   is the reference environment, and the Modal result would need its own validation before
   anyone could trust a difference between the two.
3. **The laptop run produces the numbers this plan lacks**: real seconds and peak memory per
   capsule (three small capsules are not a basis), whether the bix-61 capsules fit, how often
   the provider rate-limits. Those decide whether Modal is needed and how to size it.
4. **Cost is not the argument either way.** Modal compute is 4 to 8 USD against about 27 USD
   of model spend.

Cheaper steps to take first, in order:

- Run the full set on the laptop as is.
- If memory is the problem: raise Docker Desktop's memory. It has 7.7 GiB; the machine has
  36 GiB and 14 cores.
- If time is the problem: build only step 5 (`--jobs N`, 3 hours). It works with Docker, and
  `--jobs 3` brings the planning figure from 5.9 to about 2 hours. It is also the one piece of
  this plan that Modal would need anyway.

Build the Modal path when one of these is true:

- the plan becomes `--unit question` (410 runs; about 20 hours sequential at 3 minutes each),
  or several models, seeds or answer modes, so that total laptop time is days;
- capsules do not fit in the laptop's memory even after raising Docker's limit;
- runs must proceed while the laptop is in use or closed (then option A, 32 hours in total).

Even then, do step 1 (the amd64 Dockerfile and its package diff) first and alone: if the
rebuilt environment cannot be made close enough to the official one, the rest is not worth
building.
