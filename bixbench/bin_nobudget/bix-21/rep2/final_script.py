
# %% cell 0
import os, zipfile, pandas as pd, numpy as np
from statistics import median

data_dir = os.environ['DATA_DIR']

zf = zipfile.ZipFile(os.path.join(data_dir, 'scogs_fungi.zip'))
print(zf.namelist())

with zf.open('scogs_fungi.tsv') as f:
    df = pd.read_csv(f, sep='\t')
print(df.columns)
print(df.head())

# guess saturation column
print([c for c in df.columns if 'satur' in c.lower()])

# inspect column names more
print(df.describe(include='all').T.head(20))

# %% cell 1
import os, zipfile, pandas as pd
from statistics import median

data_dir = os.environ['DATA_DIR']

zf = zipfile.ZipFile(os.path.join(data_dir, 'scogs_fungi.zip'))
print([n for n in zf.namelist() if n.endswith('.tsv')][:20])


# %% cell 2
import os, zipfile, pandas as pd, numpy as np

data_dir = os.environ['DATA_DIR']

zf = zipfile.ZipFile(os.path.join(data_dir, 'scogs_fungi.zip'))
# look for summary/metadata file
candidates = [n for n in zf.namelist() if any(x in n.lower() for x in ['summary','scogs','table','tsv','csv'])]
print(len(candidates))
print(candidates[:50])

# %% cell 3
import os, zipfile, re, io, numpy as np

data_dir = os.environ['DATA_DIR']

zf = zipfile.ZipFile(os.path.join(data_dir, 'scogs_fungi.zip'))
# inspect one .iqtree file for saturation info
name = [n for n in zf.namelist() if n.endswith('.iqtree')][0]
print('Using', name)
with zf.open(name) as f:
    text = f.read().decode('utf-8', errors='ignore')

for line in text.split('\n')[:200]:
    if 'Saturation' in line or 'satur' in line.lower():
        print(line)

print('\nSearching for substitution saturation test section...')
for line in text.split('\n'):
    if 'substitution saturation' in line.lower():
        print(line)


# %% cell 4
import os, zipfile, re

data_dir = os.environ['DATA_DIR']

zf = zipfile.ZipFile(os.path.join(data_dir, 'scogs_fungi.zip'))

pattern = re.compile(r"Iss\s*=\s*([0-9.]+)")
values = []
for name in zf.namelist():
    if not name.endswith('.iqtree'):
        continue
    with zf.open(name) as f:
        text = f.read().decode('utf-8', errors='ignore')
    m = pattern.search(text)
    if m:
        values.append(float(m.group(1)))

print('Found', len(values), 'Iss values')
if values:
    values.sort()
    import numpy as np
    print('Median Iss:', np.median(values))

# %% cell 5
import os, zipfile, re, numpy as np

data_dir = os.environ['DATA_DIR']

zf = zipfile.ZipFile(os.path.join(data_dir, 'scogs_fungi.zip'))

# search generically for lines with 'saturation' or 'Iss'
vals = []
for i,name in enumerate(zf.namelist()):
    if not name.endswith('.iqtree'):
        continue
    with zf.open(name) as f:
        for line_b in f:
            line = line_b.decode('utf-8', errors='ignore')
            if 'Iss' in line or 'satur' in line.lower():
                print('File', name, 'line:', line.strip())
                
print('done scan')

# %% cell 6
import os, zipfile, re, numpy as np

data_dir = os.environ['DATA_DIR']

zf = zipfile.ZipFile(os.path.join(data_dir, 'scogs_fungi.zip'))

# maybe saturation in .log
vals = []
pat = re.compile(r"satur", re.I)
for i,name in enumerate(zf.namelist()):
    if not name.endswith('.log'):
        continue
    with zf.open(name) as f:
        for line_b in f:
            line = line_b.decode('utf-8', errors='ignore')
            if pat.search(line):
                print('File', name, 'line:', line.strip())

print('scan complete')
