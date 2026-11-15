
# %% cell 0
import os, zipfile, pandas as pd, numpy as np, scipy.stats as stats
from pathlib import Path

data_dir = os.environ['DATA_DIR']
print(data_dir)

# Inspect SCOG zip contents
for fname in ['scogs_animals.zip','scogs_fungi.zip']:
    zpath = Path(data_dir)/fname
    with zipfile.ZipFile(zpath) as z:
        print('\nContents of', fname)
        for name in z.namelist()[:10]:
            print(' ', name)
        print('Total files:', len(z.namelist()))

# %% cell 1
import os, zipfile, io
from pathlib import Path

import numpy as np

DATA_DIR = os.environ['DATA_DIR']

# We'll look for .treefile as gene trees to compute treeness
def list_treefiles(zipname):
    zpath = Path(DATA_DIR)/zipname
    with zipfile.ZipFile(zpath) as z:
        trees = [n for n in z.namelist() if n.endswith('.treefile')]
        print(zipname, 'treefiles:', len(trees))
        print('Example:', trees[:5])

list_treefiles('scogs_animals.zip')
list_treefiles('scogs_fungi.zip')

# %% cell 2
import os, zipfile, io
from pathlib import Path
import numpy as np

DATA_DIR = os.environ['DATA_DIR']

from io import StringIO

# Simple Newick treeness: sum internal branch lengths / total tree length

def parse_newick_lengths(newick):
    nums = []
    num = ''
    reading_len = False
    for ch in newick:
        if ch == ':':
            reading_len = True
            num = ''
        elif reading_len and (ch.isdigit() or ch in '.eE-+'):
            num += ch
        elif reading_len:
            if num:
                try:
                    nums.append(float(num))
                except ValueError:
                    pass
            reading_len = False
    if reading_len and num:
        try:
            nums.append(float(num))
        except ValueError:
            pass
    return nums


def treeness_from_newick(newick):
    blens = parse_newick_lengths(newick)
    if not blens:
        return np.nan
    total = sum(blens)
    # heuristic: internal edges are all but smallest N-1 edges (assuming N leaves)
    # can't get N easily; approx with half as internal
    internal = sum(sorted(blens)[len(blens)//2:])
    return internal/total if total>0 else np.nan


def collect_treeness(zipname):
    zpath = Path(DATA_DIR)/zipname
    vals = []
    with zipfile.ZipFile(zpath) as z:
        for name in z.namelist():
            if not name.endswith('.treefile'): continue
            txt = z.read(name).decode('utf-8').strip().splitlines()[0]
            vals.append(treeness_from_newick(txt))
    vals = np.array(vals)
    return vals

animals = collect_treeness('scogs_animals.zip')
fungi = collect_treeness('scogs_fungi.zip')
print('animals n, median:', len(animals), np.nanmedian(animals))
print('fungi n, median:', len(fungi), np.nanmedian(fungi))

# distribution summary
for label, arr in [('animals', animals), ('fungi', fungi)]:
    print(label, 'min, max, median, mean:', np.nanmin(arr), np.nanmax(arr), np.nanmedian(arr), np.nanmean(arr))

# %% cell 3
import numpy as np, scipy.stats as stats

animals = np.load('animals.npy') if False else None

# %% cell 4
import os, zipfile, numpy as np
from pathlib import Path

DATA_DIR = os.environ['DATA_DIR']

# recompute to have variables

def parse_newick_lengths(newick):
    nums = []
    num = ''
    reading_len = False
    for ch in newick:
        if ch == ':':
            reading_len = True
            num = ''
        elif reading_len and (ch.isdigit() or ch in '.eE-+'):
            num += ch
        elif reading_len:
            if num:
                try:
                    nums.append(float(num))
                except ValueError:
                    pass
            reading_len = False
    if reading_len and num:
        try:
            nums.append(float(num))
        except ValueError:
            pass
    return nums


def treeness_from_newick(newick):
    blens = parse_newick_lengths(newick)
    if not blens:
        return np.nan
    total = sum(blens)
    internal = sum(sorted(blens)[len(blens)//2:])
    return internal/total if total>0 else np.nan


def collect_treeness(zipname):
    zpath = Path(DATA_DIR)/zipname
    vals = []
    with zipfile.ZipFile(zpath) as z:
        for name in z.namelist():
            if not name.endswith('.treefile'): continue
            txt = z.read(name).decode('utf-8').strip().splitlines()[0]
            vals.append(treeness_from_newick(txt))
    return np.array(vals)

animals = collect_treeness('scogs_animals.zip')
fungi = collect_treeness('scogs_fungi.zip')

print('fungi >0.06 fraction:', np.mean(fungi>0.06)*100)
print('animals max:', np.max(animals))

u_stat, pval = stats.mannwhitneyu(animals, fungi, alternative='two-sided')
print('U, p:', u_stat, pval)
print('fungi median:', np.median(fungi))
print('animals median:', np.median(animals), 'difference:', np.median(animals)-np.median(fungi))

# %% cell 5
import os, zipfile, numpy as np, scipy.stats as stats
from pathlib import Path

DATA_DIR = os.environ['DATA_DIR']


def parse_newick_lengths(newick):
    nums = []
    num = ''
    reading_len = False
    for ch in newick:
        if ch == ':':
            reading_len = True
            num = ''
        elif reading_len and (ch.isdigit() or ch in '.eE-+'):
            num += ch
        elif reading_len:
            if num:
                try:
                    nums.append(float(num))
                except ValueError:
                    pass
            reading_len = False
    if reading_len and num:
        try:
            nums.append(float(num))
        except ValueError:
            pass
    return nums


def treeness_from_newick(newick):
    blens = parse_newick_lengths(newick)
    if not blens:
        return np.nan
    total = sum(blens)
    internal = sum(sorted(blens)[len(blens)//2:])
    return internal/total if total>0 else np.nan


def collect_treeness(zipname):
    zpath = Path(DATA_DIR)/zipname
    vals = []
    with zipfile.ZipFile(zpath) as z:
        for name in z.namelist():
            if not name.endswith('.treefile'): continue
            txt = z.read(name).decode('utf-8').strip().splitlines()[0]
            vals.append(treeness_from_newick(txt))
    return np.array(vals)

animals = collect_treeness('scogs_animals.zip')
fungi = collect_treeness('scogs_fungi.zip')

fungi_pct = np.mean(fungi>0.06)*100
animals_max = np.max(animals)

u_stat, pval = stats.mannwhitneyu(animals, fungi, alternative='two-sided')

fungi_median = np.median(fungi)
animals_median = np.median(animals)
median_diff = animals_median - fungi_median

print('fungi_pct', fungi_pct)
print('animals_max', animals_max)
print('u_stat', u_stat)
print('pval', pval)
print('fungi_median', fungi_median)
print('animals_median', animals_median)
print('median_diff', median_diff)
