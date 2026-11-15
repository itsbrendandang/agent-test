
# %% cell 0
import os, pandas as pd
print(os.listdir(os.environ['DATA_DIR']))

# %% cell 1
import os, pandas as pd
DATA_DIR = os.environ['DATA_DIR']
counts = pd.read_csv(os.path.join(DATA_DIR,'Issy_ASXL1_fibro_featureCounts_GeneTable_final.txt'), sep='\t')
print(counts.head())
print(counts.columns[:10])
coldata = pd.read_excel(os.path.join(DATA_DIR,'Issy_ASXL1_fibro_coldata_gender.xlsx'))
print(coldata.head())

# %% cell 2
import os, pandas as pd
from io import StringIO
DATA_DIR = os.environ['DATA_DIR']
raw = open(os.path.join(DATA_DIR,'Issy_ASXL1_fibro_featureCounts_GeneTable_final.txt')).read().splitlines()
header = raw[0]
print(header)
parts = header.split()[:]
print(len(parts), parts[:20])

# %% cell 3
import os, pandas as pd
DATA_DIR = os.environ['DATA_DIR']
counts = pd.read_csv(os.path.join(DATA_DIR,'Issy_ASXL1_fibro_featureCounts_GeneTable_final.txt'), sep='\s+')
print(counts.shape)
print(counts.head())
coldata = pd.read_excel(os.path.join(DATA_DIR,'Issy_ASXL1_fibro_coldata_gender.xlsx'))
print(coldata)


# %% cell 4
import os, pandas as pd, numpy as np
import statsmodels.api as sm
DATA_DIR = os.environ['DATA_DIR']
counts = pd.read_csv(os.path.join(DATA_DIR,'Issy_ASXL1_fibro_featureCounts_GeneTable_final.txt'), sep='\s+')
coldata = pd.read_excel(os.path.join(DATA_DIR,'Issy_ASXL1_fibro_coldata_gender.xlsx'))

samples = coldata['sample'].tolist()
Y = counts[samples].T
Y.index = samples

X = pd.get_dummies(coldata[['condition','sex']], drop_first=True)
X = sm.add_constant(X)

from statsmodels.genmod.generalized_linear_model import GLM
from statsmodels.genmod.families import NegativeBinomial

pvals = []
for i, gene in enumerate(counts['Geneid']):
    y = Y.iloc[:, i].values
    if y.sum() == 0:
        pvals.append(np.nan)
        continue
    try:
        model = GLM(y, X.values, family=NegativeBinomial())
        res = model.fit(maxiter=50, disp=0)
        p = res.pvalues[1]
    except Exception as e:
        p = np.nan
    pvals.append(p)
    if i%5000==0:
        print(i)

res_df = pd.DataFrame({'Geneid': counts['Geneid'], 'p_condition': pvals})
res_df.to_csv('de_nb_results.csv', index=False)
print(res_df.head())

# %% cell 5
import os, pandas as pd, numpy as np
from statsmodels.stats.multitest import multipletests
DATA_DIR = os.environ['DATA_DIR']
counts = pd.read_csv(os.path.join(DATA_DIR,'Issy_ASXL1_fibro_featureCounts_GeneTable_final.txt'), sep='\s+')
res_df = pd.read_csv('de_nb_results.csv')

# multiple testing
mask = res_df['p_condition'].notna()
res_df.loc[mask, 'padj'] = multipletests(res_df.loc[mask,'p_condition'], method='fdr_bh')[1]

# log2FC disease vs control
coldata = pd.read_excel(os.path.join(DATA_DIR,'Issy_ASXL1_fibro_coldata_gender.xlsx'))
conds = dict(zip(coldata['sample'], coldata['condition']))

diseases = [s for s,c in conds.items() if c=='disease']
controls = [s for s,c in conds.items() if c=='control']

import numpy as np
counts_mat = counts.set_index('Geneid')
fc = (counts_mat[diseases].mean(axis=1)+1)/(counts_mat[controls].mean(axis=1)+1)
res_df['log2FC_disease_vs_control'] = np.log2(fc.values)

res_df.to_csv('de_nb_results_annot.csv', index=False)
print(res_df.sort_values('padj').head())

# %% cell 6
import pandas as pd, os
DATA_DIR = os.environ['DATA_DIR']
res = pd.read_csv('de_nb_results.csv')
print(res['p_condition'].describe())
print(res['p_condition'].notna().sum())

# %% cell 7
import os, pandas as pd, numpy as np
from scipy import stats
DATA_DIR = os.environ['DATA_DIR']
counts = pd.read_csv(os.path.join(DATA_DIR,'Issy_ASXL1_fibro_featureCounts_GeneTable_final.txt'), sep='\s+')
coldata = pd.read_excel(os.path.join(DATA_DIR,'Issy_ASXL1_fibro_coldata_gender.xlsx'))

samples = coldata['sample'].tolist()
mat = counts.set_index('Geneid')[samples]
conds = dict(zip(coldata['sample'], coldata['condition']))

diseases = [s for s,c in conds.items() if c=='disease']
controls = [s for s,c in conds.items() if c=='control']

pvals = []
log2fc = []
for gene, row in mat.iterrows():
    d = row[diseases]
    c = row[controls]
    if d.sum()+c.sum()==0:
        pvals.append(np.nan)
        log2fc.append(0)
        continue
    stat,p = stats.mannwhitneyu(d, c, alternative='two-sided')
    pvals.append(p)
    fc = (d.mean()+1)/(c.mean()+1)
    log2fc.append(np.log2(fc))

res = pd.DataFrame({'Geneid': mat.index, 'p_mwu': pvals, 'log2FC': log2fc})
from statsmodels.stats.multitest import multipletests
mask = res['p_mwu'].notna()
res.loc[mask,'padj'] = multipletests(res.loc[mask,'p_mwu'], method='fdr_bh')[1]
res.to_csv('de_mwu_results.csv', index=False)
print(res.sort_values('padj').head())

# %% cell 8
import pandas as pd, os
DATA_DIR = os.environ['DATA_DIR']
res = pd.read_csv('de_mwu_results.csv')
print((res['padj']<0.05).sum())
print(res['padj'].min())
