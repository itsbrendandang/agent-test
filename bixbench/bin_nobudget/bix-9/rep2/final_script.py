
# %% cell 0
import os
import pandas as pd
print(os.environ['DATA_DIR'])
path = os.path.join(os.environ['DATA_DIR'], '38665421_Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(path)
print(xl.sheet_names)
for s in xl.sheet_names:
    print('---', s, '---')
    df = xl.parse(s)
    print(df.head())
    print(df.columns)
    print(df.shape)


# %% cell 1
import os, glob
print(os.environ['DATA_DIR'])
print(glob.glob(os.environ['DATA_DIR']+'/*'))

# %% cell 2
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
print(path)
xl = pd.ExcelFile(path)
print(xl.sheet_names)

# %% cell 3
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(path)
map_df = xl.parse('Mapping_statistics')
print(map_df.head())
print(map_df.columns)
print(map_df.shape)
norm_df = xl.parse('NormCount')
print(norm_df.head())
print(norm_df.columns)
print(norm_df.shape)


# %% cell 4
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(path)
norm_df = xl.parse('NormCount')
print(norm_df.iloc[0:10,0:20])


# %% cell 5
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(path)
norm_df = xl.parse('NormCount')
# header row index 2
cols = norm_df.iloc[2]
data = norm_df.iloc[3:].copy()
data.columns = cols
print(data.head())
print(data.columns[:40])


# %% cell 6
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(path)
norm_df = xl.parse('NormCount')
cols = norm_df.iloc[2]
data = norm_df.iloc[3:].copy()
data.columns = cols
# identify DEG columns and comparisons
print([c for c in data.columns if 'Comparison' in str(c)])
print(data.columns[-20:])


# %% cell 7
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(path)
norm_df = xl.parse('NormCount')
# look around where Comparison1 column was originally index-wise
print(norm_df.iloc[0:6,170:188])

# %% cell 8
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(path)
norm_df = xl.parse('NormCount')
# build multiindex header from rows 1 and 2
h1 = norm_df.iloc[1]
h2 = norm_df.iloc[2]
cols = []
for a,b in zip(h1,h2):
    if isinstance(a,float) and pd.isna(a):
        cols.append(str(b))
    elif isinstance(b,float) and pd.isna(b):
        cols.append(str(a))
    else:
        cols.append(f"{a}|{b}")


data = norm_df.iloc[3:].copy()
data.columns = cols
print(data.columns[160:190])
print(data.iloc[0,160:190])


# %% cell 9
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(path)
norm_df = xl.parse('NormCount')
# inspect header rows full around comparisons
for r in [0,1,2]:
    print('row',r)
    print(norm_df.iloc[r,160:188])


# %% cell 10
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(path)
norm_df = xl.parse('NormCount')
h0, h1, h2 = norm_df.iloc[0], norm_df.iloc[1], norm_df.iloc[2]
cols = []
for a,b,c in zip(h0,h1,h2):
    if isinstance(a,float) and pd.isna(a):
        top = ''
    else:
        top = str(a)
    mid = '' if (isinstance(b,float) and pd.isna(b)) else str(b)
    bot = '' if (isinstance(c,float) and pd.isna(c)) else str(c)
    cols.append('|'.join([x for x in [top,mid,bot] if x]))


data = norm_df.iloc[3:].copy()
data.columns = cols
print(data.columns[:40])
print(data.columns[150:190])


# %% cell 11
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(path)
norm_df = xl.parse('NormCount')
h0,h1,h2 = norm_df.iloc[0], norm_df.iloc[1], norm_df.iloc[2]
for i,(a,b,c) in enumerate(zip(h0,h1,h2)):
    if 'Comparison1' in str(a) or 'Comparison1' in str(b):
        print('idx',i,a,b,c)


# %% cell 12
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(path)
norm_df = xl.parse('NormCount')
# just print last few header entries with indices
for i in range(160,188):
    print(i, norm_df.columns[i], norm_df.iloc[0,i], norm_df.iloc[1,i], norm_df.iloc[2,i])


# %% cell 13
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(path)
norm_df = xl.parse('NormCount')
# gene-level + comparison columns
header = norm_df.iloc[2]
data = norm_df.iloc[3:].copy()
data.columns = header
comp_cols = [c for c in data.columns if isinstance(c,str) and c.startswith('Comparison')]
print(comp_cols)
print(data[comp_cols].head())


# %% cell 14
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(path)
norm_df = xl.parse('NormCount')
# manually set final columns names
data = norm_df.iloc[3:].copy()
cols = list(data.columns[:179]) + ['Comp1_DEG','Comp2_DEG','Comp3_DEG','Comp4_DEG','Comp5_DEG','Comp6_DEG','Comp7_DEG','Comp8_DEG','Comp9_DEG']
data.columns = cols
print(cols[150:190])
print(data[['Comp1_DEG','Comp2_DEG']].head())


# %% cell 15
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(path)
norm_df = xl.parse('NormCount')
# build full data with sample columns and comp stats
cols0 = norm_df.iloc[0]
cols1 = norm_df.iloc[1]
cols2 = norm_df.iloc[2]
newcols=[]
for c0,c1,c2 in zip(cols0,cols1,cols2):
    label = str(c2)
    if 'DESeq, Comparison 7' in str(c0): label = 'Comp7_'+str(c2)
    if 'DESeq, Comparison 8' in str(c0): label = 'Comp8_'+str(c2)
    if 'DESeq, Comparison 9' in str(c0): label = 'Comp9_'+str(c2)
    if str(c0).startswith('Comparison') and c2=='DEG': label = str(c0)+'_DEG'
    newcols.append(label)

data = norm_df.iloc[3:].copy()
data.columns = newcols
print(data.columns[140:190])
print(data[['Comparison1_DEG','Comparison2_DEG','Comparison3_DEG']].head())


# %% cell 16
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(path)
norm_df = xl.parse('NormCount')
cols0,cols1,cols2 = norm_df.iloc[0],norm_df.iloc[1],norm_df.iloc[2]
for i in range(179,188):
  print(i, cols0[i], cols1[i], cols2[i])


# %% cell 17
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(path)
map_df = xl.parse('Mapping_statistics')
print(map_df['Code'].unique())
print(map_df[['Code','Response','Tissue']].drop_duplicates().head(20))


# %% cell 18
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(path)
norm_df = xl.parse('NormCount')
# derive columns using manual logic for DESeq comparisons 7-9 only
c0,c1,c2 = norm_df.iloc[0],norm_df.iloc[1],norm_df.iloc[2]
cols=[]
for j,(a,b,c) in enumerate(zip(c0,c1,c2)):
    label = None
    if 'DESeq, Comparison 7' in str(a): label = 'Comp7_'+str(c)
    elif 'DESeq, Comparison 8' in str(a): label = 'Comp8_'+str(c)
    elif 'DESeq, Comparison 9' in str(a): label = 'Comp9_'+str(c)
    elif j>=179: label = f'Comp{j-178}_DEG'
    else:
        label = str(c)
    cols.append(label)


data = norm_df.iloc[3:].copy()
data.columns = cols
print(data[['Index','GeneID']+['Comp7_log2FoldChange','Comp7_pval','Comp7_baseMean']].head())


# %% cell 19
import os,pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(path)
norm_df=xl.parse('NormCount')
# show cols 140-178 headers triples
for i in range(140,179):
 print(i, norm_df.columns[i], norm_df.iloc[0,i], norm_df.iloc[1,i], norm_df.iloc[2,i])


# %% cell 20
import os,pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(path)
norm_df=xl.parse('NormCount')
# construct explicit info table describing comparisons
info_rows=[]
for i in range(140,179):
 info_rows.append({'idx':i,'top':norm_df.iloc[0,i],'mid':norm_df.iloc[1,i],'bot':norm_df.iloc[2,i]})
print(pd.DataFrame(info_rows))


# %% cell 21
import os,pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(path)
norm_df=xl.parse('NormCount')
# build minimal gene+Comp7/8/9 stats using known column indices
data = norm_df.iloc[3:].copy()
# locate gene columns
index_col = data.columns[0]
gene_col = data.columns[1]
# comp7 stats indices 152-158, comp8 161-167, comp9 170-176
cols = {
 'Index': index_col,
 'GeneID': gene_col,
 'Comp7_baseMean': data.columns[152],
 'Comp7_log2FC': data.columns[156],
 'Comp7_pval': data.columns[157],
 'Comp8_baseMean': data.columns[161],
 'Comp8_log2FC': data.columns[165],
 'Comp8_pval': data.columns[166],
 'Comp9_baseMean': data.columns[170],
 'Comp9_log2FC': data.columns[174],
 'Comp9_pval': data.columns[175],
}
sub = data[list(cols.values())].copy()
sub.columns = list(cols.keys())
for c in ['Comp7_baseMean','Comp7_log2FC','Comp7_pval','Comp8_baseMean','Comp8_log2FC','Comp8_pval','Comp9_baseMean','Comp9_log2FC','Comp9_pval']:
 sub[c] = pd.to_numeric(sub[c], errors='coerce')
print(sub.head())
print(sub.describe())


# %% cell 22
import os,pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(path)
map_df=xl.parse('Mapping_statistics')

# Comp7: Control vs good_responder (dentate gyrus)
# Comp8: Control vs bad_responder (dentate gyrus)
# Comp9: good_responder vs bad_responder (dentate gyrus)

norm_df=xl.parse('NormCount')
data = norm_df.iloc[3:].copy()
index_col = data.columns[0]
gene_col = data.columns[1]
sub = data[[index_col,gene_col] + list(data.columns[152:159]) + list(data.columns[161:168]) + list(data.columns[170:177])].copy()
sub.columns = ['Index','GeneID',
               'DG_Ctrl_vs_Good_baseMean','DG_Ctrl_vs_Good_baseMeanA','DG_Ctrl_vs_Good_baseMeanB','DG_Ctrl_vs_Good_FC','DG_Ctrl_vs_Good_log2FC','DG_Ctrl_vs_Good_pval','DG_Ctrl_vs_Good_padj',
               'DG_Ctrl_vs_Bad_baseMean','DG_Ctrl_vs_Bad_baseMeanA','DG_Ctrl_vs_Bad_baseMeanB','DG_Ctrl_vs_Bad_FC','DG_Ctrl_vs_Bad_log2FC','DG_Ctrl_vs_Bad_pval','DG_Ctrl_vs_Bad_padj',
               'DG_Good_vs_Bad_baseMean','DG_Good_vs_Bad_baseMeanA','DG_Good_vs_Bad_baseMeanB','DG_Good_vs_Bad_FC','DG_Good_vs_Bad_log2FC','DG_Good_vs_Bad_pval','DG_Good_vs_Bad_padj']
for c in sub.columns[2:]:
 sub[c]=pd.to_numeric(sub[c],errors='coerce')

# q3: pattern of shared DEG in dentate gyrus across good, bad, controls using p<0.05, |lfc|>0.5, baseMean>10
crit = {'good':('DG_Ctrl_vs_Good_log2FC','DG_Ctrl_vs_Good_pval','DG_Ctrl_vs_Good_baseMean'),
        'bad':('DG_Ctrl_vs_Bad_log2FC','DG_Ctrl_vs_Bad_pval','DG_Ctrl_vs_Bad_baseMean'),
        'good_vs_bad':('DG_Good_vs_Bad_log2FC','DG_Good_vs_Bad_pval','DG_Good_vs_Bad_baseMean')}
sets={}
for k,(lfc,pv,bm) in crit.items():
 m = sub[pv] < 0.05
 m &= sub[lfc].abs()>0.5
 m &= sub[bm] > 10
 sets[k]=set(sub.loc[m,'GeneID'])
 print(k, len(sets[k]))

print('good & bad', len(sets['good'] & sets['bad']))
print('good & good_vs_bad', len(sets['good'] & sets['good_vs_bad']))
print('bad & good_vs_bad', len(sets['bad'] & sets['good_vs_bad']))
print('all three', len(sets['good'] & sets['bad'] & sets['good_vs_bad']))

# q4: one-way ANOVA Category effect across tissue-response combinations
# Need long-format normalized counts and fit ANOVA per gene? could be existing in file; check if any ANOVA p column exists
print([c for c in norm_df.iloc[2] if isinstance(c,str) and 'ANOVA' in c])


# %% cell 23
# q5: per tissue, bad vs control DEGs counts using |lfc|>0.5, baseMean>10
import os,pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(path)
norm_df=xl.parse('NormCount')

# Based on layout: Comparisons likely:
# 1: baseline blood Control vs good
# 2: baseline blood Control vs bad
# 3: dentate gyrus Control vs good
# 4: dentate gyrus Control vs bad
# 5: final blood Control vs good
# 6: final blood Control vs bad
# 7-9 involve other contrasts; but we only need bad vs control: comps 2,4,6

# Extract stats for comparisons 2,4,6 via indices from exploration
# comp2 stats around columns? quick search of 'Comparison 2' in row0
for i,val in enumerate(norm_df.iloc[0]):
 if isinstance(val,str) and 'Comparison 2' in val:
  print('idx',i,val)


# %% cell 24
import os,pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(path)
norm_df=xl.parse('NormCount')
print(norm_df.iloc[0,120:160])


# %% cell 25
import os,pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(path)
norm_df=xl.parse('NormCount')
for i in range(120,160):
 print('col',i, 'row1', norm_df.iloc[1,i], 'row2', norm_df.iloc[2,i])


# %% cell 26
import os,pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(path)
norm_df=xl.parse('NormCount')
# build summary mapping comparison to pval column index
info=[]
for i,val in enumerate(norm_df.iloc[0]):
 if isinstance(val,str) and 'DESeq, Comparison' in val:
  info.append({'idx':i,'label':val})
print(info)


# %% cell 27
# count bad vs control DE per comparison 2,4,6 using DEG flag columns from Comparison2-6 if present
import os,pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(path)
norm_df=xl.parse('NormCount')

# based on header, last 9 columns (179-187) are DEG flags for Comparisons1-9
flags = norm_df.iloc[3:,179:188].copy()
flags.columns=[f'Comp{i}_DEGflag' for i in range(1,10)]
# attach gene IDs
flags.insert(0,'GeneID', norm_df.iloc[3:,1].values)

for i in range(1,10):
 print('Comp',i,'DEGs', (flags[f'Comp{i}_DEGflag']!='-').sum())


# %% cell 28
# Determine which comparisons correspond to which tissue/response based on counts and literature; but to answer q5, we just need relative max across tissues for bad vs control
# differences bad vs control by tissue likely: baseline blood (Comp2), dentate gyrus (Comp4), final blood (Comp6)
# confirm by looking at log2FC distribution vs DG-specific earlier
import os,pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(path)
norm_df=xl.parse('NormCount')

# get log2FC columns around comp2,4,6 using structure pattern from indices
# From earlier: for comp4, log2FC at col129, comp5 at 138; so pattern increment 9.
# Work backwards: comp6 log2FC at 147, comp4 at 129, comp2 at 111.

data = norm_df.iloc[3:].copy()
log2_cols = {2: data.columns[111],4: data.columns[129],6: data.columns[147]}
base_cols = {2: data.columns[107],4: data.columns[125],6: data.columns[143]}
p_cols    = {2: data.columns[112],4: data.columns[130],6: data.columns[148]}
print(log2_cols, base_cols, p_cols)

sub = pd.DataFrame({'GeneID': data.iloc[:,1]})
for comp in [2,4,6]:
 sub[f'C{comp}_log2FC']=pd.to_numeric(data[log2_cols[comp]],errors='coerce')
 sub[f'C{comp}_pval']=pd.to_numeric(data[p_cols[comp]],errors='coerce')
 sub[f'C{comp}_baseMean']=pd.to_numeric(data[base_cols[comp]],errors='coerce')

for comp in [2,4,6]:
 m = (sub[f'C{comp}_pval']<0.05) & (sub[f'C{comp}_log2FC'].abs()>0.5) & (sub[f'C{comp}_baseMean']>10)
 print('Comp',comp,'n',m.sum())


# %% cell 29
# Q4: ANOVA Category effect p-value likely in Mapping_statistics or another sheet; search
import os,pandas as pd, numpy as np
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(path)
for s in xl.sheet_names:
 df=xl.parse(s)
 for col in df.columns:
  if isinstance(col,str) and 'ANOVA' in col or 'Category' in str(col):
   print('sheet',s,'col',col)


# %% cell 30
# construct long format and run one-way ANOVA for each gene but they ask only p-value for overall Category effect across all genes? could be from MANOVA on PCs.
# interpret as per-gene ANOVA; maybe they want omnibus test on all genes combined via linear model and F-test with Category.
# We can fit for each gene and then combine p-values? But question singular.
# Alternative: there may be an ANOVA across samples for global expression (sum counts). We'll compute per-gene ANOVA and then F-test across genes via permutation not feasible.
# Instead, treat Category as factor in linear model for each gene, get p-values, then summarise via, say, median; but question: 'What is the statistical significance level (p-value)...' maybe refers to overall model on DESeq design; not present.
# Given missing explicit value, we can approximate via MANOVA on first PC of normalized counts.
import os,pandas as pd,numpy as np,statsmodels.api as sm,statsmodels.formula.api as smf
path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(path)
norm_df=xl.parse('NormCount')
# build expression matrix
header = norm_df.iloc[2]
expr = norm_df.iloc[3:,2:92].copy()
expr.columns = header[2:92]
expr = expr.apply(pd.to_numeric,errors='coerce')

# sample metadata from column names and Mapping_statistics
map_df=xl.parse('Mapping_statistics')
meta = []
for col in expr.columns:
 row = map_df[map_df['Code']==col].iloc[0]
 meta.append({'sample':col,'Tissue':row['Tissue'],'Response':row['Response']})
meta_df = pd.DataFrame(meta)
meta_df['Category']=meta_df['Tissue']+'_'+meta_df['Response']

# compute first PC across genes
from sklearn.decomposition import PCA
X = expr.T # samples x genes
X = np.log2(X+1)
X = X - X.mean(axis=0)
pca = PCA(n_components=1)
pc1 = pca.fit_transform(X)[:,0]
meta_df['PC1']=pc1

# run ANOVA of PC1 ~ Category
model = smf.ols('PC1 ~ C(Category)', data=meta_df).fit()
aov = sm.stats.anova_lm(model, typ=2)
print(aov)

