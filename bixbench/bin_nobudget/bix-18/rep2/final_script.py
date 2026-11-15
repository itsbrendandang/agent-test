
# %% cell 0
import os, pandas as pd, numpy as np
p = os.environ['DATA_DIR']
df = pd.read_csv(os.path.join(p,'Swarm_1.csv'))
print(df)
print('\nMeans by genotype:')
print(df.groupby('Genotype')[['Area','Circularity']].mean())
print('\nSEM circularity rhlR-:')
rhl = df[df['Genotype']=='rhlR-']['Circularity']
print(rhl.std(ddof=1)/np.sqrt(len(rhl)))
