
# %% cell 0
import os, zipfile, pandas as pd, numpy as np
from pathlib import Path

print(os.environ['DATA_DIR'])

# %% cell 1
import os, zipfile, pandas as pd, numpy as np, subprocess, textwrap, math
from pathlib import Path
DATA_DIR=os.environ['DATA_DIR']

for fn in ['scogs_animals.zip','scogs_fungi.zip']:
    p=Path(DATA_DIR)/fn
    with zipfile.ZipFile(p) as z:
        names=[n for n in z.namelist() if n.endswith('.tsv') or n.endswith('.csv') or n.endswith('.txt')]
        print(fn, '->', names[:10])
        # inspect first tsv
        if names:
            with z.open(names[0]) as f:
                head=b"".join([next(f) for _ in range(5)])
                print(names[0],"\n",head.decode())

# %% cell 2
import zipfile, os, textwrap
from pathlib import Path
DATA_DIR=os.environ['DATA_DIR']

for fn in ['scogs_animals.zip','scogs_fungi.zip']:
    p=Path(DATA_DIR)/fn
    with zipfile.ZipFile(p) as z:
        names=z.namelist()
        print(fn, 'count', len(names))
        print(names[:20])

# %% cell 3
import os, zipfile, re, numpy as np, pandas as pd, io, math
from pathlib import Path
DATA_DIR=os.environ['DATA_DIR']

fungi_zip=zipfile.ZipFile(Path(DATA_DIR)/'scogs_fungi.zip')
# find iqtree log-like files that might have DVMC
logs=[n for n in fungi_zip.namelist() if n.endswith('.iqtree') or n.endswith('.log')]
print('logs', len(logs)); print(logs[:20])

# inspect one iqtree file
name=logs[0]
print('sampling', name)
with fungi_zip.open(name) as f:
    txt=f.read().decode('utf-8','ignore').splitlines()
for line in txt[:200]:
    if 'DVMC' in line or 'molecular clock' in line.lower():
        print(line)
print('\n--- tail ---')
for line in txt[-200:]:
    if 'DVMC' in line or 'molecular clock' in line.lower():
        print(line)

print('\nexample lines head:')
print('\n'.join(txt[:40]))

# %% cell 4
# compute DVMC via phykit-style for all iqtree logs
import os, zipfile, re, numpy as np, pandas as pd, io, math
from pathlib import Path
from statistics import mean, pstdev

DATA_DIR=os.environ['DATA_DIR']

animals_zip=zipfile.ZipFile(Path(DATA_DIR)/'scogs_animals.zip')
fungi_zip=zipfile.ZipFile(Path(DATA_DIR)/'scogs_fungi.zip')


def parse_branch_lengths_iqtree(text):
    in_tree=False
    taxa=[]
    blens=[]
    for line in text.splitlines():
        if line.strip().startswith('List of extant taxa and their distances to root'):
            in_tree=True
            continue
        if in_tree:
            if not line.strip():
                break
            m=re.match(r"^(\S+)\s+([0-9.eE+-]+)$", line.strip())
            if m:
                taxa.append(m.group(1))
                blens.append(float(m.group(2)))
    return blens


def dvmc_from_blens(blens):
    if len(blens)<2:
        return math.nan
    return float(np.std(blens, ddof=1))


def collect_dvmc(z):
    rows=[]
    for name in z.namelist():
        if not (name.endswith('.iqtree') or name.endswith('.log')):
            continue
        with z.open(name) as f:
            txt=f.read().decode('utf-8','ignore')
        bl=parse_branch_lengths_iqtree(txt)
        if len(bl)<2:
            continue
        d=dvmc_from_blens(bl)
        ortholog=re.match(r"(\d+at2759)\.faa", name)
        if ortholog:
            orth=ortholog.group(1)
        else:
            orth=name.split('/')[-1]
        rows.append({'ortholog':orth,'file':name,'dvmc':d})
    return pd.DataFrame(rows)

animals_df=collect_dvmc(animals_zip)
fungi_df=collect_dvmc(fungi_zip)
print('animals', animals_df.shape)
print(animals_df.head())
print('fungi', fungi_df.shape)
print(fungi_df.head())

print('animal DVMC median', animals_df['dvmc'].median())
print('fungal DVMC median', fungi_df['dvmc'].median())

# fungi with dvmc<0.3
pct_fungi_lt_03=(fungi_df['dvmc']<0.3).mean()*100
print('pct fungi <0.3', pct_fungi_lt_03)

# std dev of animal dvmc
print('std animal dvmc', animals_df['dvmc'].std(ddof=1))
print('max animal dvmc', animals_df['dvmc'].max())

# DVMC for specific ortholog
print('324863at2759 in fungi?', fungi_df[fungi_df['ortholog']=='324863at2759'])


# %% cell 5
# inspect one .log that likely has distances to root
import os, zipfile, re
from pathlib import Path
DATA_DIR=os.environ['DATA_DIR']

fungi_zip=zipfile.ZipFile(Path(DATA_DIR)/'scogs_fungi.zip')
name=[n for n in fungi_zip.namelist() if n.endswith('.log')][0]
print('using', name)
with fungi_zip.open(name) as f:
    txt=f.read().decode('utf-8','ignore')

for i,line in enumerate(txt.splitlines()[:400]):
    if 'distances to root' in line:
        print('found at', i, line)

print('\ncontext:')
lines=txt.splitlines()
for i in range(200,260):
    print(i, lines[i])

# %% cell 6
# search in one .iqtree for 'List of extant taxa'
import os, zipfile
from pathlib import Path
DATA_DIR=os.environ['DATA_DIR']

fungi_zip=zipfile.ZipFile(Path(DATA_DIR)/'scogs_fungi.zip')
name=[n for n in fungi_zip.namelist() if n.endswith('.iqtree')][0]
print('using', name)
with fungi_zip.open(name) as f:
    txt=f.read().decode('utf-8','ignore')

for i,line in enumerate(txt.splitlines()):
    if 'List of extant taxa' in line:
        print('found at', i, line)
        for j in range(i, i+40):
            print(j, txt.splitlines()[j])
        break
else:
    print('no List of extant taxa section found')

# %% cell 7
# search for 'Root-to-tip' patterns in iqtree file
import os, zipfile, re
from pathlib import Path
DATA_DIR=os.environ['DATA_DIR']
fungi_zip=zipfile.ZipFile(Path(DATA_DIR)/'scogs_fungi.zip')
name=[n for n in fungi_zip.namelist() if n.endswith('.iqtree')][0]
with fungi_zip.open(name) as f:
    txt=f.read().decode('utf-8','ignore')

for pat in ['root-to-tip','root to tip','Clock','DVMC','molecular clock','Rate']:    
    print('pattern', pat)
    for line in txt.splitlines():
        if pat.lower() in line.lower():
            print(' ', line)
            break

# %% cell 8
# list tail of iqtree file to ensure no truncated
import os, zipfile
from pathlib import Path
DATA_DIR=os.environ['DATA_DIR']
fungi_zip=zipfile.ZipFile(Path(DATA_DIR)/'scogs_fungi.zip')
name=[n for n in fungi_zip.namelist() if n.endswith('.iqtree')][0]
with fungi_zip.open(name) as f:
    lines=f.read().decode('utf-8','ignore').splitlines()

print('\n'.join(lines[-80:]))

# %% cell 9
# compute DVMC from terminal branch lengths in newick tree section of iqtree logs
import os, zipfile, re, numpy as np, pandas as pd, math
from pathlib import Path
DATA_DIR=os.environ['DATA_DIR']

animals_zip=zipfile.ZipFile(Path(DATA_DIR)/'scogs_animals.zip')
fungi_zip=zipfile.ZipFile(Path(DATA_DIR)/'scogs_fungi.zip')


def extract_newick_terminal_lengths(text):
    # find line starting with '(' and ending with ');'
    tree=None
    for line in text.splitlines():
        if line.strip().startswith('(') and line.strip().endswith(');'):
            tree=line.strip().rstrip(';')
            break
    if tree is None:
        return []
    # find name:length patterns at leaves (names without internal parentheses after)
    # regex: (taxon:[0-9.eE+-]+)
    pairs=re.findall(r"([A-Za-z0-9_\.]+):([0-9.eE+-]+)", tree)
    # unique taxa
    lengths={name:float(bl) for name,bl in pairs}
    return list(lengths.values())


def dvmc_from_blens(blens):
    if len(blens)<2:
        return math.nan
    return float(np.std(blens, ddof=1))


def collect_dvmc(z,label):
    rows=[]
    for name in z.namelist():
        if not name.endswith('.iqtree'):
            continue
        with z.open(name) as f:
            txt=f.read().decode('utf-8','ignore')
        bl=extract_newick_terminal_lengths(txt)
        if len(bl)<2:
            continue
        d=dvmc_from_blens(bl)
        m=re.search(r"(\d+at2759)\.faa", name)
        orth=m.group(1) if m else name
        rows.append({'ortholog':orth,'file':name,'dvmc':d,'group':label})
    return pd.DataFrame(rows)

animals_df=collect_dvmc(animals_zip,'animal')
fungi_df=collect_dvmc(fungi_zip,'fungus')

print('animals', animals_df.shape)
print(animals_df.head())
print('fungi', fungi_df.shape)
print(fungi_df.head())

print('animal DVMC median', animals_df['dvmc'].median())
print('fungal DVMC median', fungi_df['dvmc'].median())

# fungi with dvmc<0.3
pct_fungi_lt_03=(fungi_df['dvmc']<0.3).mean()*100
print('pct fungi <0.3', pct_fungi_lt_03)

print('std animal dvmc', animals_df['dvmc'].std(ddof=1))
print('max animal dvmc', animals_df['dvmc'].max())

print('324863at2759:', fungi_df[fungi_df['ortholog']=='324863at2759'])

# Mann-Whitney U
from scipy.stats import mannwhitneyu
u_stat, p = mannwhitneyu(animals_df['dvmc'], fungi_df['dvmc'], alternative='two-sided')
print('Mann-Whitney U', u_stat, 'p', p)

