
# %% cell 0
import os, zipfile, pandas as pd
from pathlib import Path

data_dir = os.environ['DATA_DIR']
print(data_dir)

# Inspect scogs zip files
for fname in ['scogs_animals.zip','scogs_fungi.zip']:
    zpath = Path(data_dir)/fname
    with zipfile.ZipFile(zpath) as z:
        print('\nContents of', fname)
        for n in z.namelist()[:20]:
            print(' ', n)


# %% cell 1
import os, zipfile, tempfile, subprocess, textwrap, pandas as pd
from pathlib import Path

data_dir = Path(os.environ['DATA_DIR'])

# We'll parse MAFFT alignments and compute parsimony-informative sites.

am_zip = zipfile.ZipFile(data_dir/'scogs_animals.zip')
fu_zip = zipfile.ZipFile(data_dir/'scogs_fungi.zip')

print('Animal files:', len(am_zip.namelist()))
print('Fungi files:', len(fu_zip.namelist()))

# Keep only .mafft files
am_mafft = sorted([n for n in am_zip.namelist() if n.endswith('.mafft')])
fu_mafft = sorted([n for n in fu_zip.namelist() if n.endswith('.mafft')])
print('Animal mafft:', len(am_mafft))
print('Fungi mafft:', len(fu_mafft))

from collections import Counter

def parse_fasta_alignment(text):
    seqs = []
    name = None
    parts = []
    for line in text.splitlines():
        line=line.strip()
        if not line: continue
        if line.startswith('>'):
            if name is not None:
                seqs.append(''.join(parts))
            name = line[1:]
            parts = []
        else:
            parts.append(line)
    if name is not None:
        seqs.append(''.join(parts))
    return seqs


def parsimony_informative_sites(seqs):
    if not seqs:
        return 0,0
    L = len(seqs[0])
    pis = 0
    for i in range(L):
        col = [s[i] for s in seqs]
        counts = Counter([c for c in col if c not in '-?XN'])
        if len(counts) < 2:
            continue
        freqs = sorted(counts.values(), reverse=True)
        if sum(1 for v in freqs if v>=2) >= 2:
            pis += 1
    return pis, L


records = []

for grp, z, names in [('animal', am_zip, am_mafft), ('fungi', fu_zip, fu_mafft)]:
    for name in names:
        data = z.read(name).decode('utf-8', errors='ignore')
        seqs = parse_fasta_alignment(data)
        pis, L = parsimony_informative_sites(seqs)
        perc = 100*pis/L if L>0 else 0
        records.append({'group': grp, 'gene': name, 'pis': pis, 'length': L, 'perc': perc})

import pandas as pd

_df = pd.DataFrame(records)
print(_df.head())
print(_df.groupby('group')['perc'].describe())

_df.to_csv('pis_summary.csv', index=False)
print('saved pis_summary.csv')

# %% cell 2
import pandas as pd
from pathlib import Path

_df = pd.read_csv('pis_summary.csv')

# Q2: median percentage for fungi
fungi_median_perc = _df[_df.group=='fungi']['perc'].median()
print('fungi median perc', fungi_median_perc)

# Q3: ratio of lowest parsimony informative site percentages between fungi and animals
fungi_min_perc = _df[_df.group=='fungi']['perc'].min()
animal_min_perc = _df[_df.group=='animal']['perc'].min()
print('min perc fungi, animal:', fungi_min_perc, animal_min_perc)
ratio = fungi_min_perc/animal_min_perc if animal_min_perc!=0 else float('inf')
print('ratio', ratio)

# But since mins may be zero, maybe they intend smallest non-zero?
fungi_nz_min = _df[(_df.group=='fungi') & (_df.perc>0)]['perc'].min()
animal_nz_min = _df[(_df.group=='animal') & (_df.perc>0)]['perc'].min()
print('non-zero mins fungi, animal:', fungi_nz_min, animal_nz_min, 'ratio', fungi_nz_min/animal_nz_min)

# Q4: Mann-Whitney U on percentages
from scipy.stats import mannwhitneyu

an_perc = _df[_df.group=='animal']['perc']
fu_perc = _df[_df.group=='fungi']['perc']
U_perc, p_perc = mannwhitneyu(an_perc, fu_perc, alternative='two-sided')
print('Mann-Whitney on perc: U=', U_perc, 'p=', p_perc)

# Q5: maximum number of PIS in any animal gene alignment
max_pis_animal = _df[_df.group=='animal']['pis'].max()
print('max PIS animal', max_pis_animal)

# Q6: Mann-Whitney on raw PIS counts
an_pis = _df[_df.group=='animal']['pis']
fu_pis = _df[_df.group=='fungi']['pis']
U_pis, p_pis = mannwhitneyu(an_pis, fu_pis, alternative='two-sided')
print('Mann-Whitney on pis: U=', U_pis, 'p=', p_pis)
