
# %% cell 0
import os, pandas as pd
print(os.environ['DATA_DIR'])
path = os.path.join(os.environ['DATA_DIR'], 'Swarm_1.csv')
df = pd.read_csv(path)
print(df.head())
print(df.columns)
print(df['Genotype'].unique())
print(df.describe(include='all'))

# %% cell 1
import pandas as pd, os
path = os.path.join(os.environ['DATA_DIR'], 'Swarm_1.csv')
df = pd.read_csv(path)

summary = df.groupby('Genotype').agg(mean_area=('Area','mean'), mean_circ=('Circularity','mean'), n=('Area','size'))
print(summary)

# identify genotype with largest mean area
max_geno = summary['mean_area'].idxmax()
print('max area genotype:', max_geno, 'mean circ:', summary.loc[max_geno, 'mean_circ'])

# Q2 wildtype mean area to nearest thousand
wt_mean = summary.loc['Wildtype','mean_area']
print('WT mean area:', wt_mean, 'rounded:', round(wt_mean,-3))

# Q3 percent reduction lasR vs WT
las_mean = summary.loc['ΔlasR','mean_area']
reduction = (wt_mean - las_mean)/wt_mean*100
print('reduction %:', reduction)

# Q4 SEM circularity in rhlR-
import numpy as np
rhl = df[df['Genotype']=='rhlR-']['Circularity']
sem_rhl = rhl.std(ddof=1)/np.sqrt(len(rhl))
print('rhlR- n, mean, sd, sem:', len(rhl), rhl.mean(), rhl.std(ddof=1), sem_rhl)

# Q5 relative proportion lasR / WT
prop = las_mean/wt_mean
print('proportion:', prop)
