
# %% cell 0
import os, zipfile, pandas as pd, numpy as np, scipy.stats as stats
from pathlib import Path

data_dir = os.environ['DATA_DIR']
print(data_dir)
print(os.listdir(data_dir))

# %% cell 1
import os, zipfile, pandas as pd
from pathlib import Path

data_dir = os.environ['DATA_DIR']
for fn in ['scogs_animals.zip','scogs_fungi.zip']:
    zpath = os.path.join(data_dir, fn)
    with zipfile.ZipFile(zpath) as z:
        print(fn, 'files:', z.namelist()[:10])

# %% cell 2
import os, zipfile, re, io, numpy as np, pandas as pd
from pathlib import Path

# search for 'treeness' in iqtree logs

data_dir = os.environ['DATA_DIR']

rows = []
for zname, group in [('scogs_animals.zip','animal'), ('scogs_fungi.zip','fungi')]:
    zpath = os.path.join(data_dir, zname)
    with zipfile.ZipFile(zpath) as z:
        for name in z.namelist():
            if name.endswith('.iqtree'):
                with z.open(name) as f:
                    text = f.read().decode('utf-8', errors='ignore')
                m = re.search(r'Treeness[^\n]*?([0-9]*\.?[0-9]+)', text, re.IGNORECASE)
                if m:
                    val = float(m.group(1))
                    orthogroup = name.split('.')[0]
                    rows.append({'group': group, 'orthogroup': orthogroup, 'treeness': val})

print('n rows', len(rows))
df = pd.DataFrame(rows)
print(df.head())
print(df['group'].value_counts())

# save for inspection
df.to_csv('treeness_values.tsv', sep='\t', index=False)
print('saved treeness_values.tsv')

# %% cell 3
import os, zipfile, re
from pathlib import Path

# inspect one iqtree file

data_dir = os.environ['DATA_DIR']

zpath = os.path.join(data_dir, 'scogs_animals.zip')
with zipfile.ZipFile(zpath) as z:
    iqtrees = [n for n in z.namelist() if n.endswith('.iqtree')]
    print('n iqtree', len(iqtrees))
    print(iqtrees[:5])
    name = iqtrees[0]
    print('showing', name)
    text = z.read(name).decode('utf-8', errors='ignore')
    for line in text.splitlines()[:200]:
        print(line)

# %% cell 4
import os, zipfile, re, numpy as np, pandas as pd

pattern = re.compile(r'^Tree length\s*:\s*([0-9]*\.?[0-9]+)$', re.MULTILINE)

data_dir = os.environ['DATA_DIR']
rows = []
for zname, group in [('scogs_animals.zip','animal'), ('scogs_fungi.zip','fungi')]:
    zpath = os.path.join(data_dir, zname)
    with zipfile.ZipFile(zpath) as z:
        for name in z.namelist():
            if name.endswith('.iqtree'):
                text = z.read(name).decode('utf-8', errors='ignore')
                m = pattern.search(text)
                if m:
                    val = float(m.group(1))
                    og = name.split('.')[0]
                    rows.append({'group': group, 'orthogroup': og, 'treeness': val})

print('rows', len(rows))
df = pd.DataFrame(rows)
print(df.head())
print(df['group'].value_counts())
df.to_csv('treeness_values.tsv', sep='\t', index=False)

print(df['treeness'].describe())

# %% cell 5
import os, zipfile, re

# search for any line containing 'Treeness'

data_dir = os.environ['DATA_DIR']
zpath = os.path.join(data_dir, 'scogs_animals.zip')
with zipfile.ZipFile(zpath) as z:
    iqtrees = [n for n in z.namelist() if n.endswith('.iqtree')]
    for name in iqtrees[:5]:
        text = z.read(name).decode('utf-8', errors='ignore')
        hits = [l for l in text.splitlines() if 'tree' in l.lower()]
        print('---', name, '---')
        for l in hits[:20]:
            print(l)
        print()

# %% cell 6
import os, zipfile

data_dir = os.environ['DATA_DIR']

for zname in ['scogs_animals.zip','scogs_fungi.zip']:
    zpath = os.path.join(data_dir, zname)
    with zipfile.ZipFile(zpath) as z:
        treefiles = [n for n in z.namelist() if n.endswith('.treefile')]
        print(zname, 'n treefiles', len(treefiles), 'examples', treefiles[:5])

# %% cell 7
import os, zipfile, io, numpy as np

data_dir = os.environ['DATA_DIR']

# compute treeness = internal / total from iqtree logs

rows = []
for zname, group in [('scogs_animals.zip','animal'), ('scogs_fungi.zip','fungi')]:
    zpath = os.path.join(data_dir, zname)
    with zipfile.ZipFile(zpath) as z:
        for name in z.namelist():
            if name.endswith('.iqtree'):
                text = z.read(name).decode('utf-8', errors='ignore')
                total = None
                internal = None
                for line in text.splitlines():
                    line = line.strip()
                    if line.startswith('Total tree length'):
                        total = float(line.split(':')[-1].strip())
                    elif line.startswith('Sum of internal branch lengths'):
                        internal = float(line.split(':')[1].split('(')[0].strip())
                if total is not None and internal is not None and total>0:
                    treeness = internal/total
                    og = name.split('.')[0]
                    rows.append({'group': group, 'orthogroup': og, 'treeness': treeness})

print('rows', len(rows))
import pandas as pd

df = pd.DataFrame(rows)
print(df.head())
print(df['group'].value_counts())
print(df['treeness'].describe())
df.to_csv('treeness_values.tsv', sep='\t', index=False)


# %% cell 8
import pandas as pd

df = pd.read_csv('treeness_values.tsv', sep='\t')

fungi = df[df['group']=='fungi']['treeness']
animals = df[df['group']=='animal']['treeness']

fungi_median = fungi.median()
animals_median = animals.median()
print('fungi median', fungi_median)
print('animals median', animals_median)
print('difference fungi-animals', fungi_median-animals_median)
print('difference animals-fungi', animals_median-fungi_median)

pct_fungi_above = (fungi>0.06).mean()*100
print('pct fungi >0.06', pct_fungi_above)

print('max animal treeness', animals.max())

from scipy.stats import mannwhitneyu
u_stat, p_val = mannwhitneyu(animals, fungi, alternative='two-sided')
print('U', u_stat, 'p', p_val)
