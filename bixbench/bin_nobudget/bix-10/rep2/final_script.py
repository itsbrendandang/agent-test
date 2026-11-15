
# %% cell 0
import os, pandas as pd
DATA_DIR = os.environ['DATA_DIR']

ae = pd.read_csv(os.path.join(DATA_DIR, 'TASK008_BCG-CORONA_AE.csv'))
dm = pd.read_csv(os.path.join(DATA_DIR, 'TASK008_BCG-CORONA_DM.csv'))
ex = pd.read_csv(os.path.join(DATA_DIR, 'TASK008_BCG-CORONA_EX.csv'))

print(ae.columns)
print(dm.columns)
print(ex.columns)

print(ae['AESEV'].value_counts(dropna=False))
print(ex['TRTGRP'].value_counts(dropna=False))

# %% cell 1
import os, pandas as pd
DATA_DIR = os.environ['DATA_DIR']

ae = pd.read_csv(os.path.join(DATA_DIR, 'TASK008_BCG-CORONA_AE.csv'), encoding='latin1')
dm = pd.read_csv(os.path.join(DATA_DIR, 'TASK008_BCG-CORONA_DM.csv'), encoding='latin1')
ex = pd.read_csv(os.path.join(DATA_DIR, 'TASK008_BCG-CORONA_EX.csv'), encoding='latin1')

print(ae.columns)
print(dm.columns)
print(ex.columns)
print('\nAESEV counts:')
print(ae['AESEV'].value_counts(dropna=False))

# %% cell 2
import pandas as pd, os
DATA_DIR = os.environ['DATA_DIR']

ae = pd.read_csv(os.path.join(DATA_DIR, 'TASK008_BCG-CORONA_AE.csv'), encoding='latin1')
dm = pd.read_csv(os.path.join(DATA_DIR, 'TASK008_BCG-CORONA_DM.csv'), encoding='latin1')

# derive COVID AE subset: assume AECAT or AEPT related? inspect
print(ae['AECAT'].value_counts().head())
print(ae['AEPT'].value_counts().head())

# %% cell 3
import pandas as pd, os
DATA_DIR = os.environ['DATA_DIR']

ae = pd.read_csv(os.path.join(DATA_DIR, 'TASK008_BCG-CORONA_AE.csv'), encoding='latin1')
dm = pd.read_csv(os.path.join(DATA_DIR, 'TASK008_BCG-CORONA_DM.csv'), encoding='latin1')

covid = ae[ae['AEPT']=='COVID-19'].copy()
print(covid.shape)
print(covid[['USUBJID','AESEV']].head())

# merge with dm
covid_dm = covid.merge(dm[['USUBJID','TRTGRP','patients_seen','expect_interact']], on='USUBJID', how='left')
print(covid_dm.head())
print(covid_dm['expect_interact'].value_counts(dropna=False))
print(covid_dm['patients_seen'].describe())

# %% cell 4
import pandas as pd, os, numpy as np
from statsmodels.miscmodels.ordinal_model import OrderedModel
from scipy.stats import chi2_contingency

DATA_DIR = os.environ['DATA_DIR']

ae = pd.read_csv(os.path.join(DATA_DIR, 'TASK008_BCG-CORONA_AE.csv'), encoding='latin1')
dm = pd.read_csv(os.path.join(DATA_DIR, 'TASK008_BCG-CORONA_DM.csv'), encoding='latin1')

covid = ae[ae['AEPT']=='COVID-19'].copy()
# keep one record per subject: worst severity
covid = covid.sort_values(['USUBJID','AESEV'])
# higher AESEV worse; get max per subject
covid_sev = covid.groupby('USUBJID', as_index=False)['AESEV'].max()

covid_dm = covid_sev.merge(dm[['USUBJID','TRTGRP','patients_seen','expect_interact']], on='USUBJID', how='left')

# drop missing severity
covid_dm = covid_dm.dropna(subset=['AESEV'])

# create categorical encodings
covid_dm['TRTGRP_cat'] = covid_dm['TRTGRP'].map({'BCG':1,'Placebo':0})

# ensure ordered severity
covid_dm = covid_dm[covid_dm['AESEV'].between(1,4)]
severity = covid_dm['AESEV'].astype(int)

# patients_seen_cat: order 0,1-50,51-100,>100 or similar from data
print(covid_dm['patients_seen'].value_counts())

# create ordered category
order = ['0','1-50','51-100','>100']
cat_type = pd.CategoricalDtype(categories=order, ordered=True)
covid_dm['patients_seen_cat'] = covid_dm['patients_seen'].astype(str).replace({'0.0':'0'}).astype('category').cat.set_categories(order, ordered=True)

covid_dm['expect_interact_cat'] = covid_dm['expect_interact'].map({'Yes':1,'No':0})

print(covid_dm[['AESEV','TRTGRP_cat','patients_seen_cat','expect_interact_cat']].head())
print(covid_dm['patients_seen_cat'].value_counts())

# %% cell 5
import pandas as pd, os
from statsmodels.miscmodels.ordinal_model import OrderedModel

DATA_DIR = os.environ['DATA_DIR']

ae = pd.read_csv(os.path.join(DATA_DIR, 'TASK008_BCG-CORONA_AE.csv'), encoding='latin1')
dm = pd.read_csv(os.path.join(DATA_DIR, 'TASK008_BCG-CORONA_DM.csv'), encoding='latin1')

covid = ae[ae['AEPT']=='COVID-19'].copy()
covid = covid.groupby('USUBJID', as_index=False)['AESEV'].max()

covid_dm = covid.merge(dm[['USUBJID','TRTGRP','patients_seen','expect_interact']], on='USUBJID', how='left')

covid_dm = covid_dm.dropna(subset=['AESEV'])

# encode
covid_dm['TRTGRP_cat'] = covid_dm['TRTGRP'].map({'BCG':1,'Placebo':0})

# ordered patients_seen
order = ['1-50','51-100','>100']
cat_type = pd.CategoricalDtype(categories=order, ordered=True)
covid_dm['patients_seen_cat'] = covid_dm['patients_seen'].astype('category').cat.set_categories(order, ordered=True)

covid_dm['expect_interact_cat'] = covid_dm['expect_interact'].map({'Yes':1,'No':0})

covid_dm = covid_dm.dropna(subset=['TRTGRP_cat','patients_seen_cat','expect_interact_cat'])

covid_dm['AESEV_int'] = covid_dm['AESEV'].astype(int)

print(covid_dm[['AESEV_int','TRTGRP_cat','patients_seen_cat','expect_interact_cat']].head())
print(covid_dm['patients_seen_cat'].value_counts())

# design matrix
X = pd.get_dummies(covid_dm[['TRTGRP_cat','patients_seen_cat','expect_interact_cat']], drop_first=False)
print(X.head())

mod = OrderedModel(covid_dm['AESEV_int'], X, distr='logit')
res = mod.fit(method='bfgs', disp=False)
print(res.summary())

import numpy as np
params = res.params
or_bcg = np.exp(params['TRTGRP_cat']) if 'TRTGRP_cat' in params else None
print('OR TRTGRP_cat:', or_bcg)

or_expect = np.exp(params['expect_interact_cat']) if 'expect_interact_cat' in params else None
print('OR expect_interact_cat:', or_expect)

# %% cell 6
import pandas as pd, os, numpy as np
from statsmodels.miscmodels.ordinal_model import OrderedModel
from scipy.stats import chi2_contingency

DATA_DIR = os.environ['DATA_DIR']

ae = pd.read_csv(os.path.join(DATA_DIR, 'TASK008_BCG-CORONA_AE.csv'), encoding='latin1')
dm = pd.read_csv(os.path.join(DATA_DIR, 'TASK008_BCG-CORONA_DM.csv'), encoding='latin1')

covid = ae[ae['AEPT']=='COVID-19'].copy()
covid = covid.groupby('USUBJID', as_index=False)['AESEV'].max()

covid_dm = covid.merge(dm[['USUBJID','TRTGRP','patients_seen','expect_interact']], on='USUBJID', how='left')

covid_dm = covid_dm.dropna(subset=['AESEV'])

covid_dm['TRTGRP_cat'] = covid_dm['TRTGRP'].map({'BCG':1,'Placebo':0})
order = ['1-50','51-100','>100']
cat_type = pd.CategoricalDtype(categories=order, ordered=True)
covid_dm['patients_seen_cat'] = covid_dm['patients_seen'].astype('category').cat.set_categories(order, ordered=True)

covid_dm['expect_interact_cat'] = covid_dm['expect_interact'].map({'Yes':1,'No':0})

covid_dm = covid_dm.dropna(subset=['TRTGRP_cat','patients_seen_cat','expect_interact_cat'])

covid_dm['AESEV_int'] = covid_dm['AESEV'].astype(int)

X = pd.get_dummies(covid_dm[['TRTGRP_cat','patients_seen_cat','expect_interact_cat']], drop_first=True)
print(X.head())

mod = OrderedModel(covid_dm['AESEV_int'], X, distr='logit')
res = mod.fit(method='bfgs', disp=False)
print(res.summary())
params = res.params
print(params)

or_bcg = np.exp(params['TRTGRP_cat'])
ci_bcg = np.exp(params['TRTGRP_cat'] + np.array([-1,1])*1.96*res.bse['TRTGRP_cat'])
print('OR TRTGRP_cat:', or_bcg, 'CI:', ci_bcg)

or_expect = np.exp(params['expect_interact_cat'])
ci_expect = np.exp(params['expect_interact_cat'] + np.array([-1,1])*1.96*res.bse['expect_interact_cat'])
print('OR expect_interact_cat:', or_expect, 'CI:', ci_expect)

# chi-square by patient volume per q3
results_q3 = {}
for grp in order:
    sub = covid_dm[covid_dm['patients_seen_cat']==grp]
    if sub.empty: continue
    tab = pd.crosstab(sub['TRTGRP'], sub['AESEV_int'])
    if tab.shape[0]==2 and tab.shape[1]>1:
        chi2,p,df,exp = chi2_contingency(tab)
        results_q3[grp] = (p, tab)

print('Q3 chi-square by volume:')
for k,(p,tab) in results_q3.items():
    print(k, 'p=',p)
    print(tab)

# q4: chi-square among expect_interact Yes
sub4 = covid_dm[covid_dm['expect_interact_cat']==1]
cont4 = pd.crosstab(sub4['TRTGRP'], sub4['AESEV_int'])
chi2_4,p4,df4,exp4 = chi2_contingency(cont4)
print('Q4 p:', p4)

# q5: >100 patients
sub5 = covid_dm[covid_dm['patients_seen_cat']=='>100']
cont5 = pd.crosstab(sub5['TRTGRP'], sub5['AESEV_int'])
chi2_5,p5,df5,exp5 = chi2_contingency(cont5)
print('Q5 p:', p5)

# q6: 1-50
sub6 = covid_dm[covid_dm['patients_seen_cat']=='1-50']
cont6 = pd.crosstab(sub6['TRTGRP'], sub6['AESEV_int'])
chi2_6,p6,df6,exp6 = chi2_contingency(cont6)
print('Q6 p:', p6)

# q7 percent reduction in OR for expect_interact=1 vs 0
# in model, expect_interact_cat coded 1 vs 0. OR<1 indicates reduction.
or_expect = np.exp(params['expect_interact_cat'])
reduction = (1-or_expect)*100
print('Q7 reduction %:', reduction)

