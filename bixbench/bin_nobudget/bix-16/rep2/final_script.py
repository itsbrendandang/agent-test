
# %% cell 0
import os, pandas as pd
from scipy import stats

DATA_DIR = os.environ['DATA_DIR']
base = os.path.join(DATA_DIR, 'CapsuleData-bda54b38-9b49-4009-aad6-d5f52675438a')
expr_path = os.path.join(base, 'OmicsExpressionProteinCodingGenesTPMLogp1BatchCorrected.csv')
crispr_path = os.path.join(base, 'CRISPRGeneEffect.csv')

expr = pd.read_csv(expr_path, index_col=0)
crispr = pd.read_csv(crispr_path, index_col=0)
print(expr.shape, crispr.shape)
print(expr.index[:5])
print(crispr.index[:5])

# align cell lines (columns)
common_cols = expr.columns.intersection(crispr.columns)
expr_al = expr[common_cols]
crispr_al = crispr[common_cols]
print('aligned shapes', expr_al.shape, crispr_al.shape)

# q2: skewness of all expression values
from scipy.stats import skew
expr_vals = expr_al.values.ravel()
expr_skew = skew(expr_vals, bias=False)
print('skewness', expr_skew)

# compute Spearman for each gene between expression and its own essentiality profile
import numpy as np
n_genes = expr_al.shape[0]
coords = []
for gene in expr_al.index:
    if gene in crispr_al.index:
        x = expr_al.loc[gene].values
        y = crispr_al.loc[gene].values
        if np.all(np.isnan(y)) or np.all(np.isnan(x)):
            continue
        mask = np.isfinite(x) & np.isfinite(y)
        if mask.sum() < 3:
            continue
        rho, p = stats.spearmanr(x[mask], y[mask])
        coords.append((gene, rho, p))

res = pd.DataFrame(coords, columns=['gene','rho','p'])
print('n tested genes', res.shape[0])
print(res.sort_values('rho').head())
print(res.sort_values('rho', ascending=False).head())

# q3: count strong positive rho>=0.6
strong_pos = (res['rho'] >= 0.6).sum()
print('strong positive >=0.6 count', strong_pos)

# q4: BH correction
from statsmodels.stats.multitest import multipletests
rej, p_adj, _, _ = multipletests(res['p'].values, alpha=0.05, method='fdr_bh')
res['p_adj'] = p_adj
res['sig'] = rej
sig_pct = rej.mean()*100
print('significant %', sig_pct)

# identify strongest negative gene
min_row = res.loc[res['rho'].idxmin()]
print('strongest negative', min_row)


# %% cell 1
import os, pandas as pd
print(os.environ['DATA_DIR'])

# %% cell 2
import os, pandas as pd
DATA_DIR = os.environ['DATA_DIR']
base = os.path.join(DATA_DIR, 'CapsuleData-bda54b38-9b49-4009-aad6-d5f52675438a')
print(base)
import os
print(os.path.exists(base))
print(os.listdir(base))

# %% cell 3
import os, pandas as pd
DATA_DIR = os.environ['DATA_DIR']
expr_path = os.path.join(DATA_DIR, 'OmicsExpressionProteinCodingGenesTPMLogp1BatchCorrected.csv')
crispr_path = os.path.join(DATA_DIR, 'CRISPRGeneEffect.csv')
print(expr_path, os.path.exists(expr_path))
print(crispr_path, os.path.exists(crispr_path))
expr = pd.read_csv(expr_path, index_col=0)
crispr = pd.read_csv(crispr_path, index_col=0)
print(expr.shape, crispr.shape)
print(expr.index[:5])
print(crispr.index[:5])

common_cols = expr.columns.intersection(crispr.columns)
expr_al = expr[common_cols]
crispr_al = crispr[common_cols]
print('aligned shapes', expr_al.shape, crispr_al.shape)

from scipy.stats import skew
expr_vals = expr_al.values.ravel()
expr_skew = skew(expr_vals, bias=False)
print('skewness', expr_skew)

from scipy import stats
import numpy as np

coords = []
for gene in expr_al.index:
    if gene in crispr_al.index:
        x = expr_al.loc[gene].values
        y = crispr_al.loc[gene].values
        mask = np.isfinite(x) & np.isfinite(y)
        if mask.sum() < 3:
            continue
        rho, p = stats.spearmanr(x[mask], y[mask])
        coords.append((gene, rho, p))

import pandas as pd
res = pd.DataFrame(coords, columns=['gene','rho','p'])
print('n tested genes', res.shape[0])
print(res.sort_values('rho').head())
print(res.sort_values('rho', ascending=False).head())

strong_pos = (res['rho'] >= 0.6).sum()
print('strong positive >=0.6 count', strong_pos)

from statsmodels.stats.multitest import multipletests
rej, p_adj, _, _ = multipletests(res['p'].values, alpha=0.05, method='fdr_bh')
res['p_adj'] = p_adj
res['sig'] = rej
sig_pct = rej.mean()*100
print('significant %', sig_pct)

min_row = res.loc[res['rho'].idxmin()]
print('strongest negative', min_row)

