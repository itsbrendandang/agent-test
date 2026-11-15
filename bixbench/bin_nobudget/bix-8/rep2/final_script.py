
# %% cell 0
import os
import pandas as pd

print(os.environ['DATA_DIR'])

merip_path = os.path.join(os.environ['DATA_DIR'], 'MeRIP_RNA_result.xlsx')

xl = pd.ExcelFile(merip_path)
print(xl.sheet_names)

df = xl.parse(xl.sheet_names[0])
print(df.columns)
print(df.head())
print(df['m6A'].value_counts(dropna=False))
print(df['DEG'].value_counts(dropna=False))

# %% cell 1
import os, pandas as pd
merip_path = os.path.join(os.environ['DATA_DIR'], 'MeRIP_RNA_result.xlsx')
df = pd.read_excel(merip_path, sheet_name=0)

ct = pd.crosstab(df['m6A'], df['DEG'])
print(ct)

hyper = df[df['m6A']=='m6A Hyper']
prop_up = (hyper['DEG']=='Up').mean()*100
print('percent hyper with Up:', prop_up)

from scipy.stats import chi2_contingency
chi2, p, dof, exp = chi2_contingency(ct)
print('chi2:', chi2, 'p:', p, 'dof:', dof)

hyper_count = (df['m6A']=='m6A Hyper').sum()
hyper_up_count = ((df['m6A']=='m6A Hyper') & (df['DEG']=='Up')).sum()

ratio_hyper_hypo = (df['m6A']=='m6A Hyper').sum() / (df['m6A']=='m6A Hypo').sum()
print('ratio hyper:hypo:', ratio_hyper_hypo)
print('hyper_count:', hyper_count)
print('hyper_up_count:', hyper_up_count)
