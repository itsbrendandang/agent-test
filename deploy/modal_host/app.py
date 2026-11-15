"""AI Scientist Bot on Modal: the engine and the built dashboard as one private web address.

  python3 deploy/modal_host/access.py add owner        once: who may sign in (see access.py)
  python3 deploy/modal_host/deploy.py                  build and publish; prints the address (deploy.py runs `modal deploy` on a frozen copy)
  modal app stop asb-host                              take it down (the Volume with the runs stays)

One container at most (`max_containers=1`): the engine keeps runs in its own process and in files, and two engines
on one data folder would both continue the same review. The container stops after five minutes without a request
and starts again on the next one; while it is stopped it costs nothing. Runs are kept on the Volume
`asb-host-data` (persist.py explains how). Nothing is served without signing in (front.mjs).

This file is DEMO mode unless ASB_HOST_MODE=real is set when deploying:
  demo  no key Secret is attached; the engine gets NO_PAID_CALLS=1 and PAID_SWITCH_LOCKED=1; a container that
        finds a provider key in its environment refuses to start (hosted.py engine_env).
  real  the Secret `asb-keys` is attached; the engine still starts in Demo and a person turns Real on in the app
        with the session token. See REAL-MODE.md before using it.

Do not name a file or folder `modal`: it would hide the Python package.
"""
from __future__ import annotations

import os
from pathlib import Path

import modal

APP_NAME = "asb-host"
VOLUME_NAME = "asb-host-data"
ACCESS_SECRET = "asb-host-access"  # sign-in code hashes and the cookie key (access.py). Not an API key.
KEYS_SECRET = "asb-keys"  # provider keys. Made by the owner only; attached in real mode only.
NODE_IMAGE = "node:26.13.1-bookworm-slim"  # the repo's Node line (Dockerfile: node:26-bookworm-slim), pinned to a patch release
PORT = 8000

MODE = os.environ.get("ASB_HOST_MODE", "demo")
if MODE not in ("demo", "real"):
    raise SystemExit("ASB_HOST_MODE must be demo or real")
# The address is https://<workspace>--<label>.modal.run. Pick a label that is hard to guess if you want strangers
# not to find the sign-in page at all.
LABEL = os.environ.get("ASB_HOST_LABEL", "asb")

app = modal.App(APP_NAME)
volume = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True, version=2)


def build_image() -> modal.Image:
    here = Path(__file__).resolve().parent
    repo = Path(os.environ.get("ASB_HOST_SOURCE") or here.parents[1])  # deploy.py builds from a frozen copy of the tree
    # Never in the image, whatever folder is copied: keys, installed packages of this machine, run folders, databases.
    never = ["**/.env", "**/.env.*", "**/node_modules", "**/.DS_Store", "**/*.sqlite", "**/*.sqlite-*", "**/.token"]
    return (
        modal.Image.from_registry(NODE_IMAGE, add_python="3.12")
        # The engine: its packages first (this layer is reused until the lock file changes), then its source.
        .add_local_file(repo / "engine/package.json", "/app/engine/package.json", copy=True)
        .add_local_file(repo / "engine/package-lock.json", "/app/engine/package-lock.json", copy=True)
        .run_commands("cd /app/engine && npm ci --omit=dev --ignore-scripts --no-audit --no-fund")
        # The dashboard: built in the image with an empty engine address, so the page calls /api on its own origin.
        .add_local_file(repo / "dashboard/package.json", "/build/dashboard/package.json", copy=True)
        .add_local_file(repo / "dashboard/package-lock.json", "/build/dashboard/package-lock.json", copy=True)
        .run_commands("cd /build/dashboard && npm ci --no-audit --no-fund")
        .add_local_dir(repo / "dashboard", "/build/dashboard", copy=True, ignore=[*never, "dist", "docs", "*.md"])
        .run_commands("cd /build/dashboard && VITE_ENGINE_URL= npx vite build --outDir /srv/dashboard --emptyOutDir && test -f /srv/dashboard/index.html && ! grep -rl 'localhost:8787' /srv/dashboard && rm -rf /build")
        .add_local_dir(repo / "engine/src", "/app/engine/src", copy=True, ignore=never)
        # What the board reads: its settings, members, shared context, briefs, and the notes it starts with. Not board/runs.
        .add_local_file(repo / "board/config.yaml", "/app/board/config.yaml", copy=True)
        .add_local_dir(repo / "board/agents", "/app/board/agents", copy=True, ignore=never)
        .add_local_dir(repo / "board/context", "/app/board/context", copy=True, ignore=never)
        .add_local_dir(repo / "board/briefs", "/app/board/briefs", copy=True, ignore=never)
        .add_local_dir(repo / "board/expertise", "/app/board/expertise", copy=True, ignore=never)
        .add_local_dir(repo / "glhf/specialists", "/app/glhf/specialists", copy=True, ignore=[*never, "**/*.py", "**/*.sh"])
        .add_local_dir(repo / ".agents/skills", "/app/.agents/skills", copy=True, ignore=lambda path: path.name != "SKILL.md")
        # Fail the build, not the first request, if something private got in.
        .run_commands(
            "test ! -e /app/.env && ! find /app /srv -name '.env*' -o -name '*.sqlite' -o -name '.token' | grep -q . ",
            "mkdir -p /app/board/runs /app/glhf/runs && node --version",
        )
        .add_local_file(repo / "BUILD.json" if (repo / "BUILD.json").exists() else here / "app.py", "/app/BUILD.json" if (repo / "BUILD.json").exists() else "/app/deploy/app.py.txt", copy=True)
        .add_local_file(here / "front.mjs", "/app/deploy/front.mjs", copy=True)
        .add_local_file(here / "persist.py", "/root/persist.py", copy=True)
        .add_local_file(here / "hosted.py", "/root/hosted.py", copy=True)
    )


image = build_image() if modal.is_local() else modal.Image.debian_slim()  # in the container the image already exists
secrets = [modal.Secret.from_name(ACCESS_SECRET, required_keys=["ASB_ACCESS_HASHES", "ASB_COOKIE_KEY"])]
if MODE == "real":
    secrets.append(modal.Secret.from_name(KEYS_SECRET))


@app.cls(
    image=image,
    volumes={"/data": volume},
    secrets=secrets,
    env={"ASB_HOST_MODE": MODE, **({"DRUG_BOARD_MOCK_TPS": os.environ["ASB_MOCK_TPS"]} if os.environ.get("ASB_MOCK_TPS") else {})},
    cpu=0.25,  # what is reserved and billed at least; the engine may use more for a moment and is billed for it
    memory=512,
    max_containers=1,  # never two engines on one data folder
    scaledown_window=300,  # stop five minutes after the last request
    timeout=3600,  # the longest one request (an open event stream) may last; the page connects again by itself
    startup_timeout=180,
)
@modal.concurrent(max_inputs=200)  # one container serves everybody: many requests and event streams at once
class Host:
    @modal.enter()
    def start(self) -> None:
        import hosted

        self.host = hosted.HostedApp(
            app_root=Path("/app"), volume_root=Path("/data/v1"), dashboard_dir=Path("/srv/dashboard"), front_script=Path("/app/deploy/front.mjs"),
            mode=os.environ.get("ASB_HOST_MODE", "demo"), port=PORT, commit=volume.commit,
            snapshot_seconds=float(os.environ.get("ASB_SNAPSHOT_SECONDS", "5")),
            node_args=("--max-old-space-size=512",),  # a ceiling against a runaway; the engine stays far below it
        )
        self.host.start()

    @modal.web_server(PORT, startup_timeout=120, label=LABEL)
    def web(self) -> None:
        """The front door was started in `start`. Modal waits here until the port answers."""

    @modal.exit()
    def stop(self) -> None:
        self.host.stop()
