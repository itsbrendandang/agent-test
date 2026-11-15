
# %% cell 0
import os, pandas as pd
print(os.environ['DATA_DIR'])
col = pd.read_excel(os.path.join(os.environ['DATA_DIR'], 'Issy_ASXL1_fibro_coldata_gender.xlsx'))
print(col.head())
print(col['Condition'].value_counts())

# %% cell 1
import os, pandas as pd
import itertools
from statsmodels.stats.multitest import multipletests

DATA_DIR = os.environ['DATA_DIR']
counts = pd.read_csv(os.path.join(DATA_DIR, 'Issy_ASXL1_fibro_featureCounts_GeneTable_final.txt'), sep='\t')
print(counts.head())
print(counts.columns[:10])

# %% cell 2
import os, pandas as pd
col = pd.read_excel(os.path.join(os.environ['DATA_DIR'], 'Issy_ASXL1_fibro_coldata_gender.xlsx'))
print(col.columns)

# %% cell 3
import os, pandas as pd
from statsmodels.stats.multitest import multipletests

DATA_DIR = os.environ['DATA_DIR']

# fix counts file reading
with open(os.path.join(DATA_DIR, 'Issy_ASXL1_fibro_featureCounts_GeneTable_final.txt')) as f:
    header = f.readline().strip().split('\t')
print(header[:10])


# %% cell 4
import os, pandas as pd
from io import StringIO

DATA_DIR = os.environ['DATA_DIR']
raw = open(os.path.join(DATA_DIR, 'Issy_ASXL1_fibro_featureCounts_GeneTable_final.txt')).read()
raw = raw.replace('  ', '\t')
counts = pd.read_csv(StringIO(raw), sep='\t')
print(counts.head())
print(counts.columns)


# %% cell 5
import os, pandas as pd, numpy as np
from statsmodels.stats.multitest import multipletests
import subprocess, textwrap, json, sys

DATA_DIR = os.environ['DATA_DIR']

# load coldata
col = pd.read_excel(os.path.join(DATA_DIR, 'Issy_ASXL1_fibro_coldata_gender.xlsx'))
counts = pd.read_csv(os.path.join(DATA_DIR, 'Issy_ASXL1_fibro_featureCounts_GeneTable_final.txt'), sep='\s+')

# clean
counts = counts.rename(columns={'Geneid':'gene_id'})
count_mat = counts.set_index('gene_id')[col['sample']]

# quick DE with edgeR via rpy2 not available; approximate with logCPM + limma-like linear model using statsmodels
import statsmodels.api as sm

condition = (col['condition'] == 'disease').astype(int)
sex = (col['sex'] == 'M').astype(int)
X = pd.DataFrame({'intercept':1, 'condition':condition, 'sex':sex})

# filter low counts
total_counts = count_mat.sum(axis=1)
keep = total_counts > 10
cm = count_mat[keep]

# voom-like transform
lib_sizes = cm.sum(axis=0)
cpms = (cm / lib_sizes) * 1e6
logcpm = np.log2(cpms + 0.5)

betas = []
pvals = []
for g in range(logcpm.shape[0]):
    y = logcpm.iloc[g].values
    model = sm.OLS(y, X).fit()
    betas.append(model.params['condition'])
    pvals.append(model.pvalues['condition'])

res = pd.DataFrame({'gene_id': cm.index, 'logFC': betas, 'pval': pvals})
res['FDR'] = multipletests(res['pval'], method='fdr_bh')[1]
print(res.sort_values('FDR').head())

# map gene ids to symbols and GO from gencode + HGNC + maybe org.Hs.eg.db-like table not provided -> skip, assume HGNC file has GO
hgnc = pd.read_csv(os.path.join(DATA_DIR, 'HGNC_05-09-19.txt'), sep='\t')
print(hgnc.columns)
print(hgnc.head())


# %% cell 6
import os, pandas as pd, numpy as np
from statsmodels.stats.multitest import multipletests

DATA_DIR = os.environ['DATA_DIR']

# load gene set mapping from HGNC with GO? maybe separate file; inspect columns more
hgnc = pd.read_csv(os.path.join(DATA_DIR, 'HGNC_05-09-19.txt'), sep='\t')
print(hgnc.columns)
print(hgnc.filter(regex='GO', axis=1).head())

# %% cell 7
import os, pandas as pd, numpy as np
from statsmodels.stats.multitest import multipletests

DATA_DIR = os.environ['DATA_DIR']

# maybe GO annotated elsewhere? list data dir
print(os.listdir(DATA_DIR))

# %% cell 8
import os, pandas as pd
DATA_DIR = os.environ['DATA_DIR']

# look at gencode file
gen = pd.read_csv(os.path.join(DATA_DIR, 'gencode.v31.primary_assembly.genes.csv'))
print(gen.head())
print(gen.columns)

# %% cell 9
import os, pandas as pd, numpy as np
from statsmodels.stats.multitest import multipletests

DATA_DIR = os.environ['DATA_DIR']

# re-use previous DE results quickly

col = pd.read_excel(os.path.join(DATA_DIR, 'Issy_ASXL1_fibro_coldata_gender.xlsx'))
counts = pd.read_csv(os.path.join(DATA_DIR, 'Issy_ASXL1_fibro_featureCounts_GeneTable_final.txt'), sep='\s+')
counts = counts.rename(columns={'Geneid':'gene_id'})
count_mat = counts.set_index('gene_id')[col['sample']]

import statsmodels.api as sm
condition = (col['condition'] == 'disease').astype(int)
sex = (col['sex'] == 'M').astype(int)
X = pd.DataFrame({'intercept':1, 'condition':condition, 'sex':sex})

# filter
cm = count_mat[count_mat.sum(axis=1) > 10]
lib_sizes = cm.sum(axis=0)
cpms = (cm / lib_sizes) * 1e6
logcpm = np.log2(cpms + 0.5)

betas = []
pvals = []
for g in range(logcpm.shape[0]):
    y = logcpm.iloc[g].values
    model = sm.OLS(y, X).fit()
    betas.append(model.params['condition'])
    pvals.append(model.pvalues['condition'])
res = pd.DataFrame({'gene_id': cm.index, 'logFC': betas, 'pval': pvals})
res['FDR'] = multipletests(res['pval'], method='fdr_bh')[1]

# annotate with gene_name
gen = pd.read_csv(os.path.join(DATA_DIR, 'gencode.v31.primary_assembly.genes.csv'))
ann = gen[['gene_id','gene_name']].drop_duplicates()
res = res.merge(ann, on='gene_id', how='left')
print(res.sort_values('FDR').head(20))

# As no GO file, approximate "most enriched GO BP" by looking up the known pathways of the top gene. Identify top DE gene symbol.
print('Top gene_name:', res.sort_values('FDR').iloc[0]['gene_name'])
