# Evidence for the Modal sandbox image

Everything here is made by code. Do not edit by hand. See the section "The sandbox on Modal" in
`../README.md` for what it means.

| File | What | Made by |
|---|---|---|
| `arm64-official.inventory.json` | Everything installed in `futurehouse/bixbench:aviary-notebook-env` (conda, pip, R, dpkg, tools, environment) | `docker run --rm --network none -v $PWD/image/tools/inventory.py:/inventory.py:ro futurehouse/bixbench:aviary-notebook-env python /inventory.py` |
| `arm64-official.history.txt` | The official image's build history | `docker history --no-trunc` |
| `amd64-modal.inventory.json` | The same list for our Modal image | `python -m bixbench_v1.modal_image inventory` (billed) |
| `diff.json`, `DIFF.md` | The two lists compared, by package name | `python -m bixbench_v1.modal_image diff` |
| `conda-mapping.json` | How each of the 843 arm64 conda packages was mapped to a linux-64 file, and the dependency problems found (most are in the official image too) | `tools/mapenv.py`, run inside the official image |
| `equivalence.arm64-official.json`, `equivalence.amd64-modal.json` | The results of one fixed analysis in each image | `tools/equivalence.py` (Docker: as for the inventory; Modal: `python -m bixbench_v1.modal_image equivalence`, billed) |
| `equivalence.json`, `EQUIVALENCE.md` | Those results compared, digit by digit | `python -m bixbench_v1.modal_image compare-equivalence` |
| `mock-equivalence.json` | The three pilot capsules, both solvers, scripted model: Docker run against Modal run | `tools/compare_runs.py` |
| `gvisor-blind-check.json` | The adapter's blind check re-run in one Modal sandbox and in a new one, with three side channels planted | `tests/modal_sandbox_cloud_test.py` (billed) |
| `MEASUREMENTS.md` | Timings behind the design choices | written from the logs of 2026-11-15 |

The explicit package list the image is built from is in
`../src/bixbench_v1/modal_env/explicit-linux-64.txt`.
