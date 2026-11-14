# Agent notes

> Note from team GLHF: the text below is from the upstream BixBench3 repository. The bucket
> `gs://phdval-runner-workspaces/launch-test` and the project `edsci-evals` belong to the upstream
> authors, not to us. Team GLHF has no Google Cloud project yet and has started no cloud run.
> Our rules for coding agents are in the `AGENTS.md` at the repository root. Never start a cloud
> run unless the user asks for it.

## Cloud run outputs

When launching `bixbench3 run`, always pass:

```text
--results-bucket gs://phdval-runner-workspaces/launch-test
```

Campaigns for Opus 5, GPT-5.6 Sol, and Kimi K3 used this prefix. Without it, agent artifacts, broker logs, and extra run files are deleted with the VM. `complete` still copies `grade.json` / `judge.json` locally, but the full bundle is lost.

Project for these evals: `edsci-evals`.
