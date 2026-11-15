
# %% cell 0
import os
import pandas as pd
print(os.environ['DATA_DIR'])
path=os.path.join(os.environ['DATA_DIR'],'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
print(pd.ExcelFile(path).sheet_names)

# %% cell 1
import os, pandas as pd
path=os.path.join(os.environ['DATA_DIR'],'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
nc=pd.read_excel(path,'NormCount')
print(nc.head())
print(nc.columns[:20])

# %% cell 2
import os, pandas as pd
path=os.path.join(os.environ['DATA_DIR'],'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
_nc=pd.read_excel(path,'NormCount',header=None)
print(_nc.iloc[:10,:15])

# %% cell 3
import os, pandas as pd
path=os.path.join(os.environ['DATA_DIR'],'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
_nc=pd.read_excel(path,'NormCount',header=None)
print(_nc.iloc[2,:40])

# %% cell 4
import os, pandas as pd
path=os.path.join(os.environ['DATA_DIR'],'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
_nc=pd.read_excel(path,'NormCount',header=3)
print(_nc.columns[:40])
print(_nc.head())

# %% cell 5
import os, pandas as pd, numpy as np
path=os.path.join(os.environ['DATA_DIR'],'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
nc=pd.read_excel(path,'NormCount',header=3)
control_cols=[c for c in nc.columns if c.startswith('Control_')]
print(len(control_cols))
print(control_cols)
# pick tissues
baseline=[c for c in control_cols if 'baseline_blood' in c]
final=[c for c in control_cols if 'final_blood' in c]
dg=[c for c in control_cols if 'dentate_gyrus' in c]
print(len(baseline),len(final),len(dg))

# %% cell 6
import numpy as np, pandas as pd, os
from math import floor
path=os.path.join(os.environ['DATA_DIR'],'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
nc=pd.read_excel(path,'NormCount',header=3)
control_cols=[c for c in nc.columns if c.startswith('Control_')]
cts=nc[control_cols].astype(float)
cts_int=np.round(cts).astype(int)
cts_int[cts_int<0]=0
cts_int.index=nc['GeneID']
print(cts_int.iloc[:5,:5])

# prepare DESeq2-like analysis via edgeR-like using statsmodels? Instead approximate with negative binomial GLM per gene might be heavy. Instead, maybe DEG columns already give DESeq2 results.
print([c for c in nc.columns if 'Comparison' in c][:10])
print(nc[[c for c in nc.columns if 'Comparison1' in c or 'Comparison2' in c]].head())

# %% cell 7
import os, pandas as pd
path=os.path.join(os.environ['DATA_DIR'],'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
ms=pd.read_excel(path,'Mapping_statistics')
print(ms.head())
print(ms.columns)

# %% cell 8
import os, pandas as pd
path=os.path.join(os.environ['DATA_DIR'],'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
nc=pd.read_excel(path,'NormCount',header=3)
print([c for c in nc.columns if 'Comparison' in c])
print(nc.columns[160:188])

# %% cell 9
import os, pandas as pd
path=os.path.join(os.environ['DATA_DIR'],'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
nc=pd.read_excel(path,'NormCount',header=None)
print(nc.iloc[0:6,160:188])

# %% cell 10
import os, pandas as pd
path=os.path.join(os.environ['DATA_DIR'],'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
raw=pd.read_excel(path,'NormCount',header=None)
meta_row0=raw.iloc[0]
print(meta_row0[160:188])

# Read with header at row3 again for data
nc=pd.read_excel(path,'NormCount',header=3)

# Attach comparison labels from row0/1/2/3
labels=raw.iloc[0:4,160:188]
print(labels)

# %% cell 11
import os, pandas as pd
path=os.path.join(os.environ['DATA_DIR'],'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
raw=pd.read_excel(path,'NormCount',header=None)
# find where DESeq comparison blocks start
for j in range(raw.shape[1]):
    if str(raw.iloc[0,j]).startswith('DESeq'):
        print(j, raw.iloc[0,j])

# %% cell 12
import os, pandas as pd
path=os.path.join(os.environ['DATA_DIR'],'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
raw=pd.read_excel(path,'NormCount',header=None)

for comp in range(1,10):
    start={1:98,2:107,3:116,4:125,5:134,6:143,7:152,8:161,9:170}[comp]
    cols=list(range(start,start+9))
    block=raw.iloc[:,cols]
    print('\nComparison',comp)
    print(block.iloc[0:6,:3])
    print(block.iloc[3,:9])

# %% cell 13
import os, pandas as pd
path=os.path.join(os.environ['DATA_DIR'],'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
raw=pd.read_excel(path,'NormCount',header=None)

# sample columns header row3
hdr=raw.iloc[3]
print(hdr[0:40])

# also look near DESeq blocks for labels of comparisons
print(raw.iloc[0:10,90:110])

# %% cell 14
import os, pandas as pd
path=os.path.join(os.environ['DATA_DIR'],'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
raw=pd.read_excel(path,'NormCount',header=None,nrows=15,usecols=range(0,110))
print(raw.iloc[3,0:40])
print(raw.iloc[0:10,90:110])

# %% cell 15
import os, pandas as pd
path=os.path.join(os.environ['DATA_DIR'],'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
raw=pd.read_excel(path,'NormCount',header=None,nrows=15,usecols=range(90,188))
print(raw.iloc[3])
print('\nRow0 labels:')
print(raw.iloc[0])

# %% cell 16
import os, pandas as pd
path=os.path.join(os.environ['DATA_DIR'],'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
raw=pd.read_excel(path,'NormCount',header=None)

# print headers at columns 90-110 rows2-5
for r in range(0,6):
    print('row',r)
    print(raw.iloc[r,90:110])

# %% cell 17
import os, pandas as pd
path=os.path.join(os.environ['DATA_DIR'],'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
raw=pd.read_excel(path,'NormCount',header=None)

# mapping for comparisons to tissue labels
col90_99=raw.iloc[3,90:100]
print(col90_99)

# padj & log2FC columns for comparison1: indexes 103 and 102
comp1_padj=raw.iloc[4:,104]
comp1_log2fc=raw.iloc[4:,102]
comp1_baseMean=raw.iloc[4:,98]
# how many DEGs baseline vs final blood? assume Comparison1 is baseline vs dentate? need check mapping by DESeq sheet

# Let's inspect mapping sheet for DESeq comparisons
ms=pd.read_excel(path,'Mapping_statistics')
print(ms[['DESeq','Tissue']].dropna().head(20))

# %% cell 18
import os, pandas as pd
path=os.path.join(os.environ['DATA_DIR'],'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
raw=pd.read_excel(path,'NormCount',header=None)

# function to extract comparison stats
start_indices={1:98,2:107,3:116,4:125,5:134,6:143,7:152,8:161,9:170}
comp_stats={}
for comp, start in start_indices.items():
    baseMean=raw.iloc[4:,start]
    log2fc=raw.iloc[4:,start+4]
    padj=raw.iloc[4:,start+6]
    DEG=raw.iloc[4:,start+7]
    comp_stats[comp]=pd.DataFrame({'baseMean':baseMean,'log2FoldChange':log2fc,'padj':padj,'DEG':DEG})
    # attach gene IDs
    comp_stats[comp].index=raw.iloc[4:,1]

for c in [1,2,3]:
    print('Comp',c,comp_stats[c].head())

# Determine which comparison is final vs baseline blood using group labels row3
print(raw.iloc[3,92:99])

# %% cell 19
import os, pandas as pd
path=os.path.join(os.environ['DATA_DIR'],'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
raw=pd.read_excel(path,'NormCount',header=None)

start_indices={1:98,2:107,3:116,4:125,5:134,6:143,7:152,8:161,9:170}

# Comparison labels (which tissues) from row3 columns92-97
print(raw.iloc[3,92:99])

# figure out which pair each comparison corresponds to by checking row2 "Max/Median"? Instead inspect header around each block for tissue labels just before block
for comp,start in start_indices.items():
    print('\nComparison',comp)
    print(raw.iloc[3,start-7:start])

# %% cell 20
import os, pandas as pd
path=os.path.join(os.environ['DATA_DIR'],'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
raw=pd.read_excel(path,'NormCount',header=None)

# Identify which comparisons use control group only vs others via description? maybe doc in supplemental, but here check first few padj <0.05 per comp
start_indices={1:98,2:107,3:116,4:125,5:134,6:143,7:152,8:161,9:170}

for comp,start in start_indices.items():
    df=pd.DataFrame({
        'gene':raw.iloc[4:,1],
        'baseMean':raw.iloc[4:,start],
        'log2FC':raw.iloc[4:,start+4],
        'padj':raw.iloc[4:,start+6],
    })
    df['padj_num']=pd.to_numeric(df['padj'],errors='coerce')
    sig=(df['padj_num']<0.05)&(df['padj_num'].notna())
    print('Comp',comp,'sig genes',sig.sum())

# %% cell 21
import os, pandas as pd
path=os.path.join(os.environ['DATA_DIR'],'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
raw=pd.read_excel(path,'NormCount',header=None)

# We know columns92-94 are tissue labels, likely group A/B for Comparison1 baseline vs dentate or final. Need mapping from DESeq column to tissues.
# Inspect DESeq column names in Mapping_statistics maybe
ms=pd.read_excel(path,'Mapping_statistics')
print([c for c in ms.columns if 'Comparison' in str(c)])
print(ms.filter(regex='Comparison').head())

# %% cell 22
import os, pandas as pd, numpy as np
path=os.path.join(os.environ['DATA_DIR'],'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
raw=pd.read_excel(path,'NormCount',header=None)

start_indices={1:98,2:107,3:116,4:125,5:134,6:143,7:152,8:161,9:170}
comp_stats={}
for comp,start in start_indices.items():
    df=pd.DataFrame({
        'gene':raw.iloc[4:,1].values,
        'baseMean':pd.to_numeric(raw.iloc[4:,start],errors='coerce').values,
        'log2FC':pd.to_numeric(raw.iloc[4:,start+4],errors='coerce').values,
        'padj':pd.to_numeric(raw.iloc[4:,start+6],errors='coerce').values,
    })
    comp_stats[comp]=df.set_index('gene')

# choose mapping by effect pattern: dentate vs blood should have large changes, blood vs blood smaller.
for comp in range(1,10):
    df=comp_stats[comp]
    print('Comp',comp,'|log2FC| median',np.nanmedian(np.abs(df['log2FC'])))

# %% cell 23
import os, pandas as pd, numpy as np
path=os.path.join(os.environ['DATA_DIR'],'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
raw=pd.read_excel(path,'NormCount',header=None)

start_indices={1:98,2:107,3:116,4:125,5:134,6:143,7:152,8:161,9:170}
comp_stats={}
for comp,start in start_indices.items():
    df=pd.DataFrame({
        'gene':raw.iloc[4:,1].values,
        'baseMean':pd.to_numeric(raw.iloc[4:,start],errors='coerce').values,
        'log2FC':pd.to_numeric(raw.iloc[4:,start+4],errors='coerce').values,
        'padj':pd.to_numeric(raw.iloc[4:,start+6],errors='coerce').values,
    })
    comp_stats[comp]=df.set_index('gene')

# define DE criteria
fdr05={c:comp_stats[c][comp_stats[c]['padj']<0.05] for c in comp_stats}
crit_counts={c:len(df[(df['baseMean']>=10)&(np.abs(df['log2FC'])>1)]) for c,df in fdr05.items()}
print(crit_counts)

# genome size
n_genes=len(comp_stats[1])
print('n_genes',n_genes)

# pick which comp is final vs baseline by being blood-blood with fewer DE? maybe comp1 (70 sig) or comp8 (27 sig)
print({c:len(fdr05[c]) for c in fdr05})

# %% cell 24
import os, pandas as pd, numpy as np
path=os.path.join(os.environ['DATA_DIR'],'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
raw=pd.read_excel(path,'NormCount',header=None)

start_indices={1:98,2:107,3:116,4:125,5:134,6:143,7:152,8:161,9:170}
comp_stats={}
for comp,start in start_indices.items():
    df=pd.DataFrame({
        'gene':raw.iloc[4:,1].values,
        'baseMean':pd.to_numeric(raw.iloc[4:,start],errors='coerce').values,
        'log2FC':pd.to_numeric(raw.iloc[4:,start+4],errors='coerce').values,
        'padj':pd.to_numeric(raw.iloc[4:,start+6],errors='coerce').values,
    })
    comp_stats[comp]=df.set_index('gene')

# infer mapping by looking at baseMeanA/B for comp1: columns99/100
bmA1=pd.to_numeric(raw.iloc[4:,99],errors='coerce')
bmB1=pd.to_numeric(raw.iloc[4:,100],errors='coerce')
print('comp1 mean baseMeanA',bmA1.mean(),'B',bmB1.mean())
# also comp8 A/B
bmA8=pd.to_numeric(raw.iloc[4:,162],errors='coerce')
bmB8=pd.to_numeric(raw.iloc[4:,163],errors='coerce')
print('comp8 mean baseMeanA',bmA8.mean(),'B',bmB8.mean())

# %% cell 25
# Compute Wilson CI for proportion of DE genes for candidate blood-blood comparison comp8
import math, numpy as np, os, pandas as pd
path=os.path.join(os.environ['DATA_DIR'],'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
raw=pd.read_excel(path,'NormCount',header=None)
start=161
n_genes=raw.shape[0]-4
padj=pd.to_numeric(raw.iloc[4:,start+6],errors='coerce')
log2fc=pd.to_numeric(raw.iloc[4:,start+4],errors='coerce')
baseMean=pd.to_numeric(raw.iloc[4:,start],errors='coerce')
mask=(padj<0.05)&(baseMean>=10)&(np.abs(log2fc)>1)
x=int(mask.sum())
n=int(mask.notna().sum())
print('x,n',x,n)

z=1.96
phat=x/n
center=(phat+z*z/(2*n))/(1+z*z/n)
half=z*math.sqrt(phat*(1-phat)/n+z*z/(4*n*n))/(1+z*z/n)
print('Wilson',center-half,center+half)

# %% cell 26
import os, pandas as pd, numpy as np, math
path=os.path.join(os.environ['DATA_DIR'],'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
raw=pd.read_excel(path,'NormCount',header=None)
start_indices={1:98,2:107,3:116,4:125,5:134,6:143,7:152,8:161,9:170}
comp_stats={}
for comp,start in start_indices.items():
    df=pd.DataFrame({
        'gene':raw.iloc[4:,1].values,
        'baseMean':pd.to_numeric(raw.iloc[4:,start],errors='coerce').values,
        'log2FC':pd.to_numeric(raw.iloc[4:,start+4],errors='coerce').values,
        'padj':pd.to_numeric(raw.iloc[4:,start+6],errors='coerce').values,
    })
    comp_stats[comp]=df.set_index('gene')

# Assume mapping: comp8 final vs baseline blood (Control), comp4 dentate vs baseline, comp5 dentate vs final (blood)
# counts for q1
c1=comp_stats[8]
mask1=(c1['padj']<0.05)&(c1['baseMean']>=10)&(np.abs(c1['log2FC'])>1)
print('q1 count',int(mask1.sum()))

# q3: DG vs baseline (comp4) specific vs also DE in DG vs final (comp5) or final vs baseline (comp8)
crit=lambda c: (c['padj']<0.05)&(np.abs(c['log2FC'])>1)
DGvBL=comp_stats[4]
DGvF=comp_stats[5]
FvBL=comp_stats[8]
A=DGvBL[crit(DGvBL)].index
B=DGvF[crit(DGvF)].index
C=FvBL[crit(FvBL)].index
specific=set(A)-set(B)-set(C)
print('q3 specific count',len(specific))

# q4: genes DE across all three comps
all3=set(A)&set(B)&set(C)
print('q4 all3 count',len(all3))

# q5: binomial exact test p-value for each comp, null p0=0.05 on DE proportion (padj<0.05 & |log2FC|>1), using two-sided exact from statsmodels
from statsmodels.stats.proportion import binom_test

p0=0.05
for label,comp in [('FvBL',8),('DGvBL',4),('DGvF',5)]:
    df=comp_stats[comp]
    m=crit(df)
    x=int(m.sum())
    n=int(m.notna().sum())
    p=binom_test(x,n,p0,alternative='two-sided')
    print(label,'x',x,'n',n,'p',p)

