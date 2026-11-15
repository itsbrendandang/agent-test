
# %% cell 0
import os, pandas as pd, numpy as np, scipy.stats as stats
from statsmodels.stats.multitest import multipletests

DATA_DIR = os.environ['DATA_DIR']
print(os.listdir(DATA_DIR))

expr_path = os.path.join(DATA_DIR, 'OmicsExpressionProteinCodingGenesTPMLogp1BatchCorrected.csv')
crispr_path = os.path.join(DATA_DIR, 'CRISPRGeneEffect.csv')

expr = pd.read_csv(expr_path)
crispr = pd.read_csv(crispr_path)
print(expr.shape, crispr.shape)
print(expr.head())
print(crispr.head())

# %% cell 1
# align cell lines by Unnamed: 0
expr = expr.rename(columns={'Unnamed: 0':'ModelID'})
crispr = crispr.rename(columns={'Unnamed: 0':'ModelID'})

common = sorted(set(expr['ModelID']) & set(crispr['ModelID']))
expr_sub = expr[expr['ModelID'].isin(common)].set_index('ModelID').sort_index()
crispr_sub = crispr[crispr['ModelID'].isin(common)].set_index('ModelID').sort_index()
print(expr_sub.shape, crispr_sub.shape)

# intersect genes (columns)
expr_genes = set(expr_sub.columns)
crispr_genes = set(crispr_sub.columns)
common_genes = sorted(expr_genes & crispr_genes)
print('common genes', len(common_genes))

expr_mat = expr_sub[common_genes]
crispr_mat = crispr_sub[common_genes]

# compute skewness of all expression values
overall_expr_vals = expr_mat.values.ravel()
from scipy.stats import skew
skewness = skew(overall_expr_vals, bias=False)
print('skewness', skewness)

# compute spearman correlations per gene
from scipy.stats import rankdata

def spearman_for_two(a,b):
    return stats.spearmanr(a,b).correlation

cors = []
ps = []
for g in common_genes:
    x = expr_mat[g].values
    y = crispr_mat[g].values
    r, p = stats.spearmanr(x,y)
    cors.append(r)
    ps.append(p)

import numpy as np
cors = np.array(cors)
ps = np.array(ps)

min_idx = np.nanargmin(cors)
print('strongest negative gene', common_genes[min_idx], cors[min_idx])

# q3 count >=0.6
strong_pos = np.sum(cors>=0.6)
print('strong positive count', strong_pos)

# q4 BH FDR 0.05
from statsmodels.stats.multitest import multipletests
mask = ~np.isnan(ps)
rej, qvals, _, _ = multipletests(ps[mask], alpha=0.05, method='fdr_bh')
prop = rej.mean()*100
print('percent significant', prop)

# also store gene list and stats
out = pd.DataFrame({'gene': np.array(common_genes), 'spearman_r': cors, 'pval': ps})
out.to_csv('gene_correlations.csv', index=False)


# %% cell 2
import os, pandas as pd, numpy as np, scipy.stats as stats
from statsmodels.stats.multitest import multipletests
from scipy.stats import skew

DATA_DIR = os.environ['DATA_DIR']
expr_path = os.path.join(DATA_DIR, 'OmicsExpressionProteinCodingGenesTPMLogp1BatchCorrected.csv')
crispr_path = os.path.join(DATA_DIR, 'CRISPRGeneEffect.csv')

expr = pd.read_csv(expr_path)
crispr = pd.read_csv(crispr_path)

expr = expr.rename(columns={'Unnamed: 0':'ModelID'})
crispr = crispr.rename(columns={'Unnamed: 0':'ModelID'})

common = sorted(set(expr['ModelID']) & set(crispr['ModelID']))
expr_sub = expr[expr['ModelID'].isin(common)].set_index('ModelID').sort_index()
crispr_sub = crispr[crispr['ModelID'].isin(common)].set_index('ModelID').sort_index()
print('aligned shapes', expr_sub.shape, crispr_sub.shape)

expr_genes = set(expr_sub.columns)
crispr_genes = set(crispr_sub.columns)
common_genes = sorted(expr_genes & crispr_genes)
print('common genes', len(common_genes))

expr_mat = expr_sub[common_genes]
crispr_mat = crispr_sub[common_genes]

overall_expr_vals = expr_mat.values.ravel()
skewness = skew(overall_expr_vals, bias=False)
print('skewness', skewness)

cors = []
ps = []
for g in common_genes:
    x = expr_mat[g].values
    y = crispr_mat[g].values
    r, p = stats.spearmanr(x,y)
    cors.append(r)
    ps.append(p)

cors = np.array(cors)
ps = np.array(ps)

min_idx = np.nanargmin(cors)
print('strongest negative gene', common_genes[min_idx], cors[min_idx])

strong_pos = np.sum(cors>=0.6)
print('strong positive count', strong_pos)

mask = ~np.isnan(ps)
rej, qvals, _, _ = multipletests(ps[mask], alpha=0.05, method='fdr_bh')
prop = rej.mean()*100
print('percent significant', prop)

out = pd.DataFrame({'gene': np.array(common_genes), 'spearman_r': cors, 'pval': ps})
out.to_csv('gene_correlations.csv', index=False)

