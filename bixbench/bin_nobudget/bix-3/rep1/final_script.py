
# %% cell 0
import os
import pandas as pd
print(os.environ['DATA_DIR'])
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(path)
print(xl.sheet_names)
for s in xl.sheet_names:
    print('---', s, '---')
    print(pd.read_excel(path, sheet_name=s, nrows=5).head())

# %% cell 1
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
nc = pd.read_excel(path, sheet_name='NormCount')
print(nc.head(10))
print(nc.columns[:40])

# %% cell 2
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
nc = pd.read_excel(path, sheet_name='NormCount')
print(nc.iloc[:5, :20])
print(nc.iloc[:5, 20:40])
print(nc.columns[160:])

# %% cell 3
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
nc = pd.read_excel(path, sheet_name='NormCount')
header = nc.iloc[2]
print(header[:40])

samples = header[2:160]
print(samples.head(20))
print(samples.tail(20))
print('n samples', len(samples))

# %% cell 4
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
nc = pd.read_excel(path, sheet_name='NormCount')
header = nc.iloc[2]

# Build count matrix
counts = nc.iloc[3:, :160].copy()
counts.columns = header[:160]
counts = counts.rename(columns={'Unnamed: 0':'Index','Unnamed: 1':'GeneID'})
counts.index = counts['GeneID']
counts = counts.drop(columns=['Index','GeneID'])
counts = counts.apply(pd.to_numeric)
print(counts.shape)
print(counts.columns[:40])

# subset Control samples: those starting with 'Control_'
control_cols = [c for c in counts.columns if isinstance(c,str) and c.startswith('Control_')]
print('n control samples', len(control_cols))
print(control_cols)

ctrl_counts = counts[control_cols]

# define tissue from name
import re
sample_info = []
for c in control_cols:
    if 'baseline_blood' in c:
        tissue = 'baseline_blood'
    elif 'final_blood' in c:
        tissue = 'final_blood'
    elif 'dentate_gyrus' in c:
        tissue = 'dentate_gyrus'
    else:
        tissue = 'other'
    sample_info.append({'sample':c,'tissue':tissue})

import pandas as pd
coldata = pd.DataFrame(sample_info).set_index('sample')
print(coldata['tissue'].value_counts())


# %% cell 5
import os, pandas as pd, numpy as np
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
nc = pd.read_excel(path, sheet_name='NormCount')
header = nc.iloc[2]
counts = nc.iloc[3:, :160].copy()
counts.columns = header[:160]
counts = counts.rename(columns={'Unnamed: 0':'Index','Unnamed: 1':'GeneID'})
counts.index = counts['GeneID']
counts = counts.drop(columns=['Index','GeneID'])
counts = counts.replace('-', np.nan)
counts = counts.apply(pd.to_numeric)
print(counts.shape)
control_cols = [c for c in counts.columns if isinstance(c,str) and c.startswith('Control_')]
print('n control', len(control_cols))
print(control_cols)
import pandas as pd
sample_info = []
for c in control_cols:
    if 'baseline_blood' in c:
        tissue = 'baseline_blood'
    elif 'final_blood' in c:
        tissue = 'final_blood'
    elif 'dentate_gyrus' in c:
        tissue = 'dentate_gyrus'
    else:
        tissue = 'other'
    sample_info.append({'sample':c,'tissue':tissue})
coldata = pd.DataFrame(sample_info).set_index('sample')
print(coldata['tissue'].value_counts())

# %% cell 6
import os, pandas as pd, numpy as np
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
nc = pd.read_excel(path, sheet_name='NormCount')
header = nc.iloc[2]
counts = nc.iloc[3:, :160].copy()
counts.columns = header[:160]
counts = counts.rename(columns={'Unnamed: 0':'Index','Unnamed: 1':'GeneID'})
counts.index = counts['GeneID']
counts = counts.drop(columns=['Index','GeneID'])
# find non-numeric entries
import pandas as pd
mask = ~counts.applymap(lambda x: isinstance(x,(int,float)))
print(mask.sum().sum())
print(counts[mask.any(axis=1)].head())

# %% cell 7
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
# read with proper header rows so numeric columns
nc = pd.read_excel(path, sheet_name='NormCount', header=[0,1,2])
print(nc.head())
print(nc.columns[:20])

# %% cell 8
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
# Load NormCount to inspect comparison annotations
nc = pd.read_excel(path, sheet_name='NormCount')
print(nc.columns[160:188])
print(nc.iloc[:10,160:188])

# %% cell 9
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
nc = pd.read_excel(path, sheet_name='NormCount')
header = nc.iloc[2]
print(header[160:188])
# columns for Comparison8
cols8 = ['DESeq, Comparison 8, exclude outliers'] + [c for c in nc.columns[162:171]]
print(cols8)
print(header[cols8])
print(nc.iloc[3:8, [nc.columns.get_loc(c) for c in cols8]])

# %% cell 10
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
nc = pd.read_excel(path, sheet_name='NormCount')
header = nc.iloc[2]

# function to get DESeq results for given comparison index

def get_comparison(idx):
    base_col = f'DESeq, Comparison {idx}, exclude outliers'
    start = nc.columns.get_loc(base_col)
    cols = nc.columns[start:start+9]
    sub = nc.iloc[3:, cols].copy()
    sub.columns = header[cols]
    sub.insert(0,'GeneID', nc.iloc[3:,1].values)
    return sub

for i in range(1,10):
    try:
        sub = get_comparison(i)
    except Exception as e:
        print('fail',i,e)
        continue
    print('comp', i, 'cols', sub.columns)
    print(sub.head(3))
    print()


# %% cell 11
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
nc = pd.read_excel(path, sheet_name='NormCount')
header = nc.iloc[2]

# locate comparison 6-9 blocks explicitly
for col in nc.columns:
    if isinstance(col,str) and col.startswith('DESeq, Comparison'):
        print(col, nc.columns.get_loc(col))

# inspect around comparison 6-9
for name in ['DESeq, Comparison 6, exclude outliers','DESeq, Comparison 7, exclude outliers','DESeq, Comparison 8, exclude outliers','DESeq, Comparison 9, exclude outliers']:
    idx = nc.columns.get_loc(name)
    print('\n', name, 'start', idx)
    print(header[idx:idx+9])

# %% cell 12
import os, pandas as pd
from math import sqrt
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
nc = pd.read_excel(path, sheet_name='NormCount')
header = nc.iloc[2]

# helper
from math import erf

def wilson_ci(k, n, z=1.96):
    if n==0:
        return (0.0,0.0)
    p = k/n
    denom = 1+z**2/n
    center = (p + z**2/(2*n)) / denom
    half = z*sqrt(p*(1-p)/n + z**2/(4*n**2)) / denom
    return center-half, center+half

# get DESeq comparison result

def get_res(idx):
    start = nc.columns.get_loc(f'DESeq, Comparison {idx}, exclude outliers')
    cols = list(range(start, start+9))
    sub = nc.iloc[3:, cols].copy()
    sub.columns = header.iloc[cols]
    sub.insert(0,'GeneID', nc.iloc[3:,1].values)
    return sub

res6 = get_res(6)
print(res6.head())

# Identify which comparisons correspond to which contrasts using the DEG summary columns
for comp in range(1,10):
    col = f'Comparison{comp}'
    if col not in nc.columns: continue
    deg_flags = nc.iloc[3:, nc.columns.get_loc(col)]
    print(col, 'unique flags:', set(deg_flags.dropna().unique()))

print('\nPreview DEG flags for Comparison6:')
col6 = 'Comparison6'
ix = nc.columns.get_loc(col6)
print(nc.iloc[2:10, ix])

# %% cell 13
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
ms = pd.read_excel(path, sheet_name='Mapping_statistics')
print(ms.head())
print(ms.columns)


# %% cell 14
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
ms = pd.read_excel(path, sheet_name='Mapping_statistics')
print(ms['DESeq'].unique())
print(ms[['Code','DESeq','Response','Tissue']].dropna().head(20))

# %% cell 15
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
ms = pd.read_excel(path, sheet_name='Mapping_statistics')

print(ms[['Code','Response','Tissue']].dropna().drop_duplicates().tail(40))

# %% cell 16
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
nc = pd.read_excel(path, sheet_name='NormCount')
header = nc.iloc[2]

# function to fetch DESeq block

def get_block(i):
    start = nc.columns.get_loc(f'DESeq, Comparison {i}, exclude outliers')
    cols = list(range(start, start+9))
    sub = nc.iloc[3:, cols].copy()
    sub.columns = header.iloc[cols]
    sub.insert(0,'GeneID', nc.iloc[3:,1].values)
    return sub

blocks = {i:get_block(i) for i in range(1,10)}
for i,b in blocks.items():
    print('\nComp', i, 'example rows:')
    print(b.head(3))
    # summary of padj and log2FC
    print('padj min/max', b['padj'].min(), b['padj'].max())

# %% cell 17
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
nc = pd.read_excel(path, sheet_name='NormCount')
header = nc.iloc[2]

from math import sqrt

def wilson_ci(k, n, z=1.96):
    if n==0:
        return (0.0,0.0)
    p = k/n
    denom = 1+z**2/n
    center = (p + z**2/(2*n)) / denom
    half = z*sqrt(p*(1-p)/n + z**2/(4*n**2)) / denom
    return center-half, center+half


def get_block_meta(i):
    start = nc.columns.get_loc(f'DESeq, Comparison {i}, exclude outliers')
    cols = list(range(start, start+9))
    sub = nc.iloc[3:, cols]
    # identify columns by header row
    h = header.iloc[cols]
    col_lfc = cols[h.eq('log2FoldChange')][0]
    col_padj = cols[h.eq('padj')][0]
    col_bm = cols[h.eq('baseMean')][0]
    lfc = pd.to_numeric(nc.iloc[3:, col_lfc], errors='coerce')
    padj = pd.to_numeric(nc.iloc[3:, col_padj], errors='coerce')
    bm = pd.to_numeric(nc.iloc[3:, col_bm], errors='coerce')
    sig = (padj<0.05) & (lfc.abs()>1) & (bm>=10)
    n = sig.notna().sum()
    k = sig.sum()
    ci = wilson_ci(int(k), int(n))
    return {'n':int(n),'k':int(k),'ci':ci}

for i in range(1,10):
    meta = get_block_meta(i)
    print('Comparison', i, meta)


# %% cell 18
import os, pandas as pd, numpy as np
from math import sqrt
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
nc = pd.read_excel(path, sheet_name='NormCount')
header = nc.iloc[2]


def wilson_ci(k, n, z=1.96):
    if n==0:
        return (0.0,0.0)
    p = k/n
    denom = 1+z**2/n
    center = (p + z**2/(2*n)) / denom
    half = z*sqrt(p*(1-p)/n + z**2/(4*n**2)) / denom
    return center-half, center+half


def get_block_meta(i):
    start = nc.columns.get_loc(f'DESeq, Comparison {i}, exclude outliers')
    cols_idx = list(range(start, start+9))
    h = header.iloc[cols_idx].reset_index(drop=True)
    # map names to absolute column indices
    name_to_idx = {}
    for rel, name in enumerate(h):
        name_to_idx[name] = cols_idx[rel]
    col_lfc = name_to_idx['log2FoldChange']
    col_padj = name_to_idx['padj']
    col_bm = name_to_idx['baseMean']
    lfc = pd.to_numeric(nc.iloc[3:, col_lfc], errors='coerce')
    padj = pd.to_numeric(nc.iloc[3:, col_padj], errors='coerce')
    bm = pd.to_numeric(nc.iloc[3:, col_bm], errors='coerce')
    sig = (padj<0.05) & (lfc.abs()>1) & (bm>=10)
    n = sig.notna().sum()
    k = sig.sum()
    ci = wilson_ci(int(k), int(n))
    return {'n':int(n),'k':int(k),'ci':ci}

for i in range(6,10):
    meta = get_block_meta(i)
    print('Comparison', i, meta)


# %% cell 19
import os, pandas as pd, numpy as np
from math import sqrt
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
nc = pd.read_excel(path, sheet_name='NormCount')
header = nc.iloc[2]

# reuse block meta without baseMean constraint for questions 3-4-5

def get_block(i):
    start = nc.columns.get_loc(f'DESeq, Comparison {i}, exclude outliers')
    cols_idx = list(range(start, start+9))
    h = header.iloc[cols_idx].reset_index(drop=True)
    name_to_idx = {name: cols_idx[rel] for rel, name in enumerate(h)}
    col_lfc = name_to_idx['log2FoldChange']
    col_padj = name_to_idx['padj']
    col_bm = name_to_idx['baseMean']
    df = pd.DataFrame({
        'log2FoldChange': pd.to_numeric(nc.iloc[3:, col_lfc], errors='coerce'),
        'padj': pd.to_numeric(nc.iloc[3:, col_padj], errors='coerce'),
        'baseMean': pd.to_numeric(nc.iloc[3:, col_bm], errors='coerce'),
        'GeneID': nc.iloc[3:,1].values
    })
    return df

res6 = get_block(6)
res7 = get_block(7)
res8 = get_block(8)
res9 = get_block(9)

# significance sets for padj<0.05 & |log2FC|>1
crit = lambda df: df[(df['padj']<0.05) & (df['log2FoldChange'].abs()>1)]

sig6 = set(crit(res6)['GeneID'])
sig7 = set(crit(res7)['GeneID'])
sig8 = set(crit(res8)['GeneID'])
sig9 = set(crit(res9)['GeneID'])
print(len(sig6), len(sig7), len(sig8), len(sig9))

# We need mapping from comparison numbers to contrasts.
# Use description row just above DESeq blocks (row1) and Comparison summary columns.
meta_row = nc.iloc[1]
print(meta_row[ 'Comparison6':'Comparison9'])


# %% cell 20
import os, pandas as pd, numpy as np
from math import sqrt
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
nc = pd.read_excel(path, sheet_name='NormCount')
header = nc.iloc[2]

# look for textual description of comparisons in rows 0 and 1 for columns near DESeq blocks
for i in range(1,10):
    base = f'DESeq, Comparison {i}, exclude outliers'
    idx = nc.columns.get_loc(base)
    print('\nComparison', i, 'block starting at col', idx)
    print('Row0 header:', nc.iloc[0, idx:idx+9].to_list())
    print('Row1 header:', nc.iloc[1, idx:idx+9].to_list())


# %% cell 21
import os, pandas as pd, numpy as np
from math import sqrt
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
nc = pd.read_excel(path, sheet_name='NormCount')
header = nc.iloc[2]

# get DEG summary columns
for comp in range(1,10):
    name = f'Comparison{comp}'
    col = nc[name]
    up = (col=='U').sum()
    down = (col=='D').sum()
    print(name, 'up', up, 'down', down)


# %% cell 22
import os, pandas as pd, numpy as np
from math import sqrt
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
nc = pd.read_excel(path, sheet_name='NormCount')
header = nc.iloc[2]

# determine which Comparison corresponds to Control-only by checking which genes are DE
# and cross-referencing with manuscript? not available, so inspect baseMean distributions

from collections import Counter

def get_block(i):
    start = nc.columns.get_loc(f'DESeq, Comparison {i}, exclude outliers')
    cols_idx = list(range(start, start+9))
    h = header.iloc[cols_idx].reset_index(drop=True)
    name_to_idx = {name: cols_idx[rel] for rel, name in enumerate(h)}
    col_lfc = name_to_idx['log2FoldChange']
    col_padj = name_to_idx['padj']
    col_bm = name_to_idx['baseMean']
    df = pd.DataFrame({
        'log2FoldChange': pd.to_numeric(nc.iloc[3:, col_lfc], errors='coerce'),
        'padj': pd.to_numeric(nc.iloc[3:, col_padj], errors='coerce'),
        'baseMean': pd.to_numeric(nc.iloc[3:, col_bm], errors='coerce'),
        'GeneID': nc.iloc[3:,1].values
    })
    return df

for i in range(1,10):
    df = get_block(i)
    sig = df[(df['padj']<0.05) & (df['log2FoldChange'].abs()>1)]
    print('Comparison', i, 'sig genes', len(sig))

