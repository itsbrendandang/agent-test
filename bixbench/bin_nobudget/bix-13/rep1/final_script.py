
# %% cell 0
import os, pandas as pd
print(os.environ['DATA_DIR'])
meta = pd.read_csv(os.path.join(os.environ['DATA_DIR'],'experiment_metadata.csv'))
print(meta.head())
counts = pd.read_csv(os.path.join(os.environ['DATA_DIR'],'raw_counts.csv'), index_col=0)
print(counts.shape)
print(counts.iloc[:5,:5])

# %% cell 1
import pandas as pd, os
from rpy2.robjects import r, pandas2ri
import rpy2.robjects.packages as rpackages
pandas2ri.activate()

# install/load DESeq2
utils = rpackages.importr('utils')
utils.chooseCRANmirror(ind=1)
for pkg in ['DESeq2']: 
    if not rpackages.isinstalled(pkg):
        utils.install_packages(pkg)

deseq2 = rpackages.importr('DESeq2')

meta = pd.read_csv(os.path.join(os.environ['DATA_DIR'],'experiment_metadata.csv'))
counts = pd.read_csv(os.path.join(os.environ['DATA_DIR'],'raw_counts.csv'), index_col=0)

# order columns to match metadata
counts = counts[meta['AzentaName']]

# convert Strain to factor with labels
meta['Strain'] = meta['Strain'].map({1:'JBX1',97:'JBX97',98:'JBX98',99:'JBX99'})

from rpy2.robjects import Formula

r_counts = pandas2ri.py2rpy(counts)
r_meta = pandas2ri.py2rpy(meta)

r('library(DESeq2)')

dds = r['DESeqDataSetFromMatrix'](countData=r_counts, colData=r_meta, design=Formula('~ Replicate + Media + Strain'))

dds = r['DESeq'](dds)

# save dispersion estimates pre-shrinkage
import numpy as np

disp = r['dispersions'](dds)
import rpy2.robjects.numpy2ri as numpy2ri
numpy2ri.activate()
import numpy as np

disp_np = np.array(disp)
print('num disp < 1e-5:', (disp_np < 1e-5).sum())

# results for each strain vs JBX1
res97 = r['results'](dds, contrast=r('c("Strain","JBX97","JBX1")'))
res98 = r['results'](dds, contrast=r('c("Strain","JBX98","JBX1")'))
res99 = r['results'](dds, contrast=r('c("Strain","JBX99","JBX1")'))

res97_df = pandas2ri.rpy2py(res97).set_index(counts.index)
res98_df = pandas2ri.rpy2py(res98).set_index(counts.index)
res99_df = pandas2ri.rpy2py(res99).set_index(counts.index)

for name,df in [('97',res97_df),('98',res98_df),('99',res99_df)]:
    sig = (df['padj']<0.05)
    print(name, sig.sum())

# Q3 already printed

# define DE sets padj<0.05
sig97 = res97_df['padj']<0.05
sig98 = res98_df['padj']<0.05
sig99 = res99_df['padj']<0.05

# Q2: uniquely sig in 98
uniq98 = sig98 & ~sig97 & ~sig99
print('Q2 uniq98 count:', uniq98.sum())

# Q4: uniquely sig in 97 or 98 (relative to both other strains)
uniq97 = sig97 & ~sig98 & ~sig99
uniq98_only = sig98 & ~sig97 & ~sig99
uniq_union = uniq97 | uniq98_only
print('Q4 unique union count:', uniq_union.sum(), 'percentage:', uniq_union.sum()/len(sig97)*100)

# Q5: sig in 97 or 98 but not in 99
q5 = (sig97 | sig98) & ~sig99
print('Q5 count:', q5.sum())

# Q1: genes sig DE in 97 with abs(log2FC)>1.5 & padj<0.05
lfc97 = res97_df['log2FoldChange']
lfc99 = res99_df['log2FoldChange']

sel97 = sig97 & (abs(lfc97)>1.5)
print('num JBX97 DE with lfc cutoff:', sel97.sum())

sel_both = sel97 & sig99 & ~sig98
print('num also DE in 99 only:', sel_both.sum(), 'percentage:', sel_both.sum()/sel97.sum()*100)

# %% cell 2
import pandas as pd, os
print('Need DESeq2 in R; not available via rpy2. Cannot perform DESeq2-specific tasks.')
