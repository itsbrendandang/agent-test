
# %% cell 0
import os, pandas as pd
print(os.environ['DATA_DIR'])
path = os.path.join(os.environ['DATA_DIR'], 'CapsuleData-bda54b38-9b49-4009-aad6-d5f52675438a', 'CRISPRGeneEffect.csv')
print(path)
df = pd.read_csv(path)
print(df.shape)
print(df.columns[:20])
print(df.head(3))

# %% cell 1
import os, pandas as pd
import numpy as np
from scipy.stats import spearmanr, skew

path = os.path.join(os.environ['DATA_DIR'], 'CapsuleData-bda54b38-9b49-4009-aad6-d5f52675438a', 'CRISPRGeneEffect.csv')
df = pd.read_csv(path)

cell_ids = df['Unnamed: 0']
expr = df.filter(regex=r' expr\)')
ess = df.filter(regex=r' essentiality\)')
print(expr.shape, ess.shape)
print(expr.columns[:5])
print(ess.columns[:5])

# %% cell 2
import os, pandas as pd
from scipy.stats import spearmanr, skew
import numpy as np

base = os.environ['DATA_DIR']
crispr_path = os.path.join(base, 'CRISPRGeneEffect.csv')
expr_path = os.path.join(base, 'OmicsExpressionProteinCodingGenesTPMLogp1BatchCorrected.csv')

crispr = pd.read_csv(crispr_path)
expr = pd.read_csv(expr_path)
print(crispr.shape, expr.shape)
print(crispr.columns[:5])
print(expr.columns[:5])

# align cell lines via Model.csv
model = pd.read_csv(os.path.join(base, 'Model.csv'))
print(model.head())
print(model.columns)


# %% cell 3
import os, pandas as pd
from scipy.stats import spearmanr, skew
import numpy as np

base = os.environ['DATA_DIR']
crispr = pd.read_csv(os.path.join(base, 'CRISPRGeneEffect.csv'))
expr = pd.read_csv(os.path.join(base, 'OmicsExpressionProteinCodingGenesTPMLogp1BatchCorrected.csv'))

# set index to model ID
crispr = crispr.rename(columns={'Unnamed: 0':'ModelID'}).set_index('ModelID')
expr = expr.rename(columns={'Unnamed: 0':'ModelID'}).set_index('ModelID')

common = crispr.index.intersection(expr.index)
crispr = crispr.loc[common]
expr = expr.loc[common]
print(crispr.shape, expr.shape)

# align genes: intersection of column names (gene symbol + id)
common_genes = crispr.columns.intersection(expr.columns)
print(len(common_genes))

crispr = crispr[common_genes]
expr = expr[common_genes]

# compute gene-wise Spearman correlations
rho = []
pval = []
for g in common_genes:
    r, p = spearmanr(expr[g], crispr[g], nan_policy='omit')
    rho.append(r)
    pval.append(p)

rho = np.array(rho)
pval = np.array(pval)

# q-values BH
m = len(pval)
order = np.argsort(pval)
rank = np.empty(m, int)
rank[order] = np.arange(1, m+1)
q = pval * m / rank
q = np.minimum.accumulate(q[order][::-1])[::-1]
q_corrected = np.empty_like(q)
q_corrected[order] = q

print('min rho', rho.min(), 'max rho', rho.max())
print('most negative gene', common_genes[rho.argmin()])

# Q2: skewness of all expression values
all_expr_vals = expr.values.flatten()
print('skewness', skew(all_expr_vals, nan_policy='omit'))

# Q3: number with rho >= 0.6
strong_pos = (rho >= 0.6).sum()
print('strong positive >=0.6', strong_pos)

# Q4: percent significant q<0.05
sig = (q_corrected < 0.05).sum()
print('significant genes', sig, 'percentage', sig/m*100)

