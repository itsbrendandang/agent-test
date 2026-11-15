
# %% cell 0
import os, zipfile, pandas as pd, numpy as np
from scipy import stats

data_dir = os.environ['DATA_DIR']

# Inspect scogs zip files
for fname in ['scogs_animals.zip','scogs_fungi.zip']:
    zpath = os.path.join(data_dir, fname)
    with zipfile.ZipFile(zpath) as z:
        print(fname, 'files:', z.namelist()[:10])

# %% cell 1
# maybe treeness precomputed file?
import os, glob

data_dir = os.environ['DATA_DIR']
print('all files:', os.listdir(data_dir))

# %% cell 2
# maybe iqtree logs contain treeness? search in one
import os, zipfile, re
from io import TextIOWrapper

data_dir = os.environ['DATA_DIR']

with zipfile.ZipFile(os.path.join(data_dir,'scogs_animals.zip')) as z:
    log_files = [f for f in z.namelist() if f.endswith('.iqtree')]
    print('n iqtree', len(log_files), 'example', log_files[:3])
    name = log_files[0]
    with z.open(name) as fh:
        txt = fh.read().decode('utf-8','ignore')
print(txt[:4000])

# %% cell 3
# treeness likely in .treefile; compute ourselves would be heavy. inspect treefile
import os, zipfile

data_dir = os.environ['DATA_DIR']
with zipfile.ZipFile(os.path.join(data_dir,'scogs_animals.zip')) as z:
    trees = [f for f in z.namelist() if f.endswith('.treefile')]
    print('n trees', len(trees), 'example', trees[:3])
    name = trees[0]
    with z.open(name) as fh:
        print(fh.read().decode('utf-8')[:500])

# %% cell 4
# compute treeness = internal branch length sum / total tree length
from io import StringIO
from Bio import Phylo
import os, zipfile, numpy as np, pandas as pd

data_dir = os.environ['DATA_DIR']

cols = ['og','group','treeness']
rows = []

for group,zipname in [('animals','scogs_animals.zip'),('fungi','scogs_fungi.zip')]:
    zpath = os.path.join(data_dir, zipname)
    with zipfile.ZipFile(zpath) as z:
        trees = [f for f in z.namelist() if f.endswith('.treefile')]
        for t in trees:
            og = os.path.basename(t).split('.')[0]
            newick = z.read(t).decode('utf-8').strip()
            tree = Phylo.read(StringIO(newick),'newick')
            bls = [cl.branch_length for cl in tree.find_clades() if cl.branch_length]
            total = sum(bls)
            internal = sum(cl.branch_length for cl in tree.get_nonterminals() if cl.branch_length)
            rows.append((og,group,internal/total if total>0 else np.nan))

_df = pd.DataFrame(rows, columns=cols)
print(_df.head())
print(_df.groupby('group')['treeness'].describe())

_df.to_csv('treeness_values.csv', index=False)
print('saved treeness_values.csv')

# %% cell 5
# implement simple Newick parser for this small fixed 4-taxon tree
import os, zipfile, numpy as np, pandas as pd

data_dir = os.environ['DATA_DIR']

cols = ['og','group','treeness']
rows = []

for group,zipname in [('animals','scogs_animals.zip'),('fungi','scogs_fungi.zip')]:
    zpath = os.path.join(data_dir, zipname)
    with zipfile.ZipFile(zpath) as z:
        trees = [f for f in z.namelist() if f.endswith('.treefile')]
        for t in trees:
            og = os.path.basename(t).split('.')[0]
            newick = z.read(t).decode('utf-8').strip().rstrip(';')
            # extract branch lengths as floats after ':'
            parts = newick.replace('(','').replace(')','').split(',')
            bls = []
            for p in parts:
                if ':' in p:
                    try:
                        bl = float(p.split(':')[-1])
                        bls.append(bl)
                    except ValueError:
                        pass
            total = sum(bls)
            # internal branches: assume pattern (A:x,(B:y,C:z):w,D:u) so internal= w
            internal = 0.0
            # find numbers just before commas or end that are not leaves? simplify: internal = smallest length? but not robust
            # Instead, parse by counting parentheses to find internal edge: substring ")" followed by ":len"
            idx = newick.find('):')
            if idx!=-1:
                sub = newick[idx+2:]
                end = sub.find(',')
                if end==-1:
                    end = len(sub)
                try:
                    internal = float(sub[:end])
                except ValueError:
                    internal = 0.0
            rows.append((og,group,internal/total if total>0 else np.nan))

_df = pd.DataFrame(rows, columns=cols)
print(_df.head())
print(_df.groupby('group')['treeness'].describe())
_df.to_csv('treeness_values.csv', index=False)

# %% cell 6
import pandas as pd
from scipy import stats

_df = pd.read_csv('treeness_values.csv')
animals = _df[_df['group']=='animals']['treeness']
fungi = _df[_df['group']=='fungi']['treeness']

median_animals = animals.median()
median_fungi = fungi.median()
print('median animals', median_animals)
print('median fungi', median_fungi)
print('difference fungi-animals', median_fungi-median_animals)

perc_fungi_above = (fungi>0.06).mean()*100
print('perc fungi treeness>0.06', perc_fungi_above)

print('max animal treeness', animals.max())

u_stat, p_val = stats.mannwhitneyu(animals, fungi, alternative='two-sided')
print('U', u_stat, 'p', p_val)
