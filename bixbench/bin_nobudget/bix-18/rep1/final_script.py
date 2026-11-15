
# %% cell 0
import os, pandas as pd
print(os.environ['DATA_DIR'])
fp = os.path.join(os.environ['DATA_DIR'], 'Swarm_1.csv')
df = pd.read_csv(fp)
print(df.head())
print(df.columns)
print(df['Genotype'].unique())
print(df.groupby('Genotype').agg({'Area':'mean','Circularity':'mean','Genotype':'count'}).rename(columns={'Genotype':'N'}))

# %% cell 1
import pandas as pd, os, numpy as np
fp = os.path.join(os.environ['DATA_DIR'], 'Swarm_1.csv')
df = pd.read_csv(fp)
print(df.groupby('Genotype')['Circularity'].agg(['mean','std','count']))

# %% cell 2
import numpy as np, os, pandas as pd
fp = os.path.join(os.environ['DATA_DIR'], 'Swarm_1.csv')
df = pd.read_csv(fp)
sub = df.groupby('Genotype')['Circularity'].agg(['mean','std','count'])
sem = sub['std']/np.sqrt(sub['count'])
print(sem)
