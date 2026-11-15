
# %% cell 0
import os, zipfile, pandas as pd
from pathlib import Path

data_dir = os.environ['DATA_DIR']
print(data_dir)

# Inspect scogs zip contents
for fname in ['scogs_animals.zip','scogs_fungi.zip']:
    zpath = Path(data_dir)/fname
    with zipfile.ZipFile(zpath) as z:
        print('\nContents of', fname)
        for n in z.namelist()[:10]:
            print(' ', n)
        print('Total files:', len(z.namelist()))

# %% cell 1
import os, zipfile, textwrap, subprocess, json, statistics as stats
from pathlib import Path

import numpy as np

DATA_DIR = os.environ['DATA_DIR']

# We'll compute parsimony-informative sites from the MAFFT alignments (.faa.mafft)

def parse_fasta_alignment(lines):
    seqs = []
    cur = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        if line.startswith('>'):
            if cur:
                seqs.append(''.join(cur))
                cur = []
        else:
            cur.append(line)
    if cur:
        seqs.append(''.join(cur))
    return seqs


def alignment_pi_stats_from_zip(zip_path):
    import zipfile
    pi_counts = []
    pi_percents = []
    with zipfile.ZipFile(zip_path) as z:
        for name in z.namelist():
            if not name.endswith('.faa.mafft'):
                continue
            with z.open(name) as fh:
                lines = [l.decode('utf-8') for l in fh]
            seqs = parse_fasta_alignment(lines)
            if not seqs:
                continue
            L = len(seqs[0])
            arr = np.array([list(s) for s in seqs])
            col_pi = 0
            for j in range(L):
                col = arr[:, j]
                # exclude gaps and ambiguous
                col = col[(col != '-') & (col != 'X') & (col != 'x') & (col != 'N') & (col != 'n') & (col != '?')]
                vals, counts = np.unique(col, return_counts=True)
                # parsimony-informative for >=2 states, each with count>=2
                if len(vals) >= 2 and np.sum(counts >= 2) >= 2:
                    col_pi += 1
            pi_counts.append(col_pi)
            pi_percents.append(100.0 * col_pi / L if L>0 else 0.0)
    return np.array(pi_counts), np.array(pi_percents)

animals_zip = Path(DATA_DIR)/'scogs_animals.zip'
fungi_zip = Path(DATA_DIR)/'scogs_fungi.zip'

ani_counts, ani_perc = alignment_pi_stats_from_zip(animals_zip)
fun_counts, fun_perc = alignment_pi_stats_from_zip(fungi_zip)

print('Animals alignments:', len(ani_perc))
print('Fungi alignments:', len(fun_perc))
print('Example animals perc:', ani_perc[:10])
print('Example fungi perc:', fun_perc[:10])

print('Fungi median % PI:', np.median(fun_perc))
print('Min % PI fungi, animals:', fun_perc.min(), ani_perc.min())
print('Ratio min fungi/animals:', fun_perc.min()/ani_perc.min())

from scipy.stats import mannwhitneyu

u_perc, p_perc = mannwhitneyu(ani_perc, fun_perc, alternative='two-sided')
print('Mann-Whitney U (percent):', u_perc, 'p=', p_perc)

u_counts, p_counts = mannwhitneyu(ani_counts, fun_counts, alternative='two-sided')
print('Mann-Whitney U (counts):', u_counts, 'p=', p_counts)

print('Max PI count animals:', ani_counts.max())
