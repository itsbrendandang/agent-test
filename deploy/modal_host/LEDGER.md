# Modal spend ledger for `asb-host`

Limit for this job: 10 USD, CPU only. No GPU was used.

Prices read from https://modal.com/pricing on 2026-11-14 (Functions, preemptible): CPU 0.00001314 USD per
physical core per second (minimum 0.125 core per container); memory 0.00000222 USD per GiB per second;
Volumes 0.09 USD per GiB per month with 1 TiB free; Sandboxes are 3 times the CPU and memory price (none
used here). The pricing page's own example: half a core for one hour is 0.02365 USD.

The container reserves 0.25 core and 512 MiB. Modal bills the larger of what is reserved and what is used.
The dollar figures below are estimates from these prices and wall-clock time, not Modal's invoice. The
"high" figure assumes one full core and 0.5 GiB for the whole time.

| When (UTC, 2026-11-15) | What | Container time | Estimate (reserved to high) |
|---|---|---|---|
| 02:15 | First deploy attempt: failed in the image build (a dashboard file changed under it). | 0 | builder time only |
| 02:17 to 02:39 | Deploy 1, demo. Sign-in checks, practice reviews. Modal preempted the container at 02:24:44 in mid-review; a new one continued it. Stopped with `modal app stop` at 02:39:06. | 20 min | 0.005 to 0.017 USD |
| 02:39 to 02:47 | Volume test data removed. Deploy 2 (one file per snapshot). Stop-and-resume tests: `modal container stop` at 02:41:44, `kill -9` inside the container at 02:43:18. | 7 min | 0.002 to 0.006 USD |
| 02:47 to 02:55 | Deploy 3 (sign-in fix found with a real browser). Browser checks, feature checks. | 8 min | 0.002 to 0.007 USD |
| 02:52 to 03:01 | Deploys 4 and 5 (final demo build). All checks again, three cold-start timings. | 9 min | 0.002 to 0.008 USD |
| 03:07 to 03:14 | Deploy 6: the `tester` access code removed (the old code now gets 401; the three remaining codes sign in). The container stopped by itself after 5 idle minutes. | 6 min | 0.002 to 0.005 USD |
| | Six image builds on Modal's builder, 60 to 102 s each (`npm ci` twice, `vite build`). Assumed 2 cores. | about 8 min | about 0.013 USD |
| | Volume `asb-host-data`: under 5 MB. | | 0 (inside the free 1 TiB) |
| **Total so far** | | **about 51 min of container** | **about 0.03 to 0.06 USD** |

Not verified: Modal's own bill for these minutes (the workspace's usage page shows it; other agents use
the same workspace, so the page mixes their GPU spend with this).

Left in the workspace after Stage 1: the app `asb-host` (deployed, no container while idle), the Volume
`asb-host-data` (8 practice reviews, 2 demo answers), the Secret `asb-host-access` (code hashes for
`owner`, `teammate-1`, `teammate-2` and a cookie key; no API key).
