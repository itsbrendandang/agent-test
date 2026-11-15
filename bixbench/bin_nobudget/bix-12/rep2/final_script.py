
# %% cell 0
import os, zipfile, pandas as pd
from pathlib import Path

data_dir = os.environ['DATA_DIR']
print(data_dir)

# inspect scogs zip
for fname in os.listdir(data_dir):
    if fname.startswith('scogs'):
        print(fname)
        with zipfile.ZipFile(os.path.join(data_dir, fname)) as z:
            z.printdir()


# %% cell 1
import os, zipfile, textwrap, io, numpy as np, pandas as pd
from scipy import stats

data_dir = os.environ['DATA_DIR']

# function to count parsimony-informative sites from alignment
from collections import Counter

def parsimony_informative_sites(aln):
    nseq = len(aln)
    L = len(aln[0])
    pis = 0
    for i in range(L):
        col = [seq[i] for seq in aln]
        counts = Counter([c for c in col if c != '-' and c != 'X' and c != 'x' and c != 'N' and c != 'n'])
        if len(counts) < 2:
            continue
        if sum(1 for v in counts.values() if v>=2) >= 2:
            pis += 1
    return pis, L

fungi_pis = []
with zipfile.ZipFile(os.path.join(data_dir, 'scogs_fungi.zip')) as z:
    for name in z.namelist():
        if not name.endswith('.mafft'):
            continue
        with z.open(name) as f:
            seqs = []
            seq = ''
            for line in io.TextIOWrapper(f):
                line=line.strip()
                if not line: continue
                if line.startswith('>'):
                    if seq:
                        seqs.append(seq)
                        seq=''
                else:
                    seq+=line
            if seq:
                seqs.append(seq)
        if len(seqs)==0:
            continue
        pis, L = parsimony_informative_sites(seqs)
        fungi_pis.append({'gene':name,'pis':pis,'len':L,'pct':pis/L*100})

fungi_df = pd.DataFrame(fungi_pis)
print('fungi genes', len(fungi_df))
print(fungi_df['pct'].describe())

animals_pis = []
with zipfile.ZipFile(os.path.join(data_dir, 'scogs_animals.zip')) as z:
    for name in z.namelist():
        if not name.endswith('.mafft'):
            continue
        with z.open(name) as f:
            seqs = []
            seq = ''
            for line in io.TextIOWrapper(f):
                line=line.strip()
                if not line: continue
                if line.startswith('>'):
                    if seq:
                        seqs.append(seq)
                        seq=''
                else:
                    seq+=line
            if seq:
                seqs.append(seq)
        if len(seqs)==0:
            continue
        pis, L = parsimony_informative_sites(seqs)
        animals_pis.append({'gene':name,'pis':pis,'len':L,'pct':pis/L*100})

animals_df = pd.DataFrame(animals_pis)
print('animals genes', len(animals_df))
print(animals_df['pct'].describe())

# questions
fungi_median_pct = fungi_df['pct'].median()
print('fungi median pct', fungi_median_pct)

fungi_min_pct = fungi_df['pct'].min()
animals_min_pct = animals_df['pct'].min()
print('min pct fungi, animals', fungi_min_pct, animals_min_pct, 'ratio fungi/animals', fungi_min_pct/animals_min_pct)

# Mann-Whitney U for pct
u_pct, p_pct = stats.mannwhitneyu(animals_df['pct'], fungi_df['pct'], alternative='two-sided')
print('U pct', u_pct, 'p', p_pct)

# max pis animals
max_pis_animals = animals_df['pis'].max()
print('max pis animals', max_pis_animals)

# Mann-Whitney U for raw pis counts
u_pis, p_pis = stats.mannwhitneyu(animals_df['pis'], fungi_df['pis'], alternative='two-sided')
print('U pis', u_pis, 'p', p_pis)

# save for inspection
fungi_df.to_csv('fungi_parsimony.csv', index=False)
animals_df.to_csv('animals_parsimony.csv', index=False)

