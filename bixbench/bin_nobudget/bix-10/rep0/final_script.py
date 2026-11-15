
# %% cell 0
import os, pandas as pd
from pathlib import Path

DATA_DIR = os.environ['DATA_DIR']

ae = pd.read_csv(Path(DATA_DIR)/'TASK008_BCG-CORONA_AE.csv')
dm = pd.read_csv(Path(DATA_DIR)/'TASK008_BCG-CORONA_DM.csv')
ex = pd.read_csv(Path(DATA_DIR)/'TASK008_BCG-CORONA_EX.csv')

print(ae.columns)
print(dm.columns)
print(ex.columns)

print(ae['AESEV'].value_counts(dropna=False))
print(dm['TRTGRP_cat'].value_counts(dropna=False))
print(dm[['expect_interact_cat','patients_seen_cat']].apply(lambda c: c.value_counts(dropna=False)))

# %% cell 1
import os, pandas as pd
from pathlib import Path

DATA_DIR = os.environ['DATA_DIR']

ae = pd.read_csv(Path(DATA_DIR)/'TASK008_BCG-CORONA_AE.csv')
dm = pd.read_csv(Path(DATA_DIR)/'TASK008_BCG-CORONA_DM.csv')
ex = pd.read_csv(Path(DATA_DIR)/'TASK008_BCG-CORONA_EX.csv', encoding='latin1')

print(ae['AESEV'].value_counts(dropna=False))
print(dm[['TRTGRP_cat','expect_interact_cat','patients_seen_cat']].head())

# %% cell 2
import os, pandas as pd
from pathlib import Path

DATA_DIR = os.environ['DATA_DIR']

ae = pd.read_csv(Path(DATA_DIR)/'TASK008_BCG-CORONA_AE.csv')
dm = pd.read_csv(Path(DATA_DIR)/'TASK008_BCG-CORONA_DM.csv')
ex = pd.read_csv(Path(DATA_DIR)/'TASK008_BCG-CORONA_EX.csv', encoding='latin1')

print(dm.columns)
print(dm.head())

# %% cell 3
import os, pandas as pd
from pathlib import Path
import numpy as np
from statsmodels.miscmodels.ordinal_model import OrderedModel

DATA_DIR = os.environ['DATA_DIR']

ae = pd.read_csv(Path(DATA_DIR)/'TASK008_BCG-CORONA_AE.csv')
dm = pd.read_csv(Path(DATA_DIR)/'TASK008_BCG-CORONA_DM.csv')

# merge
ad = ae.merge(dm[['USUBJID','TRTGRP','patients_seen','expect_interact']], on='USUBJID', how='inner')

# restrict to COVID AEs? assume AESOC or AETERM; inspect
print(ae.columns)
print(ae[['USUBJID','AESEV','AETERM']].head())
print(ae['AETERM'].value_counts().head())

# %% cell 4
import os, pandas as pd
from pathlib import Path
import numpy as np
from statsmodels.miscmodels.ordinal_model import OrderedModel
from scipy.stats import chi2_contingency

DATA_DIR = os.environ['DATA_DIR']

ae = pd.read_csv(Path(DATA_DIR)/'TASK008_BCG-CORONA_AE.csv')
dm = pd.read_csv(Path(DATA_DIR)/'TASK008_BCG-CORONA_DM.csv')

# define COVID severity as highest AESEV per subject (assuming AEHS indicates COVID AE); inspect AESOC
print(ae['AESOC'].value_counts().head())

# Assume AEHS is COVID health status score; use AESEV where AEHS not null?
print(ae[['AESEV','AEHS']].head())

# For simplicity per protocol: use maximum AESEV per subject regardless of SOC
sever = ae.groupby('USUBJID')['AESEV'].max().reset_index()
sever = sever.dropna()

ad = sever.merge(dm[['USUBJID','TRTGRP','patients_seen','expect_interact']], on='USUBJID', how='inner')

# recode
ad = ad.dropna(subset=['AESEV','TRTGRP','patients_seen','expect_interact'])

ad['AESEV_ord'] = ad['AESEV'].astype(int)

ad['TRTGRP_cat'] = ad['TRTGRP'].map({'Placebo':0,'BCG':1})

ad['expect_interact_cat'] = ad['expect_interact'].map({'No':0,'Yes':1})

# order patients_seen
print(ad['patients_seen'].value_counts())
cat_type = pd.CategoricalDtype(['0','1-50','51-100','>100'], ordered=True)
ad['patients_seen_cat'] = ad['patients_seen'].astype(str).str.strip()
ad['patients_seen_cat'] = ad['patients_seen_cat'].astype(cat_type)

print(ad.head())
print(ad[['AESEV_ord','TRTGRP_cat','expect_interact_cat','patients_seen_cat']].describe(include='all') )

# Q1 & Q2 & Q7: ordinal logistic regression AESEV~TRTGRP+expect_interact+patients_seen

# make design matrix with dummy for patients_seen
X = pd.get_dummies(ad[['TRTGRP_cat','expect_interact_cat','patients_seen_cat']], drop_first=True)

model = OrderedModel(ad['AESEV_ord'], X, distr='logit')
res = model.fit(method='bfgs', disp=False)
print(res.summary())

params = res.params
or_trt = np.exp(params['TRTGRP_cat'])
or_expect = np.exp(params['expect_interact_cat'])
print('OR TRTGRP (BCG vs Placebo):', or_trt)
print('OR expect_interact (Yes vs No):', or_expect)

# Q7 percentage reduction in odds for expect_interact=Yes vs No
perc_red = (1-or_expect)*100
print('Percent reduction:', perc_red)

# Q3-Q6: chi-square tests

# function for chi-square within subgroup

def chi_sq(data):
    tab = pd.crosstab(data['TRTGRP_cat'], data['AESEV_ord'])
    chi2, p, dof, exp = chi2_contingency(tab)
    return p, tab

# Q3: by patients_seen_cat
pvals = {}
for lvl in cat_type.categories:
    sub = ad[ad['patients_seen_cat']==lvl]
    if sub['TRTGRP_cat'].nunique()==2 and sub['AESEV_ord'].nunique()>1:
        p, tab = chi_sq(sub)
        pvals[lvl]=p
        print('\nPatients_seen', lvl)
        print(tab)
        print('p=',p)

print('pvals by patients_seen_cat:', pvals)

# Q4: expect_interact==Yes
sub = ad[ad['expect_interact_cat']==1]
px, tabx = chi_sq(sub)
print('\nExpect interact=Yes crosstab')
print(tabx)
print('p=',px)

# Q5: patients_seen>100
sub5 = ad[ad['patients_seen_cat']=='>100']
p5, tab5 = chi_sq(sub5)
print('\n>100 patients crosstab')
print(tab5)
print('p=',p5)

# Q6: patients_seen 1-50
sub6 = ad[ad['patients_seen_cat']=='1-50']
p6, tab6 = chi_sq(sub6)
print('\n1-50 patients crosstab')
print(tab6)
print('p=',p6)


# %% cell 5
import os, pandas as pd
from pathlib import Path
import numpy as np
from statsmodels.miscmodels.ordinal_model import OrderedModel
from scipy.stats import chi2_contingency

DATA_DIR = os.environ['DATA_DIR']

ae = pd.read_csv(Path(DATA_DIR)/'TASK008_BCG-CORONA_AE.csv')
dm = pd.read_csv(Path(DATA_DIR)/'TASK008_BCG-CORONA_DM.csv')

sever = ae.groupby('USUBJID')['AESEV'].max().reset_index().dropna()

ad = sever.merge(dm[['USUBJID','TRTGRP','patients_seen','expect_interact']], on='USUBJID', how='inner')

ad = ad.dropna(subset=['AESEV','TRTGRP','patients_seen','expect_interact'])

ad['AESEV_ord'] = ad['AESEV'].astype(int)

ad['TRTGRP_cat'] = ad['TRTGRP'].map({'Placebo':0,'BCG':1})

ad['expect_interact_cat'] = ad['expect_interact'].map({'No':0,'Yes':1})

cat_type = pd.CategoricalDtype(['0','1-50','51-100','>100'], ordered=True)
ad['patients_seen_cat'] = ad['patients_seen'].astype(str).str.strip().astype(cat_type)

X = pd.get_dummies(ad[['TRTGRP_cat','expect_interact_cat','patients_seen_cat']], drop_first=True)

print(X.head())

model = OrderedModel(ad['AESEV_ord'], X, distr='logit')
res = model.fit(method='bfgs', disp=False)
print(res.summary())

params = res.params
or_trt = np.exp(params['TRTGRP_cat'])
or_expect = np.exp(params['expect_interact_cat'])
print('OR TRTGRP (BCG vs Placebo):', or_trt)
print('OR expect_interact (Yes vs No):', or_expect)
perc_red = (1-or_expect)*100
print('Percent reduction:', perc_red)

from collections import OrderedDict
from scipy.stats import chi2_contingency

def chi_sq(data):
    tab = pd.crosstab(data['TRTGRP_cat'], data['AESEV_ord'])
    chi2, p, dof, exp = chi2_contingency(tab)
    return p, tab

pvals = OrderedDict()
for lvl in cat_type.categories:
    sub = ad[ad['patients_seen_cat']==lvl]
    if sub['TRTGRP_cat'].nunique()==2 and sub['AESEV_ord'].nunique()>1:
        p, tab = chi_sq(sub)
        pvals[lvl]=p
        print('\nPatients_seen', lvl)
        print(tab)
        print('p=',p)

print('pvals by patients_seen_cat:', pvals)

# Q4
sub = ad[ad['expect_interact_cat']==1]
px, tabx = chi_sq(sub)
print('\nExpect interact=Yes crosstab')
print(tabx)
print('p=',px)

# Q5
sub5 = ad[ad['patients_seen_cat']=='>100']
p5, tab5 = chi_sq(sub5)
print('\n>100 patients crosstab')
print(tab5)
print('p=',p5)

# Q6
sub6 = ad[ad['patients_seen_cat']=='1-50']
p6, tab6 = chi_sq(sub6)
print('\n1-50 patients crosstab')
print(tab6)
print('p=',p6)


# %% cell 6
import os, pandas as pd
from pathlib import Path
import numpy as np
from statsmodels.miscmodels.ordinal_model import OrderedModel
from scipy.stats import chi2_contingency

DATA_DIR = os.environ['DATA_DIR']

ae = pd.read_csv(Path(DATA_DIR)/'TASK008_BCG-CORONA_AE.csv')
dm = pd.read_csv(Path(DATA_DIR)/'TASK008_BCG-CORONA_DM.csv')

sever = ae.groupby('USUBJID')['AESEV'].max().reset_index().dropna()

ad = sever.merge(dm[['USUBJID','TRTGRP','patients_seen','expect_interact']], on='USUBJID', how='inner')

ad = ad.dropna(subset=['AESEV','TRTGRP','patients_seen','expect_interact'])

ad['AESEV_ord'] = ad['AESEV'].astype(int)

ad['TRTGRP_cat'] = ad['TRTGRP'].map({'Placebo':0,'BCG':1})

ad['expect_interact_cat'] = ad['expect_interact'].map({'No':0,'Yes':1})

cat_type = pd.CategoricalDtype(['0','1-50','51-100','>100'], ordered=True)
ad['patients_seen_cat'] = ad['patients_seen'].astype(str).str.strip().astype(cat_type)

# manually build design matrix without constant and with numeric code for patients_seen
ad['patients_seen_code'] = ad['patients_seen_cat'].cat.codes

X = ad[['TRTGRP_cat','expect_interact_cat','patients_seen_code']]
print(X.head())

model = OrderedModel(ad['AESEV_ord'], X, distr='logit')
res = model.fit(method='bfgs', disp=False)
print(res.summary())

params = res.params
or_trt = np.exp(params['TRTGRP_cat'])
or_expect = np.exp(params['expect_interact_cat'])
print('OR TRTGRP (BCG vs Placebo):', or_trt)
print('OR expect_interact (Yes vs No):', or_expect)
perc_red = (1-or_expect)*100
print('Percent reduction:', perc_red)

from collections import OrderedDict

def chi_sq(data):
    tab = pd.crosstab(data['TRTGRP_cat'], data['AESEV_ord'])
    chi2, p, dof, exp = chi2_contingency(tab)
    return p, tab

pvals = OrderedDict()
for lvl in cat_type.categories:
    sub = ad[ad['patients_seen_cat']==lvl]
    if sub['TRTGRP_cat'].nunique()==2 and sub['AESEV_ord'].nunique()>1:
        p, tab = chi_sq(sub)
        pvals[lvl]=p
        print('\nPatients_seen', lvl)
        print(tab)
        print('p=',p)

print('pvals by patients_seen_cat:', pvals)

# Q4
sub = ad[ad['expect_interact_cat']==1]
px, tabx = chi_sq(sub)
print('\nExpect interact=Yes crosstab')
print(tabx)
print('p=',px)

# Q5
sub5 = ad[ad['patients_seen_cat']=='>100']
p5, tab5 = chi_sq(sub5)
print('\n>100 patients crosstab')
print(tab5)
print('p=',p5)

# Q6
sub6 = ad[ad['patients_seen_cat']=='1-50']
p6, tab6 = chi_sq(sub6)
print('\n1-50 patients crosstab')
print(tab6)
print('p=',p6)

