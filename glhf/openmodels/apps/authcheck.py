"""A CPU-only stand-in for a served model, to test the endpoint's lock without paying for a GPU.

It is declared exactly like the model servers (`@app.server`, no `unauthenticated=True`, one
container, scales to zero) but runs Python's file server on one small CPU. `uv run openmodels
authcheck` deploys it, checks that every path answers 401 without the key and with a wrong key
and that the model list answers 200 with the key, and stops it. It holds no model.
"""

import subprocess

import modal

APP_NAME = "openmodels-authcheck"
PORT = 8000

app = modal.App(APP_NAME)


@app.server(
    image=modal.Image.debian_slim(python_version="3.12"),
    cpu=1,
    memory=1024,
    port=PORT,
    startup_timeout=120,
    scaledown_window=60,
    min_containers=0,
    max_containers=1,
)
class Server:
    @modal.enter()
    def start(self) -> None:
        subprocess.run(
            'mkdir -p /srv/v1 && echo \'{"object": "list", "data": []}\' > /srv/v1/models',
            shell=True,
            check=True,
        )
        self.process = subprocess.Popen(
            ["python", "-m", "http.server", str(PORT), "--bind", "0.0.0.0", "--directory", "/srv"]
        )

    @modal.exit()
    def stop(self) -> None:
        self.process.terminate()
