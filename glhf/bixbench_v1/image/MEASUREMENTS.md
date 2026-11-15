# Measurements behind the Modal sandbox (2026-11-15)

From this machine (Apple Silicon, home connection) to Modal, client 1.6.4 for the first three
tables and 1.6.1 for the runs. Each number was measured once or twice: read them as sizes, not
as benchmarks.

## Getting a capsule's data into a sandbox

| Way | 89 files, 10.5 MB | 5 files, 151 MB |
|---|---|---|
| Volume, uploaded once (`batch_upload`) | 1.0 s | 0.6 s |
| Volume, uploading again when it is already there | | 0.7 s |
| Sandbox file API, one call per file, per sandbox | 6.6 s | 8.4 s |
| A tar stream into `tar -x` in the sandbox, per sandbox | 1.4 s | 23.9 s |
| Copy from the mounted Volume to `/data` inside the sandbox | | 1.8 s |
| SHA-256 of every file in the sandbox | | 1.3 s |

Decision: a Volume. It is paid once per capsule, not once per sandbox (the swarm uses two per
run), and it is the only way that does not grow with the capsule's size. Only the capsules a run
needs are uploaded. The three pilot capsules are 20 MB on the Volume.

The Volume is mounted read-only at `/mnt/bix-staged`. Modal makes a mount point a symbolic link
(`/data -> /__modal/volumes/vo-...` if mounted at `/data`), and `find /data -type f` prints
nothing through a link. So the files are copied to a real `/data` directory, the link is
removed and `/__modal` is closed to non-root users.

## Starting and ending a sandbox

| Step | Time |
|---|---|
| `Sandbox.create` returns, image already on Modal | 0.2 to 7 s |
| Whole start: create, copy data, probe (network, secrets, hashes) | 5 to 8 s |
| Copy `/outputs` out and terminate | 2 to 3 s |
| A scripted single-agent run: Docker 8 s, Modal 17 to 21 s | about +10 s per sandbox |
| `import` of the Python and R stack in a fresh sandbox (numpy, pandas, scanpy, torch; DESeq2, clusterProfiler) | 9 s each |
| First `udocker run` of the BUSCO image | 46 s |

## The image

| | |
|---|---|
| Build on Modal (base, apt from Debian's snapshot of 2024-12-30, 843 conda packages from an explicit list, kernels, udocker BUSCO) | 10 minutes |
| Size in a sandbox | `/opt/conda` 5.9 GB, `/root/.udocker` 1.2 GB |
| First attempt with Debian's snapshot of 2025-01-18 (the image's creation date) | 22 Debian packages one point release newer than the official ones; with 2024-12-30 they match |

## What Modal's runtime (gVisor) does differently

| Observation | Consequence |
|---|---|
| No `/proc/sysvipc`, no `/dev/mqueue`; `ipcs` lists nothing; `ipcrm -a` removes nothing; `mq_send` is not implemented | the one-container blind check cannot work; the critic gets a new sandbox |
| A process that passes the memory limit ends the whole sandbox | documented; `--modal-memory-gib` |
| The root filesystem is on disk, not in memory (3 GB written with a 1 GiB memory limit) | copying data to `/data` does not use the memory limit |
| `mount` is not permitted, also for root | the Volume link cannot be replaced by a bind mount |
| `su -p` keeps root's `HOME` | the provider sets `HOME` to the user's home, as `docker exec --user` does |
| Modal adds 12 environment variables (`PYTHONHASHSEED=0`, `PYTHONPATH=/pkg/:/root/`, ...) | the provider starts every command without them |
| Sandboxes ran on different clouds and regions (Azure us-east, AWS eu-west) with different processors | last digits of floating-point results can differ between runs |
