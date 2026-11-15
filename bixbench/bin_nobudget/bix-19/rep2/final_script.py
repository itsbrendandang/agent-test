
# %% cell 0
import os, pandas as pd
print(os.environ['DATA_DIR'])
path=os.path.join(os.environ['DATA_DIR'],'NeuN_quantification.csv')
df=pd.read_csv(path)
print(df.head())
print(df.columns)
print(df['Condition'].value_counts())

# %% cell 1
import os, pandas as pd, numpy as np
from scipy import stats
from statsmodels.stats.power import TTestIndPower

path=os.path.join(os.environ['DATA_DIR'],'NeuN_quantification.csv')
df=pd.read_csv(path)

kd = df[df['Hemispere']=='KD']['NeuN']
ctrl = df[df['Hemispere']=='CTRL']['NeuN']

mean_kd, mean_ctrl = kd.mean(), ctrl.mean()
std_kd, std_ctrl = kd.std(ddof=1), ctrl.std(ddof=1)
print('means', mean_kd, mean_ctrl)
print('stds', std_kd, std_ctrl)

n_kd, n_ctrl = len(kd), len(ctrl)
pooled_sd = np.sqrt(((n_kd-1)*std_kd**2 + (n_ctrl-1)*std_ctrl**2)/(n_kd+n_ctrl-2))
cohen_d = (mean_kd - mean_ctrl)/pooled_sd
print('cohen_d', cohen_d)

# Shapiro-Wilk for KD
shapiro_kd = stats.shapiro(kd)
print('Shapiro KD', shapiro_kd)

# Two-way ANOVA on NeuN with Hemisphere and Sex
import statsmodels.api as sm
from statsmodels.formula.api import ols

model = ols('NeuN ~ C(Hemispere) * C(Sex)', data=df).fit()
anova_table = sm.stats.anova_lm(model, typ=2)
print(anova_table)

# power analysis
analysis = TTestIndPower()
required_n = analysis.solve_power(effect_size=abs(cohen_d), alpha=0.05, power=0.8, alternative='two-sided')
print('required_n per group', required_n)
