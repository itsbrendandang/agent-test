
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

print(df.head())
print(df['Hemispere'].value_counts())

# Rename column
df = df.rename(columns={'Hemispere':'Hemisphere'})

# Q2: Cohen's d KD vs CTRL
kd = df[df['Hemisphere']=='KD']['NeuN']
ctrl = df[df['Hemisphere']=='CTRL']['NeuN']

mean_kd = kd.mean(); mean_ctrl = ctrl.mean()
std_kd = kd.std(ddof=1); std_ctrl = ctrl.std(ddof=1)

n_kd = kd.shape[0]; n_ctrl = ctrl.shape[0]

sp = np.sqrt(((n_kd-1)*std_kd**2 + (n_ctrl-1)*std_ctrl**2)/(n_kd+n_ctrl-2))
cohen_d = (mean_kd-mean_ctrl)/sp
print('means', mean_kd, mean_ctrl)
print('stds', std_kd, std_ctrl)
print('ns', n_kd, n_ctrl)
print('Cohen d:', cohen_d)

# Q3: Shapiro-Wilk for KD
w_stat, p_sw = stats.shapiro(kd)
print('Shapiro KD W, p:', w_stat, p_sw)

# Q4: two-way ANOVA Hemisphere*Sex
import statsmodels.api as sm
from statsmodels.formula.api import ols

model = ols('NeuN ~ C(Hemisphere) * C(Sex)', data=df).fit()
anova_table = sm.stats.anova_lm(model, typ=2)
print(anova_table)

# Extract F for interaction
f_interaction = anova_table.loc['C(Hemisphere):C(Sex)', 'F']
print('F interaction:', f_interaction)

# Q1/Q5: power analysis using observed d
analysis = TTestIndPower()
required_n = analysis.solve_power(effect_size=abs(cohen_d), power=0.8, alpha=0.05, alternative='two-sided')
print('Required n per group (continuous):', required_n)
print('Ceiling n per group:', int(np.ceil(required_n)))
