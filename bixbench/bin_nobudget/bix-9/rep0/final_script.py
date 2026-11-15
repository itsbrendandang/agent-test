
# %% cell 0
import os
import pandas as pd

print(os.environ['DATA_DIR'])
path = os.path.join(os.environ['DATA_DIR'], '38665421_Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(path)
print(xl.sheet_names)

# %% cell 1
import os, glob, textwrap
print(os.listdir(os.environ['DATA_DIR']))
print(os.environ['DATA_DIR'])


# %% cell 2
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
print(path)
xl = pd.ExcelFile(path)
print(xl.sheet_names)

# %% cell 3
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
counts = pd.read_excel(path, sheet_name='NormCount')
print(counts.head())
print(counts.columns[:20])

# %% cell 4
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
counts = pd.read_excel(path, sheet_name='NormCount', header=None)
print(counts.iloc[:10, :15])

# %% cell 5
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
counts = pd.read_excel(path, sheet_name='NormCount', header=None)
# find header row containing 'GeneID'
header_row = counts[counts.eq('GeneID').any(1)].index[0]
print('header_row', header_row)
header = counts.iloc[header_row]
print(header[:20])

# genes start next row
print(counts.iloc[header_row+1:header_row+6, :10])

# %% cell 6
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
counts = pd.read_excel(path, sheet_name='NormCount', header=None)
mask = counts.eq('GeneID').any(axis=1)
print(mask.nonzero()[0][:5])
header_row = mask[mask].index[0]
print('header_row', header_row)
print(counts.iloc[header_row, :20])
print(counts.iloc[header_row+1:header_row+6, :10])

# %% cell 7
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
counts = pd.read_excel(path, sheet_name='NormCount', header=None)
mask = counts.eq('GeneID').any(axis=1)
print([i for i,v in enumerate(mask) if v])
header_row = [i for i,v in enumerate(mask) if v][0]
print('header_row', header_row)
print(counts.iloc[header_row, :25])
print(counts.iloc[header_row+1:header_row+6, :10])

# %% cell 8
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
counts = pd.read_excel(path, sheet_name='NormCount', header=None)
header_row = 3
header = counts.iloc[header_row]
expr = counts.iloc[header_row+1:]
expr.columns = header
expr = expr.rename(columns={header[0]:'Index', header[1]:'GeneID'})
print(expr[['Index','GeneID']].head())
# identify columns for dentate gyrus comparisons and DEG flags
print([c for c in expr.columns if isinstance(c,str) and 'dentate_gyrus' in c][:40])
print([c for c in expr.columns if isinstance(c,str) and 'Comparison' in c][-15:])
print(expr.iloc[:5,-10:])

# %% cell 9
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
mapstats = pd.read_excel(path, sheet_name='Mapping_statistics')
print(mapstats.head())
print(mapstats.columns)

# %% cell 10
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
counts = pd.read_excel(path, sheet_name='NormCount', header=None)
header_row = 3
header = counts.iloc[header_row]
expr = counts.iloc[header_row+1:]
expr.columns = header
expr = expr.rename(columns={header[0]:'Index', header[1]:'GeneID'})

# locate DEG blocks and associated stats
deg_cols = [c for c in expr.columns if isinstance(c,str) and c.startswith('Comparison')]
print(len(deg_cols), deg_cols[:12])
print(expr[deg_cols].iloc[:5,:6])

# find where p-values and lfc are stored by scanning for 'p' and 'lfc'
print([c for c in expr.columns if isinstance(c,str) and 'pvalue' in str(c).lower()][:20])
print([c for c in expr.columns if isinstance(c,str) and ('lfc' in str(c).lower() or 'log2' in str(c).lower())][:20])

# %% cell 11
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
counts = pd.read_excel(path, sheet_name='NormCount', header=None)
header_row = 3
header = counts.iloc[header_row]
expr = counts.iloc[header_row+1:]
expr.columns = header
expr = expr.rename(columns={header[0]:'Index', header[1]:'GeneID'})
print(expr.columns[-40:])
print(expr.iloc[2, -40:])

# %% cell 12
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
counts = pd.read_excel(path, sheet_name='NormCount', header=None)
# show row2 which might label comparisons
print(counts.iloc[2, -40:])

# %% cell 13
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
# read only tail columns to speed up
counts = pd.read_excel(path, sheet_name='NormCount', header=None, usecols=range(150,188))
print(counts.iloc[2])

# %% cell 14
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
counts = pd.read_excel(path, sheet_name='NormCount', header=None)
# display last 60 columns rows 0-6
print(counts.iloc[:7, -60:])

# %% cell 15
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
counts = pd.read_excel(path, sheet_name='NormCount', header=None)
# show mapping of comparison to tissues using some earlier columns where labels may exist
print(counts.iloc[0,128:160])
print(counts.iloc[1,128:160])
print(counts.iloc[2,128:160])

# %% cell 16
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
counts = pd.read_excel(path, sheet_name='NormCount', header=None)
# show row0-3 around column 160-188 where comparison labels are
print(counts.iloc[0:4,160:188])

# %% cell 17
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
counts = pd.read_excel(path, sheet_name='NormCount', header=None)

# columns 160-187 meta rows to see mapping
for r in range(0,7):
    print('row', r)
    print(counts.iloc[r,160:188])

# %% cell 18
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
counts = pd.read_excel(path, sheet_name='NormCount', header=None)

# comparison names at row0 last 9
comp_names = counts.iloc[0,179:188].tolist()
print(comp_names)

# construct MultiIndex-like mapping for rows 3 (stat labels)
stat_labels = counts.iloc[3,160:188].tolist()
print(stat_labels)

# get numeric data rows for these columns
expr_block = counts.iloc[4:,160:188]
expr_block.columns = pd.MultiIndex.from_arrays([
    ['Comp8']*8 + ['Comp9']*8 + comp_names,
    stat_labels
])
print(expr_block.head())

# %% cell 19
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
counts = pd.read_excel(path, sheet_name='NormCount', header=None)

# show DESeq comparison definitions likely in earlier columns
for r in range(0,10):
  print('row', r)
  print(counts.iloc[r,120:150])

# %% cell 20
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
counts = pd.read_excel(path, sheet_name='NormCount', header=None)

# read full to align comparisons carefully is heavy but ok

# Identify for each comparison which block columns used. From row3 patterns
row3 = counts.iloc[3]

blocks = []
start = None
current = None
for j,val in enumerate(row3):
    if val=='log2FoldChange':
        current = {'lfc':j}
    if val=='pval' and current is not None and 'pval' not in current:
        current['pval']=j
    if val=='baseMean' and current is not None and 'baseMean' not in current:
        current['baseMean']=j
    if val=='DEG' and current is not None and 'end' not in current:
        # heuristic: DEGs columns follow stats; ignore for now
        pass
# not great; instead, manually from inspected ranges:

# We'll assume comparison1-3 stats are in cols 120-139 sets: [120-122] log2FC,p,padj? but order known from row3
print(counts.iloc[3,120:140])

# %% cell 21
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
counts = pd.read_excel(path, sheet_name='NormCount', header=None)

# figure mapping comparisons to tissues from textual description probably earlier in sheet
for r in range(0,20):
    print('row', r)
    print(counts.iloc[r,100:130])

# %% cell 22
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
counts = pd.read_excel(path, sheet_name='NormCount', header=None)

# Determine annotation for comparisons from some text probably in rows below
for r in range(20,80):
    if counts.iloc[r,0:50].notna().any():
        print('row', r)
        print(counts.iloc[r,0:50])

# %% cell 23
import os, pandas as pd, numpy as np
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
counts = pd.read_excel(path, sheet_name='NormCount', header=None)
header_row = 3
header = counts.iloc[header_row]
expr = counts.iloc[header_row+1:]
expr.columns = header
expr = expr.rename(columns={header[0]:'Index', header[1]:'GeneID'})

# build MultiIndex for comparison 7,8,9 using our knowledge of row3 160-187
row3 = counts.iloc[3,160:188].tolist()
cols = list(range(160,188))

# comp8 stats at 161-167, comp9 at 170-176
comp8_map = {'baseMean':161,'baseMeanA':162,'baseMeanB':163,'foldChange':164,'log2FoldChange':165,'pval':166,'padj':167}
comp9_map = {'baseMean':170,'baseMeanA':171,'baseMeanB':172,'foldChange':173,'log2FoldChange':174,'pval':175,'padj':176}

# extract gene IDs aligned with these stats
genes = counts.iloc[4:,1]

comp8 = pd.DataFrame({'GeneID':genes})
for k,c in comp8_map.items():
    comp8[k] = counts.iloc[4:,c].values
comp9 = pd.DataFrame({'GeneID':genes})
for k,c in comp9_map.items():
    comp9[k] = counts.iloc[4:,c].values

# Infer which comparisons correspond to which group vs control:
print(comp8[['baseMean','log2FoldChange','pval']].head())
print(comp9[['baseMean','log2FoldChange','pval']].head())

# %% cell 24
import os, pandas as pd, numpy as np
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
counts = pd.read_excel(path, sheet_name='NormCount', header=None)

# Create per gene mapping for comparisons1-9 using manual column indices determined by patterns
# based on inspection: comp1 stats: baseMean at col125, log2FC120, pval121
# comp2: baseMean at col134, log2FC129, pval130
# comp3: baseMean at col143, log2FC138, pval139
# comp4: baseMean at col152, log2FC? need from 150-159
print(counts.iloc[3,120:160])

# %% cell 25
import os, pandas as pd, numpy as np
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
counts = pd.read_excel(path, sheet_name='NormCount', header=None)

# Build comp1-7 stat tables
rows = range(4, counts.shape[0])
genes = counts.iloc[4:,1].reset_index(drop=True)

maps = {
 'Comparison1': {'log2FoldChange':120,'pval':121,'baseMean':125},
 'Comparison2': {'log2FoldChange':129,'pval':130,'baseMean':134},
 'Comparison3': {'log2FoldChange':138,'pval':139,'baseMean':143},
 'Comparison4': {'log2FoldChange':147,'pval':148,'baseMean':152},
}

# comp5-7 from row3 128-159 later blocks
# comp5: log2FC102, pval103, baseMean107? check row3 100-119
print('row3 100-119:', counts.iloc[3,100:120].tolist())

# %% cell 26
import os, pandas as pd, numpy as np
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
counts = pd.read_excel(path, sheet_name='NormCount', header=None)

row3 = counts.iloc[3]
for label in ['Comparison1','Comparison2','Comparison3','Comparison4','Comparison5','Comparison6','Comparison7']:
    pass

# Instead, directly check documentation? maybe comparison1-3 blood, 4-6 dentate, 7-9 anterior cingulate? We'll inspect log2FC distributions by tissue means

# build expression matrix with proper headers
h = counts.iloc[3]
mat = counts.iloc[4:].copy()
mat.columns = h
mat = mat.rename(columns={h[0]:'Index', h[1]:'GeneID'})

# sample columns for tissues
blood_cols = [c for c in mat.columns if isinstance(c,str) and 'blood' in c and any(x in c for x in ['Control','good_responder','bad_responder'])]
dg_cols = [c for c in mat.columns if isinstance(c,str) and 'dentate_gyrus' in c]
ac_cols = [c for c in mat.columns if isinstance(c,str) and 'ant_cingulate_cortex' in c]
print(len(blood_cols), len(dg_cols), len(ac_cols))
print(blood_cols[:3], dg_cols[:3], ac_cols[:3])

# %% cell 27
import os, pandas as pd, numpy as np
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
counts = pd.read_excel(path, sheet_name='NormCount', header=None)

# We'll assume based on typical layout: Comparison7: dentate_gyrus good vs control, 8: dentate bad vs control, 9: blood bad vs good etc. We need bad vs control in each tissue; but which comps involve bad responders?

# Examine contrasts by checking a gene uniquely high in bad dentate samples
h = counts.iloc[3]
mat = counts.iloc[4:].copy()
mat.columns = h
mat = mat.rename(columns={h[0]:'Index', h[1]:'GeneID'})

# compute mean per group,tissue
samples = [c for c in mat.columns if isinstance(c,str) and ('Control_' in c or 'good_responder_' in c or 'bad_responder_' in c)]
import re
info = []
for c in samples:
    m = re.match(r'(Control|good_responder|bad_responder)_(.+\d+)', c)
    if not m: continue
    resp = m.group(1)
    tissue = m.group(2)[:-1] if m.group(2).endswith(tuple('0123456789')) else m.group(2)
    info.append((c, resp, tissue))

print(info[:20])

# %% cell 28
import os, pandas as pd, numpy as np
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
counts = pd.read_excel(path, sheet_name='NormCount', header=None)

h = counts.iloc[3]
mat = counts.iloc[4:].copy()
mat.columns = h
mat = mat.rename(columns={h[0]:'Index', h[1]:'GeneID'})

# Extract ANOVA p-value for Category effect from Mapping_statistics or elsewhere
mapstats = pd.read_excel(path, sheet_name='Mapping_statistics')
print(mapstats.columns)
print(mapstats.head())

# %% cell 29
# scan NormCount for ANOVA results text
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
sh = pd.read_excel(path, sheet_name='NormCount', header=None, nrows=200)
for r in range(0,50):
    row = sh.iloc[r,0:30]
    if row.astype(str).str.contains('ANOVA', case=False).any() or row.astype(str).str.contains('Category', case=False).any():
        print('row', r)
        print(row)

# %% cell 30
# sample some later region for ANOVA text
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
sh = pd.read_excel(path, sheet_name='NormCount', header=None, skiprows=200, nrows=200)
for r in range(0,200):
    row = sh.iloc[r,0:40]
    if row.astype(str).str.contains('ANOVA', case=False).any() or row.astype(str).str.contains('Category', case=False).any():
        print('found', r)
        print(row)
        break
