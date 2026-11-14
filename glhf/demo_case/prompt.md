# Analysis Task (GLHF demo case)

A toy study, small enough to run on a laptop in minutes. It exists to exercise the agents and the
grader, not to say anything about biology.

## Objective

Four samples were sequenced: two control, two treated. Each read has already been assigned to a
gene. Count reads per gene per sample, then estimate the treated-versus-control change per gene.

## Inputs

- `/data/reads.tsv`: one row per read (`read_id`, `sample`, `gene`).
- `/data/samples.tsv`: the sample sheet (`sample`, `condition`).

## Method Guidance

1. Use only samples listed in the sample sheet. Ignore reads from any other sample.
2. Ignore reads whose gene is `__unassigned`.
3. Count reads per gene per sample.
4. For each gene, `log2fc = log2((mean treated count + 1) / (mean control count + 1))`.
   Treated is the numerator.

## Software

Python 3.12 standard library only. There is no network access and nothing can be installed.

## Required Outputs

- `./outputs/gene_counts.csv`: comma-separated, columns `gene_id`, then one column per sample
  named exactly as in the sample sheet. One row per gene.
- `./outputs/treated_vs_control.csv`: comma-separated, columns `gene_id`, `log2fc`. One row per gene.
- `./outputs/METHODS.md`: what you did, and any deviation from the guidance.
