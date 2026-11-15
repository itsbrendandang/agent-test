
# %% cell 0
import os, pandas as pd
from pathlib import Path

data_dir = os.environ['DATA_DIR']
print(data_dir)

ae = pd.read_csv(Path(data_dir)/'TASK008_BCG-CORONA_AE.csv')
dm = pd.read_csv(Path(data_dir)/'TASK008_BCG-CORONA_DM.csv')
ex = pd.read_csv(Path(data_dir)/'TASK008_BCG-CORONA_EX.csv')

print(ae.columns)
print(dm.columns)
print(ex.columns)

print(ae['AESEV'].value_counts(dropna=False))
print(ex['TRTGRP'].value_counts(dropna=False))

# %% cell 1
import os, pandas as pd
from pathlib import Path

data_dir = os.environ['DATA_DIR']

ae = pd.read_csv(Path(data_dir)/'TASK008_BCG-CORONA_AE.csv', encoding_errors='ignore')
dm = pd.read_csv(Path(data_dir)/'TASK008_BCG-CORONA_DM.csv', encoding_errors='ignore')
ex = pd.read_csv(Path(data_dir)/'TASK008_BCG-CORONA_EX.csv', encoding_errors='ignore')

print(ae.columns)
print(dm.columns)
print(ex.columns)

print(ae['AESEV'].value_counts(dropna=False))
print(ex['TRTGRP'].value_counts(dropna=False))

# %% cell 2
import pandas as pd, os
from pathlib import Path

data_dir = os.environ['DATA_DIR']

ae = pd.read_csv(Path(data_dir)/'TASK008_BCG-CORONA_AE.csv', encoding_errors='ignore')
dm = pd.read_csv(Path(data_dir)/'TASK008_BCG-CORONA_DM.csv', encoding_errors='ignore')

# derive categories

dm['patients_seen_cat'] = pd.cut(dm['patients_seen'], bins=[-1,0,50,100,1e9], labels=['0','1-50','51-100','>100'])
dm['expect_interact_cat'] = dm['expect_interact'].map({0:'No',1:'Yes'})
dm['TRTGRP_cat'] = dm['TRTGRP']

# COVID AE subset: AECAT maybe 'COVID-19' or similar
print(ae['AECAT'].value_counts().head())

covid = ae[ae['AECAT'].str.contains('COVID', case=False, na=False)].copy()
print(covid['AESEV'].value_counts(dropna=False))

# merge with dm
covid_dm = covid.merge(dm[['USUBJID','TRTGRP_cat','patients_seen_cat','expect_interact_cat']], on='USUBJID', how='left')
print(covid_dm[['AESEV','TRTGRP_cat','patients_seen_cat','expect_interact_cat']].head())
print(covid_dm.shape)

# ordinal logistic regression
from statsmodels.miscmodels.ordinal_model import OrderedModel

covid_dm2 = covid_dm.dropna(subset=['AESEV','TRTGRP_cat','patients_seen_cat','expect_interact_cat']).copy()

# encode severity as ordered
covid_dm2['AESEV_ord'] = covid_dm2['AESEV'].astype(int)

# treatment indicator
covid_dm2['TRT_BCG'] = (covid_dm2['TRTGRP_cat']=='BCG').astype(int)

# create dummies for patients_seen_cat and expect_interact_cat
X = pd.get_dummies(covid_dm2[['TRT_BCG','patients_seen_cat','expect_interact_cat']], drop_first=True)

mod = OrderedModel(covid_dm2['AESEV_ord'], X, distr='logit')
res = mod.fit(method='bfgs', disp=False)
print(res.summary())

import numpy as np
or_bcg = np.exp(res.params['TRT_BCG'])
print('OR BCG:', or_bcg)

or_expect = {k:np.exp(v) for k,v in res.params.items() if k.startswith('expect_interact_cat')}
print('OR expect:', or_expect)


# %% cell 3
import pandas as pd, os
from pathlib import Path

data_dir = os.environ['DATA_DIR']

ae = pd.read_csv(Path(data_dir)/'TASK008_BCG-CORONA_AE.csv', encoding_errors='ignore')
dm = pd.read_csv(Path(data_dir)/'TASK008_BCG-CORONA_DM.csv', encoding_errors='ignore')

print(dm[['patients_seen','expect_interact']].head(20))
print(dm['patients_seen'].unique()[:20])

# coerce patients_seen numeric
dm['patients_seen_num'] = pd.to_numeric(dm['patients_seen'], errors='coerce')
print(dm['patients_seen_num'].describe())

dm['patients_seen_cat'] = pd.cut(dm['patients_seen_num'], bins=[-1,0,50,100,1e9], labels=['0','1-50','51-100','>100'])
dm['expect_interact_cat'] = dm['expect_interact'].map({0:'No',1:'Yes'})
dm['TRTGRP_cat'] = dm['TRTGRP']

covid = ae[ae['AECAT'].str.contains('COVID', case=False, na=False)].copy()

covid_dm = covid.merge(dm[['USUBJID','TRTGRP_cat','patients_seen_cat','expect_interact_cat']], on='USUBJID', how='left')
print(covid_dm[['AESEV','TRTGRP_cat','patients_seen_cat','expect_interact_cat']].head())
print(covid_dm.shape)

from statsmodels.miscmodels.ordinal_model import OrderedModel
import numpy as np

covid_dm2 = covid_dm.dropna(subset=['AESEV','TRTGRP_cat','patients_seen_cat','expect_interact_cat']).copy()

covid_dm2['AESEV_ord'] = covid_dm2['AESEV'].astype(int)

covid_dm2['TRT_BCG'] = (covid_dm2['TRTGRP_cat']=='BCG').astype(int)

X = pd.get_dummies(covid_dm2[['TRT_BCG','patients_seen_cat','expect_interact_cat']], drop_first=True)

mod = OrderedModel(covid_dm2['AESEV_ord'], X, distr='logit')
res = mod.fit(method='bfgs', disp=False)
print(res.summary())

or_bcg = float(np.exp(res.params['TRT_BCG']))
print('OR BCG:', or_bcg)

or_expect = {k:float(np.exp(v)) for k,v in res.params.items() if k.startswith('expect_interact_cat')}
print('OR expect:', or_expect)


# %% cell 4
import pandas as pd, os
from pathlib import Path

data_dir = os.environ['DATA_DIR']

ae = pd.read_csv(Path(data_dir)/'TASK008_BCG-CORONA_AE.csv', encoding_errors='ignore')
dm = pd.read_csv(Path(data_dir)/'TASK008_BCG-CORONA_DM.csv', encoding_errors='ignore')

# define covid-related as AEPT contains COVID-19
aecovid = ae[ae['AEPT'].str.contains('COVID-19', case=False, na=False)].copy()
print('COVID AE rows:', aecovid.shape)
print(aecovid['AESEV'].value_counts(dropna=False))

# merge
dm_small = dm[['USUBJID','TRTGRP','patients_seen','expect_interact']].copy()

covid_dm = aecovid.merge(dm_small, on='USUBJID', how='left')
print(covid_dm.head())
print(covid_dm.shape)
print(covid_dm[['patients_seen','expect_interact']].drop_duplicates().head(20))

# AESEV seems 1-4 already. Build categories directly from strings.

covid_dm['patients_seen_cat'] = covid_dm['patients_seen']
covid_dm['expect_interact_cat'] = covid_dm['expect_interact']

# drop missing
covid_dm2 = covid_dm.dropna(subset=['AESEV','TRTGRP','patients_seen_cat','expect_interact_cat']).copy()

print('n for model:', covid_dm2.shape)

from statsmodels.miscmodels.ordinal_model import OrderedModel
import numpy as np

covid_dm2['AESEV_ord'] = covid_dm2['AESEV'].astype(int)

covid_dm2['TRT_BCG'] = (covid_dm2['TRTGRP']=='BCG').astype(int)

X = pd.get_dummies(covid_dm2[['TRT_BCG','patients_seen_cat','expect_interact_cat']], drop_first=True)

mod = OrderedModel(covid_dm2['AESEV_ord'], X, distr='logit')
res = mod.fit(method='bfgs', disp=False)
print(res.summary())

or_bcg = float(np.exp(res.params['TRT_BCG']))
print('OR BCG:', or_bcg)

or_expect = {k:float(np.exp(v)) for k,v in res.params.items() if k.startswith('expect_interact_cat')}
print('OR expect:', or_expect)


# %% cell 5
import pandas as pd, os
from pathlib import Path
from statsmodels.miscmodels.ordinal_model import OrderedModel
import numpy as np
from scipy.stats import chi2_contingency

data_dir = os.environ['DATA_DIR']

ae = pd.read_csv(Path(data_dir)/'TASK008_BCG-CORONA_AE.csv', encoding_errors='ignore')
dm = pd.read_csv(Path(data_dir)/'TASK008_BCG-CORONA_DM.csv', encoding_errors='ignore')

covid = ae[ae['AEPT'].str.contains('COVID-19', case=False, na=False)].copy()

covid_dm = covid.merge(dm[['USUBJID','TRTGRP','patients_seen','expect_interact']], on='USUBJID', how='left')

covid_dm['patients_seen_cat'] = covid_dm['patients_seen']
covid_dm['expect_interact_cat'] = covid_dm['expect_interact']

covid_dm2 = covid_dm.dropna(subset=['AESEV','TRTGRP','patients_seen_cat','expect_interact_cat']).copy()

covid_dm2['AESEV_ord'] = covid_dm2['AESEV'].astype(int)

covid_dm2['TRT_BCG'] = (covid_dm2['TRTGRP']=='BCG').astype(int)

X = pd.get_dummies(covid_dm2[['TRT_BCG','patients_seen_cat','expect_interact_cat']], drop_first=True)

mod = OrderedModel(covid_dm2['AESEV_ord'], X, distr='logit')
res = mod.fit(method='bfgs', disp=False)

or_bcg = float(np.exp(res.params['TRT_BCG']))

# effect of expect_interact Yes vs No
expect_param = [v for k,v in res.params.items() if 'expect_interact_cat_Yes' in k][0]
or_expect = float(np.exp(expect_param))

print('OR_BCG:', or_bcg)
print('OR_expect_Yes_vs_No:', or_expect)

# chi-square by patients_seen group for Q3,Q5,Q6

results = {}
for grp in sorted(covid_dm2['patients_seen_cat'].dropna().unique()):
    sub = covid_dm2[covid_dm2['patients_seen_cat']==grp]
    tbl = pd.crosstab(sub['TRTGRP'], sub['AESEV_ord'])
    if tbl.shape==(2,0) or tbl.size==0:
        continue
    chi2,p,df,exp = chi2_contingency(tbl)
    results[grp] = (p, tbl.shape, tbl.values.sum())

print('Chi-square by patients_seen:', results)

# Q4: among expect_interact Yes
sub_yes = covid_dm2[covid_dm2['expect_interact_cat']=='Yes']
chi2_yes,p_yes,df_yes,exp_yes = chi2_contingency(pd.crosstab(sub_yes['TRTGRP'], sub_yes['AESEV_ord']))
print('Q4 p:', p_yes)

# Q5: >100 patients
sub_gt100 = covid_dm2[covid_dm2['patients_seen_cat']=='>100']
chi2_5,p_5,df_5,exp_5 = chi2_contingency(pd.crosstab(sub_gt100['TRTGRP'], sub_gt100['AESEV_ord']))
print('Q5 p:', p_5)

# Q6: 1-50 patients
sub_1_50 = covid_dm2[covid_dm2['patients_seen_cat']=='1-50']
chi2_6,p_6,df_6,exp_6 = chi2_contingency(pd.crosstab(sub_1_50['TRTGRP'], sub_1_50['AESEV_ord']))
print('Q6 p:', p_6)



# %% cell 6
import pandas as pd, os
from pathlib import Path

data_dir = os.environ['DATA_DIR']

ae = pd.read_csv(Path(data_dir)/'TASK008_BCG-CORONA_AE.csv', encoding_errors='ignore')
dm = pd.read_csv(Path(data_dir)/'TASK008_BCG-CORONA_DM.csv', encoding_errors='ignore')

covid = ae[ae['AEPT'].str.contains('COVID-19', case=False, na=False)].copy()

print(covid.columns)
print(dm.columns)

covid_dm = covid.merge(dm, on='USUBJID', how='left', suffixes=('_ae','_dm'))
print(covid_dm.columns)
print(covid_dm[['TRTGRP_ae','TRTGRP_dm']].head())

covid_dm['TRTGRP'] = covid_dm['TRTGRP_ae'].combine_first(covid_dm['TRTGRP_dm'])

covid_dm['patients_seen_cat'] = covid_dm['patients_seen']
covid_dm['expect_interact_cat'] = covid_dm['expect_interact']

print(covid_dm[['AESEV','TRTGRP','patients_seen_cat','expect_interact_cat']].head())
print(covid_dm.shape)


# %% cell 7
import pandas as pd, os
from pathlib import Path
from statsmodels.miscmodels.ordinal_model import OrderedModel
import numpy as np
from scipy.stats import chi2_contingency

data_dir = os.environ['DATA_DIR']

ae = pd.read_csv(Path(data_dir)/'TASK008_BCG-CORONA_AE.csv', encoding_errors='ignore')
dm = pd.read_csv(Path(data_dir)/'TASK008_BCG-CORONA_DM.csv', encoding_errors='ignore')

covid = ae[ae['AEPT'].str.contains('COVID-19', case=False, na=False)].copy()

covid_dm = covid.merge(dm, on='USUBJID', how='left', suffixes=('_ae','_dm'))

covid_dm['TRTGRP'] = covid_dm['TRTGRP_ae'].combine_first(covid_dm['TRTGRP_dm'])

covid_dm['patients_seen_cat'] = covid_dm['patients_seen']
covid_dm['expect_interact_cat'] = covid_dm['expect_interact']

covid_dm2 = covid_dm.dropna(subset=['AESEV','TRTGRP','patients_seen_cat','expect_interact_cat']).copy()

print('N analytic:', covid_dm2.shape)
print(covid_dm2['patients_seen_cat'].value_counts())
print(covid_dm2['expect_interact_cat'].value_counts())

covid_dm2['AESEV_ord'] = covid_dm2['AESEV'].astype(int)

covid_dm2['TRT_BCG'] = (covid_dm2['TRTGRP']=='BCG').astype(int)

X = pd.get_dummies(covid_dm2[['TRT_BCG','patients_seen_cat','expect_interact_cat']], drop_first=True)

mod = OrderedModel(covid_dm2['AESEV_ord'], X, distr='logit')
res = mod.fit(method='bfgs', disp=False)
print(res.summary())

or_bcg = float(np.exp(res.params['TRT_BCG']))
print('OR_BCG:', or_bcg)

expect_param = [v for k,v in res.params.items() if 'expect_interact_cat_Yes' in k][0]
or_expect = float(np.exp(expect_param))
print('OR_expect_Yes_vs_No:', or_expect)

# Chi-square by patients_seen_cat
from collections import OrderedDict
chi_by_pat = OrderedDict()
for grp in sorted(covid_dm2['patients_seen_cat'].dropna().unique()):
    sub = covid_dm2[covid_dm2['patients_seen_cat']==grp]
    tbl = pd.crosstab(sub['TRTGRP'], sub['AESEV_ord'])
    chi2,p,df,exp = chi2_contingency(tbl)
    chi_by_pat[grp] = {'p':p, 'n':int(tbl.values.sum())}
print('chi_by_pat:', chi_by_pat)

# Q4: expect_interact Yes
sub_yes = covid_dm2[covid_dm2['expect_interact_cat']=='Yes']
chi2_yes,p_yes,df_yes,exp_yes = chi2_contingency(pd.crosstab(sub_yes['TRTGRP'], sub_yes['AESEV_ord']))
print('Q4 p:', p_yes)

# Q5: >100 patients
sub_gt100 = covid_dm2[covid_dm2['patients_seen_cat']=='>100']
chi2_5,p_5,df_5,exp_5 = chi2_contingency(pd.crosstab(sub_gt100['TRTGRP'], sub_gt100['AESEV_ord']))
print('Q5 p:', p_5)

# Q6: 1-50 patients
sub_1_50 = covid_dm2[covid_dm2['patients_seen_cat']=='1-50']
chi2_6,p_6,df_6,exp_6 = chi2_contingency(pd.crosstab(sub_1_50['TRTGRP'], sub_1_50['AESEV_ord']))
print('Q6 p:', p_6)


