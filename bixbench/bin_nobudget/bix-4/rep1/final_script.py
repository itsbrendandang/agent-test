
# %% cell 0
import os, zipfile, pandas as pd, numpy as np, scipy.stats as stats
from pathlib import Path

data_dir = os.environ['DATA_DIR']
print(data_dir)
print(os.listdir(data_dir))

# %% cell 1
import os, zipfile, pandas as pd, numpy as np, scipy.stats as stats
from pathlib import Path

data_dir = os.environ['DATA_DIR']

for name in ['scogs_animals.zip','scogs_fungi.zip']:
    zpath = os.path.join(data_dir, name)
    with zipfile.ZipFile(zpath) as z:
        print('\n---', name, '---')
        z.printdir()

# %% cell 2
import os, zipfile, re, pandas as pd, numpy as np, scipy.stats as stats

data_dir = os.environ['DATA_DIR']

pattern = re.compile(r"(\d+at2759).*iqtree$")

def extract_dvmc_from_iqtree(text):
    for line in text.splitlines():
        if 'DVMC' in line or 'dvmc' in line:
            nums = re.findall(r"[-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?", line)
            if nums:
                return float(nums[-1])
    return None

records = []

with zipfile.ZipFile(os.path.join(data_dir,'scogs_animals.zip')) as z:
    for name in z.namelist():
        m = pattern.search(name)
        if not m:
            continue
        gene = m.group(1)
        text = z.read(name).decode('utf-8', errors='ignore')
        dvmc = extract_dvmc_from_iqtree(text)
        if dvmc is not None:
            records.append({'group':'animal','gene':gene,'DVMC':dvmc})

with zipfile.ZipFile(os.path.join(data_dir,'scogs_fungi.zip')) as z:
    for name in z.namelist():
        m = pattern.search(name)
        if not m:
            continue
        gene = m.group(1)
        text = z.read(name).decode('utf-8', errors='ignore')
        dvmc = extract_dvmc_from_iqtree(text)
        if dvmc is not None:
            records.append({'group':'fungus','gene':gene,'DVMC':dvmc})

len(records), records[:5]

# %% cell 3
print('done')

# %% cell 4
import os, zipfile, re, pandas as pd, numpy as np, scipy.stats as stats

data_dir = os.environ['DATA_DIR']

pattern = re.compile(r"(\d+at2759).*iqtree$")

def extract_dvmc_from_iqtree(text):
    for line in text.splitlines():
        if 'DVMC' in line or 'dvmc' in line:
            nums = re.findall(r"[-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?", line)
            if nums:
                return float(nums[-1])
    return None

records = []

with zipfile.ZipFile(os.path.join(data_dir,'scogs_animals.zip')) as z:
    for name in z.namelist():
        m = pattern.search(name)
        if not m:
            continue
        gene = m.group(1)
        text = z.read(name).decode('utf-8', errors='ignore')
        dvmc = extract_dvmc_from_iqtree(text)
        if dvmc is not None:
            records.append({'group':'animal','gene':gene,'DVMC':dvmc})

with zipfile.ZipFile(os.path.join(data_dir,'scogs_fungi.zip')) as z:
    for name in z.namelist():
        m = pattern.search(name)
        if not m:
            continue
        gene = m.group(1)
        text = z.read(name).decode('utf-8', errors='ignore')
        dvmc = extract_dvmc_from_iqtree(text)
        if dvmc is not None:
            records.append({'group':'fungus','gene':gene,'DVMC':dvmc})

print('N records:', len(records))
print(records[:10])

import pickle, pathlib
pathlib.Path('dvmc_records.pkl').write_bytes(pickle.dumps(records))

# %% cell 5
import os, zipfile, re

data_dir = os.environ['DATA_DIR']

with zipfile.ZipFile(os.path.join(data_dir,'scogs_animals.zip')) as z:
    names = [n for n in z.namelist() if n.endswith('.iqtree')]
    print('N iqtree:', len(names))
    print(names[:5])
    sample = names[0]
    print('Sample file:', sample)
    text = z.read(sample).decode('utf-8', errors='ignore')
    for i,line in enumerate(text.splitlines()[:200]):
        print(i, line)

# %% cell 6
import os, zipfile, re, pandas as pd, numpy as np, scipy.stats as stats

data_dir = os.environ['DATA_DIR']

pattern = re.compile(r"Tree statistics based on ([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?) trees")

records = []

with zipfile.ZipFile(os.path.join(data_dir,'scogs_animals.zip')) as z:
    for name in z.namelist():
        if not name.endswith('.iqtree'):
            continue
        text = z.read(name).decode('utf-8', errors='ignore')
        for line in text.splitlines():
            if 'DVMC' in line:
                m = pattern.search(line)
                if m:
                    dvmc = float(m.group(1))
                    gene = name.split('/')[-1].split('.faa')[0]
                    records.append({'group':'animal','gene':gene,'DVMC':dvmc})
                break

with zipfile.ZipFile(os.path.join(data_dir,'scogs_fungi.zip')) as z:
    for name in z.namelist():
        if not name.endswith('.iqtree'):
            continue
        text = z.read(name).decode('utf-8', errors='ignore')
        for line in text.splitlines():
            if 'DVMC' in line:
                m = pattern.search(line)
                if m:
                    dvmc = float(m.group(1))
                    gene = name.split('/')[-1].split('.faa')[0]
                    records.append({'group':'fungus','gene':gene,'DVMC':dvmc})
                break

print('N records:', len(records))
print(records[:10])

# %% cell 7
import os, zipfile, re

data_dir = os.environ['DATA_DIR']

with zipfile.ZipFile(os.path.join(data_dir,'scogs_animals.zip')) as z:
    name = [n for n in z.namelist() if n.endswith('.iqtree')][0]
    text = z.read(name).decode('utf-8', errors='ignore')

for line in text.splitlines():
    if 'clock' in line.lower() or 'dvmc' in line.lower():
        print(line)

# %% cell 8
import os, zipfile, re

data_dir = os.environ['DATA_DIR']

with zipfile.ZipFile(os.path.join(data_dir,'scogs_fungi.zip')) as z:
    names = [n for n in z.namelist() if n.endswith('.iqtree')]
    print('N iqtree:', len(names))
    name = names[0]
    print('Sample file:', name)
    text = z.read(name).decode('utf-8', errors='ignore')

for line in text.splitlines():
    if 'clock' in line.lower() or 'dvmc' in line.lower():
        print(line)

print('--- last 50 lines ---')
for line in text.splitlines()[-50:]:
    print(line)
