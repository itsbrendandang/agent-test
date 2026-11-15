
# %% cell 0
import os
import pandas as pd

print(os.environ['DATA_DIR'])

path = os.path.join(os.environ['DATA_DIR'], 'MeRIP_RNA_result.xlsx')
df = pd.read_excel(path)
print(df.columns)
print(df.head())
print(df['m6A'].value_counts(dropna=False))
print(df['DEG'].value_counts(dropna=False))

# %% cell 1
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'], 'MeRIP_RNA_result.xlsx')
df = pd.read_excel(path)

# q1: percent of hypermethylated genes with Up
hyper = df[df['m6A'] == 'm6A Hyper']
up_hyper = hyper[hyper['DEG'] == 'Up']
perc_hyper_up = len(up_hyper) / len(hyper) * 100
print('hyper total', len(hyper), 'hyper&Up', len(up_hyper), 'percent', perc_hyper_up)

# contingency table for m6A vs DEG
ct = pd.crosstab(df['m6A'], df['DEG'])
print(ct)

from scipy.stats import chi2_contingency
chi2, p, dof, exp = chi2_contingency(ct)
print('chi2', chi2, 'p', p, 'dof', dof)

# ratio hyper to hypo among differentially methylated (Hyper or Hypo)
dm = df[df['m6A'].isin(['m6A Hyper','m6A Hypo'])]
ratio_hyper_hypo = (dm['m6A'] == 'm6A Hyper').sum() / (dm['m6A'] == 'm6A Hypo').sum()
print('dm total', len(dm), 'hyper', (dm['m6A'] == 'm6A Hyper').sum(), 'hypo', (dm['m6A'] == 'm6A Hypo').sum(), 'ratio', ratio_hyper_hypo)

# q6 hyper count
print('hyper count', (df['m6A'] == 'm6A Hyper').sum())

# q7 hyper & up count
print('hyper & up count', len(up_hyper))
