
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

ct = pd.crosstab(df['m6A'], df['DEG'])
print(ct)

# q1: percent of hypermethylated genes with Up
hyper = df[df['m6A']=='m6A Hyper']
prop_up = (hyper['DEG']=='Up').mean()*100
print('q1 percent:', prop_up)

# chi-square test
import scipy.stats as stats
chi2, p, dof, exp = stats.chi2_contingency(ct)
print('chi2:', chi2, 'p:', p, 'dof:', dof)

# q3 ratio hyper:hypo among DM genes (Hyper or Hypo)
dm = df[df['m6A'].isin(['m6A Hyper','m6A Hypo'])]
ratio = (dm['m6A']=='m6A Hyper').sum() / (dm['m6A']=='m6A Hypo').sum()
print('ratio hyper/hypo:', ratio)

# q6 number hypermethylated
a_hyper = (df['m6A']=='m6A Hyper').sum()
print('n hyper:', a_hyper)

# q7 number hyper + Up
n_hyper_up = ((df['m6A']=='m6A Hyper') & (df['DEG']=='Up')).sum()
print('n hyper & Up:', n_hyper_up)
