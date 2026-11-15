
# %% cell 0
import os, pandas as pd
print(os.environ['DATA_DIR'])
path = os.path.join(os.environ['DATA_DIR'], 'NeuN_quantification.csv')
df = pd.read_csv(path)
print(df.head())
print(df.columns)
print(df['Condition'].value_counts())

# %% cell 1
import os, pandas as pd, numpy as np
from scipy import stats
from statsmodels.stats.power import TTestIndPower

path = os.path.join(os.environ['DATA_DIR'], 'NeuN_quantification.csv')
df = pd.read_csv(path)

# Rename misspelled column
df = df.rename(columns={'Hemispere':'Hemisphere'})
print(df.head())
print(df['Hemisphere'].value_counts())

# KD vs CTRL groups
kd = df[df['Hemisphere']=='KD']['NeuN'].astype(float)
ctrl = df[df['Hemisphere']=='CTRL']['NeuN'].astype(float)

# Cohen's d (pooled SD)
mean_kd, mean_ctrl = kd.mean(), ctrl.mean()
var_kd, var_ctrl = kd.var(ddof=1), ctrl.var(ddof=1)

n_kd, n_ctrl = len(kd), len(ctrl)
pooled_var = ((n_kd-1)*var_kd + (n_ctrl-1)*var_ctrl) / (n_kd + n_ctrl - 2)
pooled_sd = np.sqrt(pooled_var)
cohen_d = (mean_kd - mean_ctrl) / pooled_sd
print('n_kd, n_ctrl, means, vars, d=', n_kd, n_ctrl, mean_kd, mean_ctrl, var_kd, var_ctrl, cohen_d)

# Shapiro-Wilk for KD NeuN counts
shapiro_res = stats.shapiro(kd)
print('Shapiro KD:', shapiro_res)

# Two-way ANOVA NeuN ~ Hemisphere * Sex
import statsmodels.api as sm
from statsmodels.formula.api import ols

model = ols('NeuN ~ C(Hemisphere) * C(Sex)', data=df).fit()
anova_table = sm.stats.anova_lm(model, typ=2)
print(anova_table)

# Power analysis for two-sample t-test
analysis = TTestIndPower()

# compute sample size per group
sample_size = analysis.solve_power(effect_size=abs(cohen_d), power=0.8, alpha=0.05, alternative='two-sided')
print('Required n per group (continuous):', sample_size)
print('Ceiling n per group:', np.ceil(sample_size))
