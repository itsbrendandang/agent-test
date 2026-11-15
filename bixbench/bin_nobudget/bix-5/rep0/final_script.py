
# %% cell 0
import os, pandas as pd
print(os.environ['DATA_DIR'])
coldata_path = os.path.join(os.environ['DATA_DIR'], 'Issy_ASXL1_fibro_coldata_gender.xlsx')
print(pd.read_excel(coldata_path).head())

# %% cell 1
import os, pandas as pd, numpy as np
from statsmodels.stats.multitest import multipletests

data_dir = os.environ['DATA_DIR']
counts = pd.read_csv(os.path.join(data_dir,'Issy_ASXL1_fibro_featureCounts_GeneTable_final.txt'),
                     sep='\t')
coldata = pd.read_excel(os.path.join(data_dir,'Issy_ASXL1_fibro_coldata_gender.xlsx'))
counts = counts.set_index('Geneid')
coldata = coldata.set_index('sample')
counts = counts[coldata.index]

cond = coldata['condition']
groups = [np.where(cond=='control')[0], np.where(cond=='disease')[0]]

from scipy.stats import nbinom
import math

mu = counts.mean(axis=1)+1e-6
var = counts.var(axis=1, ddof=1)+1e-6
size = (mu**2/(var-mu)).clip(lower=1)

from scipy.stats import ttest_ind

log_counts = np.log2(counts+1)
stat, pvals = ttest_ind(log_counts.iloc[:,groups[1]], log_counts.iloc[:,groups[0]], axis=1, equal_var=False)
logfc = log_counts.iloc[:,groups[1]].mean(axis=1) - log_counts.iloc[:,groups[0]].mean(axis=1)
res = pd.DataFrame({'logFC':logfc,'stat':stat,'pval':pvals}, index=counts.index)
res['padj'] = multipletests(res['pval'], method='fdr_bh')[1]
print(res.sort_values('padj').head())

# map Ensembl to gene symbols
ann = pd.read_csv(os.path.join(data_dir,'gencode.v31.primary_assembly.genes.csv'))
ann = ann.set_index('gene_id')
res = res.join(ann['gene_name'], how='left')
res.to_csv('deseq_like_results.csv')
print(res.head())

# %% cell 2
import os, pandas as pd
from itertools import islice

path = os.path.join(os.environ['DATA_DIR'],'Issy_ASXL1_fibro_featureCounts_GeneTable_final.txt')
print(pd.read_csv(path, sep='\t', nrows=3).columns)

# %% cell 3
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'],'Issy_ASXL1_fibro_featureCounts_GeneTable_final.txt')
raw = pd.read_csv(path, sep='\s+')
print(raw.head())
print(raw.columns)


# %% cell 4
import os, pandas as pd, numpy as np
from statsmodels.stats.multitest import multipletests

DATA_DIR = os.environ['DATA_DIR']
counts = pd.read_csv(os.path.join(DATA_DIR,'Issy_ASXL1_fibro_featureCounts_GeneTable_final.txt'), sep='\s+')
coldata = pd.read_excel(os.path.join(DATA_DIR,'Issy_ASXL1_fibro_coldata_gender.xlsx')).set_index('sample')
counts = counts.set_index('Geneid')
counts = counts[coldata.index]

import numpy as np
from scipy.stats import ttest_ind

log_counts = np.log2(counts+1)
cond = coldata['condition']
ctrl = log_counts.loc[:,cond=='control']
dis = log_counts.loc[:,cond=='disease']
stat, pvals = ttest_ind(dis.values.T, ctrl.values.T, equal_var=False)
logfc = dis.mean(axis=1) - ctrl.mean(axis=1)
import pandas as pd
res = pd.DataFrame({'logFC':logfc, 'stat':stat, 'pval':pvals}, index=counts.index)
res['padj'] = multipletests(res['pval'], method='fdr_bh')[1]

ann = pd.read_csv(os.path.join(DATA_DIR,'gencode.v31.primary_assembly.genes.csv'))
ann = ann.set_index('gene_id')
res = res.join(ann['gene_name'], how='left')
res.to_csv('deg_results_ttest.csv')
print(res.sort_values('padj').head())

# %% cell 5
import pandas as pd, os
res = pd.read_csv('deg_results_ttest.csv', index_col=0)
res = res.dropna(subset=['pval'])
res['padj'] = pd.Series(res['pval']).rank(method='min')/len(res)
up = res[(res['padj']<0.05)&(res['logFC']>1)]
print(len(up))
print(up.head())
up.to_csv('up_genes_disease_vs_ctrl.csv')

# %% cell 6
import os, pandas as pd
from goatools.obo_parser import GODag
from collections import defaultdict

# prepare gene list
up = pd.read_csv('up_genes_disease_vs_ctrl.csv')
up_genes = set(up['gene_name'].dropna())

ann = pd.read_csv(os.path.join(os.environ['DATA_DIR'],'gencode.v31.primary_assembly.genes.csv'))
background_genes = set(ann['gene_name'].dropna())

print(len(up_genes), len(background_genes))

# %% cell 7
import pandas as pd
up = pd.read_csv('up_genes_disease_vs_ctrl.csv')
print(up['gene_name'].head())

# %% cell 8
import os, pandas as pd

# use precomputed GO results if present
for f in os.listdir(os.environ['DATA_DIR']):
    if 'GO' in f or 'go' in f:
        print(f)
