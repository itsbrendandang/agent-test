
# %% cell 0
import os
import pandas as pd
print(os.environ['DATA_DIR'])
fp = os.path.join(os.environ['DATA_DIR'], '38665421_Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
print(xl.sheet_names)
for s in xl.sheet_names:
    df = xl.parse(s)
    print('Sheet', s, 'shape', df.shape)
    print(df.head())
    print(df.columns)
    break

# %% cell 1
import os, glob, textwrap, sys
print(os.listdir(os.environ['DATA_DIR']))
print(os.environ['DATA_DIR'])
print(glob.glob(os.environ['DATA_DIR']+'/*'))

# %% cell 2
import os, pandas as pd
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
print(fp)
xl = pd.ExcelFile(fp)
print(xl.sheet_names)

# %% cell 3
import os, pandas as pd
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
map_df = xl.parse('Mapping_statistics')
print(map_df.head())
print(map_df.columns)

norm_df = xl.parse('NormCount')
print(norm_df.head())
print(norm_df.columns)
print(norm_df.iloc[:5,:10])

# %% cell 4
import os, pandas as pd
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount')
print(norm_df.iloc[0:10,170:188])

# %% cell 5
import os, pandas as pd
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
map_df = xl.parse('Mapping_statistics')
print(map_df['Response'].unique())
print(map_df['Tissue'].unique())
print(map_df[['Sample ID','Response','Tissue']].head(20))

# %% cell 6
import os, pandas as pd
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount')
print(norm_df.iloc[2, :40])

# %% cell 7
import os, pandas as pd
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount')
# locate header row where first col == 'Index'
header_row = norm_df[norm_df.iloc[:,0]=='Index'].index[0]
print('header_row',header_row)
header = norm_df.iloc[header_row]
print(header[:50])
# build clean df
clean = norm_df.iloc[header_row+1:].copy()
clean.columns = header
print(clean.head())

# %% cell 8
import os, pandas as pd
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount')
header_row = norm_df[norm_df.iloc[:,0]=='Index'].index[0]
header = norm_df.iloc[header_row]
clean = norm_df.iloc[header_row+1:].copy()
clean.columns = header
# get DE columns info row just after header? it's at header_row+? see row header_row+? for 'DESeq, Comparison 9'
print(norm_df.iloc[header_row+0:header_row+5,170:188])

# %% cell 9
import os, pandas as pd
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount')
header_row = norm_df[norm_df.iloc[:,0]=='Index'].index[0]
header = norm_df.iloc[header_row]
clean = norm_df.iloc[header_row+1:].copy()
clean.columns = header
# last columns names
print(clean.columns[-30:])
# preview comparison meta row (row with 'Median','DEG')
meta_row = norm_df.iloc[header_row-1]
print(meta_row[-30:])

# %% cell 10
import os, pandas as pd
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount')
header_row = norm_df[norm_df.iloc[:,0]=='Index'].index[0]
header = norm_df.iloc[header_row]
clean = norm_df.iloc[header_row+1:].copy()
clean.columns = header

# identify baseMean/log2FC/pval columns for each Comparison
cols = list(clean.columns)
for i,c in enumerate(cols):
    if c=='DESeq, Comparison 1, exclude outliers':
        start=i
        break
print('start',start, cols[start:start+20])

# %% cell 11
import os, pandas as pd
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount')
header_row = norm_df[norm_df.iloc[:,0]=='Index'].index[0]
header = norm_df.iloc[header_row]
clean = norm_df.iloc[header_row+1:].copy()
clean.columns = header
cols = list(clean.columns)
for i,c in enumerate(cols):
    if isinstance(c,str) and c.startswith('DESeq, Comparison'):
        print(i,c)

print(len(cols))

# %% cell 12
import os, pandas as pd
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount')
header_row = norm_df[norm_df.iloc[:,0]=='Index'].index[0]
header = norm_df.iloc[header_row]
clean = norm_df.iloc[header_row+1:].copy()
clean.columns = header

# just look at around col 150-180
print(list(enumerate(clean.columns[150:190], start=150)))

# %% cell 13
import os, pandas as pd
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount')
header_row = norm_df[norm_df.iloc[:,0]=='Index'].index[0]
header = norm_df.iloc[header_row]
clean = norm_df.iloc[header_row+1:].copy()
clean.columns = header

# map comparison labels from row1 meta
meta = norm_df.iloc[1]
print(meta[140:190])

# %% cell 14
import os, pandas as pd
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount', nrows=10)
print(norm_df.iloc[1,140:190])

# %% cell 15
import os, pandas as pd
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount', nrows=5)
print(norm_df.columns[130:190])

# %% cell 16
import os, pandas as pd
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount')
header_row = norm_df[norm_df.iloc[:,0]=='Index'].index[0]
header = norm_df.iloc[header_row]
clean = norm_df.iloc[header_row+1:].copy()
clean.columns = header

# get DESeq blocks per comparison using known pattern
blocks = {}
cols = list(clean.columns)
# find all indices where column name == 'baseMean'
base_idx = [i for i,c in enumerate(cols) if c=='baseMean']
print('base_idx', base_idx)
print('total cols', len(cols))

# %% cell 17
import os, pandas as pd
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount', nrows=5)
print(norm_df.columns[90:110])
print(norm_df.iloc[1,90:110])

# %% cell 18
import os, pandas as pd
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount')
header_row = norm_df[norm_df.iloc[:,0]=='Index'].index[0]
header = norm_df.iloc[header_row]
clean = norm_df.iloc[header_row+1:].copy()
clean.columns = header

cols = list(clean.columns)
base_idx = [i for i,c in enumerate(cols) if c=='baseMean']
blocks={}
for ci,bi in enumerate(base_idx, start=1):
    # assume pattern: [baseMean, baseMeanA, baseMeanB, foldChange, log2FoldChange, pval, padj] starting at bi
    blocks[ci] = list(range(bi-2, bi+7))
print(blocks)
for k,idxs in blocks.items():
    print('Comp',k,'cols', [cols[i] for i in idxs])

# %% cell 19
import os, pandas as pd
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount')
header_row = norm_df[norm_df.iloc[:,0]=='Index'].index[0]
header = norm_df.iloc[header_row]
clean = norm_df.iloc[header_row+1:].copy()
clean.columns = header

meta = norm_df.iloc[1]
# find which Comparison label corresponds to dentate vs control good/bad
print(meta[90:140])

# %% cell 20
import os, pandas as pd
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount')
header_row = norm_df[norm_df.iloc[:,0]=='Index'].index[0]
header = norm_df.iloc[header_row]
clean = norm_df.iloc[header_row+1:].copy()
clean.columns = header

# use Comparison9 DE block indices 168-176
base = clean.iloc[:,170]
lfc = clean.iloc[:,173]
pval = clean.iloc[:,175]
# basemean>10, p<0.05, |lfc|>0.5
sel = (base.astype(float)>10) & (pval.astype(float)<0.05) & (lfc.astype(float).abs()>0.5)
print(sel.sum())

# %% cell 21
import os, pandas as pd
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount')
header_row = norm_df[norm_df.iloc[:,0]=='Index'].index[0]
header = norm_df.iloc[header_row]
clean = norm_df.iloc[header_row+1:].copy()
clean.columns = header

# genes
genes = clean['GeneID']

# for each comparison, get significant genes
base_cols = [98,107,116,125,134,143,152,161,170]
lfc_cols = [103,112,121,130,139,148,157,166,173]
p_cols   = [105,114,123,132,141,150,159,168,175]
# but indices shifted? we built earlier blocks mapping
base_cols = [clean.columns[i] for i in [98,107,116,125,134,143,152,161,170]]
lfc_cols  = [clean.columns[i] for i in [102,111,120,129,138,147,156,165,174]]
p_cols    = [clean.columns[i] for i in [104,113,122,131,140,149,158,167,176]]
print(base_cols)
print(lfc_cols)
print(p_cols)

# %% cell 22
import os, pandas as pd
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount')
header_row = norm_df[norm_df.iloc[:,0]=='Index'].index[0]
header = norm_df.iloc[header_row]
clean = norm_df.iloc[header_row+1:].copy()
clean.columns = header

cols = list(clean.columns)
for i in range(95,120):
  print(i, cols[i])

# %% cell 23
import os, pandas as pd
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount')
header_row = norm_df[norm_df.iloc[:,0]=='Index'].index[0]
header = norm_df.iloc[header_row]
clean = norm_df.iloc[header_row+1:].copy()
clean.columns = header

cols = list(clean.columns)
for i in range(116,145):
  print(i, cols[i])

# %% cell 24
import os, pandas as pd
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount')
header_row = norm_df[norm_df.iloc[:,0]=='Index'].index[0]
header = norm_df.iloc[header_row]
clean = norm_df.iloc[header_row+1:].copy()
clean.columns = header

cols = list(clean.columns)
for i in range(143,177):
  print(i, cols[i])

# %% cell 25
import os, pandas as pd
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount')
header_row = norm_df[norm_df.iloc[:,0]=='Index'].index[0]
header = norm_df.iloc[header_row]
clean = norm_df.iloc[header_row+1:].copy()
clean.columns = header

cols = list(clean.columns)

# build blocks programmatically: baseMean indices
base_idx = [i for i,c in enumerate(cols) if c=='baseMean']
blocks=[]
for bi in base_idx:
    # search backwards to previous non DESeq numeric col? but easier: padj at bi+6
    blocks.append({'base':bi, 'lfc':bi+4, 'pval':bi+5, 'padj':bi+6})
print(blocks)

# get dentate expression indices: columns with 'dentate_gyrus' in name
expr_cols = [c for c in cols if isinstance(c,str) and 'dentate_gyrus' in c]
print(len(expr_cols), expr_cols[:10])

# %% cell 26
import os, pandas as pd
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount')
header_row = norm_df[norm_df.iloc[:,0]=='Index'].index[0]
header = norm_df.iloc[header_row]
clean = norm_df.iloc[header_row+1:].copy()
clean.columns = header

meta = norm_df.iloc[0]
print(meta[90:140])

# %% cell 27
import os, pandas as pd
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount')
header_row = norm_df[norm_df.iloc[:,0]=='Index'].index[0]
header = norm_df.iloc[header_row]
clean = norm_df.iloc[header_row+1:].copy()
clean.columns = header

# ANOVA p-value likely in a summary row near bottom; scan for 'Category'
mask = norm_df.apply(lambda row: row.astype(str).str.contains('Category').any(), axis=1)
print(mask[mask].index)
rows = norm_df[mask]
print(rows.head())

# %% cell 28
import os, pandas as pd, numpy as np
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount')
header_row = norm_df[norm_df.iloc[:,0]=='Index'].index[0]
header = norm_df.iloc[header_row]
clean = norm_df.iloc[header_row+1:].copy()
clean.columns = header

# build long expression table
expr_cols = [c for c in clean.columns if isinstance(c,str) and ('_baseline_blood' in c or '_dentate_gyrus' in c or '_final_blood' in c)]
print(len(expr_cols))
# parse sample annotations
rows = []
for col in expr_cols:
    parts = col.split('_')
    resp = parts[0]
    tissue = '_'.join(parts[1:-1])
    sid = parts[-1]
    rows.append({'col':col,'Response':resp,'Tissue':tissue})
ann = pd.DataFrame(rows)
print(ann['Tissue'].value_counts())

# construct long format for ANOVA
import statsmodels.api as sm
from statsmodels.formula.api import ols

# use single gene (e.g., first gene) and run one-way ANOVA with factor Category
ge = clean.iloc[0]
vals = []
for col in expr_cols:
    vals.append({'expr': float(ge[col]),
                 'Response': ann.loc[ann['col']==col,'Response'].values[0],
                 'Tissue': ann.loc[ann['col']==col,'Tissue'].values[0]})
long = pd.DataFrame(vals)
long['Category'] = long['Tissue'] + '_' + long['Response']
model = ols('expr ~ C(Category)', data=long).fit()
from statsmodels.stats.anova import anova_lm
anova_table = anova_lm(model, typ=2)
print(anova_table)
print('p=', anova_table.loc['C(Category)','PR(>F)'])

# %% cell 29
import os, pandas as pd, numpy as np
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount')
header_row = norm_df[norm_df.iloc[:,0]=='Index'].index[0]
header = norm_df.iloc[header_row]
clean = norm_df.iloc[header_row+1:].copy()
clean.columns = header

# identify comparison numbers for dentate vs control good/bad using comments? We will examine description in some cell near top
print(norm_df.iloc[:15,90:120])

# %% cell 30
import os, pandas as pd, numpy as np
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount')
header_row = norm_df[norm_df.iloc[:,0]=='Index'].index[0]
header = norm_df.iloc[header_row]
clean = norm_df.iloc[header_row+1:].copy()
clean.columns = header

# use comparison blocks identified earlier: 9 total
cols = list(clean.columns)
base_idx = [i for i,c in enumerate(cols) if c=='baseMean']
blocks=[]
for bi in base_idx:
    blocks.append({'base':bi, 'lfc':bi+4, 'pval':bi+5, 'padj':bi+6})
print('blocks',blocks)

# we need which comparison is dentate good vs control, etc. inspect annotations stored in rows 2 for baseMeanA/B around first block
print(norm_df.iloc[2,90:120])

# %% cell 31
import os, pandas as pd, numpy as np
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount')
header_row = norm_df[norm_df.iloc[:,0]=='Index'].index[0]
header = norm_df.iloc[header_row]
clean = norm_df.iloc[header_row+1:].copy()
clean.columns = header

# For dentate gyrus comparisons: check meta row giving group A/B for each comparison
meta2 = norm_df.iloc[2]
print(meta2[176:190])

# %% cell 32
import os, pandas as pd, numpy as np
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount')
header_row = norm_df[norm_df.iloc[:,0]=='Index'].index[0]
header = norm_df.iloc[header_row]
clean = norm_df.iloc[header_row+1:].copy()
clean.columns = header

# Identify groups A and B for each comparison from row 0?1? check around baseMeanA/B headers
for comp in range(1,10):
    # baseMeanA label is in row2 at col where row1 has 'DESeq, Comparison X, exclude outliers' +1
    row2 = norm_df.iloc[2]
    row1 = norm_df.iloc[1]
    idx = [i for i,c in enumerate(row1) if isinstance(c,str) and c.startswith(f'DESeq, Comparison {comp}')][0]
    groupA = row2.iloc[idx+1]
    groupB = row2.iloc[idx+2]
    print(comp, 'A=',groupA,'B=',groupB)

# %% cell 33
import os, pandas as pd, numpy as np
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount', nrows=5)
row1 = norm_df.iloc[1]
for i,v in enumerate(row1):
    if isinstance(v,str) and v.startswith('DESeq, Comparison'):
        print(i,v)

# %% cell 34
import os, pandas as pd, numpy as np
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount', header=None)
for r in range(0,4):
  row = norm_df.iloc[r]
  for i,v in enumerate(row):
    if isinstance(v,str) and v.startswith('DESeq, Comparison'):
        print('row',r,'col',i,':',v)

# %% cell 35
import os, pandas as pd, numpy as np
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount', header=None)
row2 = norm_df.iloc[2]
# for comp1
for comp in range(1,10):
  idx = [i for i,v in enumerate(norm_df.iloc[0]) if isinstance(v,str) and v.startswith(f'DESeq, Comparison {comp}')][0]
  groupA = row2.iloc[idx+1]
  groupB = row2.iloc[idx+2]
  print(comp, idx, groupA, groupB)

# %% cell 36
import os, pandas as pd, numpy as np
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount', header=None)
for r in range(0,6):
  print('row',r)
  print(norm_df.iloc[r,95:110])

# %% cell 37
import os, pandas as pd, numpy as np
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount', header=None)
# row3 has baseMean row label mapping for Comparison1 etc
print(norm_df.iloc[3,95:140])

# %% cell 38
import os, pandas as pd, numpy as np
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount', header=None)
# inspect around row2, cols 60-100 to see group labels earlier
print(norm_df.iloc[2,60:100])

# %% cell 39
import os, pandas as pd, numpy as np
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount', header=None)
# inspect textual annotation rows beyond header; search for 'Comparison 1:' text etc
for r in range(0,60):
  row = norm_df.iloc[r]
  text = ' '.join([str(v) for v in row if isinstance(v,str)])
  if 'Comparison' in text and ':' in text:
    print('row',r,text)

# %% cell 40
import os, pandas as pd, numpy as np
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
map_df = xl.parse('Mapping_statistics')
print(map_df[['Sample ID','Response','Tissue']].tail(15))

# %% cell 41
import os, pandas as pd, numpy as np
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount', header=None)
# examine some later rows to see any description of comparisons
for r in range(10,40):
  txt = ' '.join([str(v) for v in norm_df.iloc[r] if isinstance(v,str)])
  if 'Comparison' in txt:
    print('row',r, txt[:200])

# %% cell 42
import os, pandas as pd, numpy as np
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount', header=None)
print(norm_df.shape)
# check very bottom 10 rows for text
for r in range(norm_df.shape[0]-10, norm_df.shape[0]):
  txt = ' '.join([str(v) for v in norm_df.iloc[r] if isinstance(v,str)])
  if txt.strip():
    print('row',r, txt[:200])

# %% cell 43
import os, pandas as pd
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount', header=None)
# construct clean with header row 2
header_row = 2
header = norm_df.iloc[header_row]
clean = norm_df.iloc[header_row+1:].copy()
clean.columns = header

cols = list(clean.columns)
# group info for each comparison from row3 where A/B labels present
row3 = norm_df.iloc[3]
for comp, bi in enumerate([98,107,116,125,134,143,152,161,170], start=1):
    A = row3.iloc[bi-2]  # baseline_blood or dentate_gyrus or final_blood
    print('comp',comp,'A tissue',A)

# for dentate gyrus specifically, comparisons where A tissue == 'dentate_gyrus'


# %% cell 44
import os, pandas as pd
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount', header=None)
# use header row2 as before
header_row = 2
header = norm_df.iloc[header_row]
clean = norm_df.iloc[header_row+1:].copy()
clean.columns = header

# Comparison1 is cross-tissue; for dentate gyrus pairwise vs control for each responder group likely other comparisons by design
# Given ambiguity, use logic: comparisons where baseMeanA uses 'Control_dentate_gyrus' and baseMeanB 'good_responder_dentate_gyrus' etc computed from sample means externally.

# build expression means
expr_cols = [c for c in clean.columns if isinstance(c,str) and '_dentate_gyrus' in c]
import numpy as np
# assign group
genes = clean['GeneID']
mat = clean[expr_cols].astype(float)
# map columns to response
groups = {}
for c in expr_cols:
    resp = c.split('_')[0]
    groups.setdefault(resp,[]).append(c)
print(groups.keys())

means = {resp: mat[cols].mean(axis=1) for resp,cols in groups.items()}
# compute log2 foldchange responder vs control
from math import log2
lfc_good = np.log2((means['good_responder']+1e-6)/(means['Control']+1e-6))
lfc_bad  = np.log2((means['bad_responder']+1e-6)/(means['Control']+1e-6))
# approximate p-values via t-test
top=mat[groups['good_responder']].values
ctrl=mat[groups['Control']].values
bad =mat[groups['bad_responder']].values
from scipy import stats
p_good = stats.ttest_ind(top, ctrl, axis=1, equal_var=False).pvalue
p_bad  = stats.ttest_ind(bad, ctrl, axis=1, equal_var=False).pvalue
base = mat.mean(axis=1)
# filters
sig_good = (p_good<0.05) & (np.abs(lfc_good)>0.5) & (base>10)
sig_bad  = (p_bad<0.05) & (np.abs(lfc_bad)>0.5) & (base>10)
print('n good',sig_good.sum(),'n bad',sig_bad.sum())

G = set(genes[sig_good])
B = set(genes[sig_bad])
print('overlap size', len(G&B))

# %% cell 45
import os, pandas as pd, numpy as np
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount')
header_row = norm_df[norm_df.iloc[:,1]=='GeneID'].index[0]
header = norm_df.iloc[header_row]
clean = norm_df.iloc[header_row+1:].copy()
clean.columns = header

expr_cols = [c for c in clean.columns if isinstance(c,str) and '_dentate_gyrus' in c]
print(len(expr_cols))

# compute DE good vs control, bad vs control as above
mat = clean[expr_cols].astype(float)
# map columns to response
groups={}
for c in expr_cols:
    resp = c.split('_')[0]
    groups.setdefault(resp,[]).append(c)
print(groups.keys())

genes = clean['GeneID']

from scipy import stats
means = {resp: mat[cols].mean(axis=1) for resp,cols in groups.items()}
lfc_good = np.log2((means['good_responder']+1e-6)/(means['Control']+1e-6))
lfc_bad  = np.log2((means['bad_responder']+1e-6)/(means['Control']+1e-6))
ctrl=mat[groups['Control']].values
gtop=mat[groups['good_responder']].values
btop=mat[groups['bad_responder']].values
p_good = stats.ttest_ind(gtop, ctrl, axis=1, equal_var=False).pvalue
p_bad  = stats.ttest_ind(btop, ctrl, axis=1, equal_var=False).pvalue
base = mat.mean(axis=1)

sig_good = (p_good<0.05) & (np.abs(lfc_good)>0.5) & (base>10)
sig_bad  = (p_bad<0.05) & (np.abs(lfc_bad)>0.5) & (base>10)
print('n good',sig_good.sum(),'n bad',sig_bad.sum())

G = set(genes[sig_good])
B = set(genes[sig_bad])
print('overlap',len(G&B))

# %% cell 46
import os, pandas as pd, numpy as np
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
norm_df = xl.parse('NormCount')
header_row = norm_df[norm_df.iloc[:,1]=='GeneID'].index[0]
header = norm_df.iloc[header_row]
clean = norm_df.iloc[header_row+1:].copy()
clean.columns = header

expr_cols = [c for c in clean.columns if isinstance(c,str) and '_dentate_gyrus' in c]
mat = clean[expr_cols].astype(float)
groups={}
for c in expr_cols:
    resp = c.split('_')[0]
    groups.setdefault(resp,[]).append(c)
print(groups)


# %% cell 47
import os, pandas as pd, numpy as np
from scipy import stats
fp = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(fp)
nd = xl.parse('NormCount')
header_row = nd[nd.iloc[:,1]=='GeneID'].index[0]
header = nd.iloc[header_row]
clean = nd.iloc[header_row+1:].copy()
clean.columns = header

# build expression matrices per tissue/response
expr_cols = [c for c in clean.columns if isinstance(c,str) and ('_baseline_blood' in c or '_dentate_gyrus' in c or '_final_blood' in c)]

# helper to compute DE vs control within tissue
from collections import defaultdict

def de_for_tissue(tissue):
    cols_t = [c for c in expr_cols if f'_{tissue}' in c]
    mat = clean[cols_t].astype(float)
    groups = defaultdict(list)
    for c in cols_t:
        resp = c.split('_')[0]
        groups[resp].append(c)
    ctrl = mat[groups['Control']].values
    base = mat.mean(axis=1)
    res={}
    for label in ['good','bad']:
        top = mat[groups[label]].values
        lfc = np.log2((top.mean(axis=1)+1e-6)/(ctrl.mean(axis=1)+1e-6))
        p = stats.ttest_ind(top, ctrl, axis=1, equal_var=False).pvalue
        sig = (p<0.05) & (np.abs(lfc)>0.5) & (base>10)
        res[label]=sig
    return res

# q3 dentate overlap
res_dg = de_for_tissue('dentate_gyrus')
print('n good',res_dg['good'].sum(),'n bad',res_dg['bad'].sum())
G = set(clean.loc[res_dg['good'],'GeneID'])
B = set(clean.loc[res_dg['bad'],'GeneID'])
print('overlap',len(G & B))

# q5 counts per tissue for bad responders
bad_counts={}
for tissue in ['baseline_blood','dentate_gyrus','final_blood']:
    res = de_for_tissue(tissue)
    bad_counts[tissue]=int(res['bad'].sum())
print(bad_counts)
