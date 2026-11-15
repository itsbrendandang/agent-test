# Official arm64 image vs the Modal amd64 image

Made by `python -m bixbench_v1.modal_image diff` from the two inventories in this folder. 
Do not edit by hand. The same content, machine-readable, is `diff.json`.

- Official: `futurehouse/bixbench:aviary-notebook-env`, aarch64, "Debian GNU/Linux 12 (bookworm)" (12.7)
- Modal: `bixbench-v1-env:amd64-1` (im-zg5ZfAWty2xmm26139CpOY), x86_64, "Debian GNU/Linux 12 (bookworm)" (12.7)
- Python: official 3.12.2, Modal 3.12.2
- R: official R version 4.3.3 (2024-02-29), Modal R version 4.3.3 (2024-02-29)
- BLAS/LAPACK used by R: official `/opt/conda/lib/libopenblasp-r0.3.28.so`, Modal `/opt/conda/lib/libopenblasp-r0.3.28.so`
- `/envs/requirements.txt` identical: True
- udocker images: official ['REPOSITORY', 'ezlabgva/busco:v5.8.0_cv1    .'], Modal ['REPOSITORY', 'ezlabgva/busco:v5.8.0_cv1    .']; same layer files: True

Every arch-specific conda package is necessarily a different binary: same version, another build (453 packages). 387 conda packages are the identical file (noarch).

## Conda packages

- official: 843, Modal: 843, same name and version: 840
- Version differs: 3
  - `kernel-headers_linux-64`: official 4.18.0, Modal 3.10.0
  - `reproc`: official 14.2.4, Modal 14.2.5.post0
  - `reproc-cpp`: official 14.2.4, Modal 14.2.5.post0
- Only in the official image: 0
- Only in the Modal image: 0

## Python packages as pip sees them

- official: 254, Modal: 255, same name and version: 254
- Version differs: 0
- Only in the official image: 0
- Only in the Modal image: 1
  - `PyQt5`: 5.15.9

## R packages (installed.packages)

- official: 333, Modal: 333, same name and version: 333
- Version differs: 0
- Only in the official image: 0
- Only in the Modal image: 0

## Debian packages (dpkg)

- official: 268, Modal: 268, same name and version: 266
- Version differs: 1
  - `wget`: official 1.21.3-1+b1, Modal 1.21.3-1+b2
- Only in the official image: 1
  - `libhwasan0`: 12.2.0-14
- Only in the Modal image: 1
  - `libquadmath0`: 12.2.0-14

## Tools

| tool | official | Modal | same |
|---|---|---|---|
| R | R version 4.3.3 (2024-02-29) -- "Angel Food Cake" | R version 4.3.3 (2024-02-29) -- "Angel Food Cake" | yes |
| blastn | blastn: 2.16.0+ | blastn: 2.16.0+ | yes |
| busco_host |  |  | yes |
| bwa |  |  | yes |
| clipkit | clipkit 2.3.0 | clipkit 2.3.0 | yes |
| conda | conda 24.11.2 | conda 24.11.2 | yes |
| curl | curl 8.11.1 (aarch64-conda-linux-gnu) libcurl/8.11.1 OpenSSL/3.4.0 zlib/1.3.1 zstd/1.5.6 libssh2/1.11.1 nghttp | curl 8.11.1 (x86_64-conda-linux-gnu) libcurl/8.11.1 OpenSSL/3.4.0 zlib/1.3.1 zstd/1.5.6 libssh2/1.11.1 nghttp2 | NO |
| cutadapt | 5.0 | 5.0 | yes |
| fastqc | FastQC v0.12.1 | FastQC v0.12.1 | yes |
| gcc | gcc (Debian 12.2.0-14) 12.2.0 | gcc (Debian 12.2.0-14) 12.2.0 | yes |
| git | git version 2.39.5 | git version 2.39.5 | yes |
| glibc | ldd (Debian GLIBC 2.36-9+deb12u9) 2.36 | ldd (Debian GLIBC 2.36-9+deb12u9) 2.36 | yes |
| hmmsearch | bash: line 1: hmmsearch: command not found | bash: line 1: hmmsearch: command not found | yes |
| ipcs | /usr/bin/ipcs / /usr/bin/ipcrm / /usr/bin/ipcmk | /usr/bin/ipcs / /usr/bin/ipcrm / /usr/bin/ipcmk | yes |
| iqtree | IQ-TREE multicore version 2.3.6 for Linux ARM 64-bit built Dec 11 2024 | IQ-TREE multicore version 2.3.6 for Linux x86 64-bit built Dec 11 2024 | NO |
| iqtree2 | IQ-TREE multicore version 2.3.6 for Linux ARM 64-bit built Dec 11 2024 | IQ-TREE multicore version 2.3.6 for Linux x86 64-bit built Dec 11 2024 | NO |
| java | openjdk version "23.0.1-internal" 2024-10-15 | openjdk version "23.0.1-internal" 2024-10-15 | yes |
| jupyter | Selected Jupyter core packages... / IPython          : 8.31.0 / ipykernel        : 6.29.5 / ipywidgets       : | Selected Jupyter core packages... / IPython          : 8.31.0 / ipykernel        : 6.29.5 / ipywidgets       : | yes |
| kernelspecs | Available kernels: /   python3    /root/.local/share/jupyter/kernels/python3 /   r          /root/.local/share | Available kernels: /   python3    /root/.local/share/jupyter/kernels/python3 /   r          /root/.local/share | yes |
| mafft | v7.526 (2024/Apr/26) | v7.526 (2024/Apr/26) | yes |
| mamba | 2.0.5 | 2.0.5 | yes |
| metaeuk | 7.bba0d80 | 7.bba0d80 | yes |
| openssl | OpenSSL 3.4.0 22 Oct 2024 (Library: OpenSSL 3.4.0 22 Oct 2024) | OpenSSL 3.4.0 22 Oct 2024 (Library: OpenSSL 3.4.0 22 Oct 2024) | yes |
| perl | v5.32.1 | v5.32.1 | yes |
| phykit | phykit: error: the following arguments are required: command | phykit: error: the following arguments are required: command | yes |
| pip | pip 24.2 from /opt/conda/lib/python3.12/site-packages/pip (python 3.12) | pip 24.2 from /opt/conda/lib/python3.12/site-packages/pip (python 3.12) | yes |
| python | Python 3.12.2 | Python 3.12.2 | yes |
| samtools | bash: line 1: samtools: command not found | bash: line 1: samtools: command not found | yes |
| spades | SPAdes genome assembler v4.0.0 / /opt/conda/share/spades/spades_pipeline/support.py:488: SyntaxWarning: invali | SPAdes genome assembler v4.0.0 / /opt/conda/share/spades/spades_pipeline/support.py:488: SyntaxWarning: invali | yes |
| sqlite3 | 3.47.2 2024-12-07 20:39:59 2aabe05e2e8cae4847a802ee2daddc1d7413d8fc560254d93ee3e72c14685b6c (64-bit) | 3.47.2 2024-12-07 20:39:59 2aabe05e2e8cae4847a802ee2daddc1d7413d8fc560254d93ee3e72c14685b6c (64-bit) | yes |
| su | /usr/bin/su / /usr/sbin/useradd / /usr/bin/pkill | /usr/bin/su / /usr/sbin/useradd / /usr/bin/pkill | yes |
| trim_galore | version 0.6.10 | version 0.6.10 | yes |
| udocker | version: 1.3.17 / tarball: https://download.a.incd.pt/udocker/udocker-englib-1.2.11.tar.gz https://raw.githubu | version: 1.3.17 / tarball: https://download.a.incd.pt/udocker/udocker-englib-1.2.11.tar.gz https://raw.githubu | yes |
| wget | GNU Wget 1.21.4 built on linux-gnu. | GNU Wget 1.21.4 built on linux-gnu. | yes |
| which_python | /opt/conda/bin/python / /opt/conda/bin/python3 | /opt/conda/bin/python / /opt/conda/bin/python3 | yes |

## Environment variables

- `DEBIAN_FRONTEND`: official `noninteractive`, Modal `noninteractive`
- `LANG`: official `C.UTF-8`, Modal `C.UTF-8`
- `LC_ALL`: official `C.UTF-8`, Modal `C.UTF-8`
- `PATH`: official `/opt/conda/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`, Modal `/opt/conda/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`

Modal adds these variables to a container. The sandbox provider starts every command without them (`env -u`), so the solver's commands do not see them:

- `CFLAGS=-g0`
- `MODAL_CONTAINER_ARGUMENTS_PATH=/__modal/.container-arguments/data.bin`
- `MODAL_IMAGE_ID=im-zg5ZfAWty2xmm26139CpOY`
- `PIP_DEFAULT_TIMEOUT=30`
- `PIP_NO_CACHE_DIR=off`
- `PIP_ROOT_USER_ACTION=ignore`
- `PYTHONHASHSEED=0`
- `PYTHONPATH=/pkg/:/root/`
- `SOURCE_DATE_EPOCH=1641013200`
- `SSL_CERT_DIR=/etc/ssl/certs`
- `TERM=xterm`
- `UV_BREAK_SYSTEM_PACKAGES=1`

Left after that: none. Only in the official image: none.
