
# %% cell 0
import os, zipfile, pandas as pd, numpy as np
from pathlib import Path

data_dir = os.environ['DATA_DIR']
print(data_dir)

# Inspect scogs_fungi.zip
zip_path = Path(data_dir) / 'scogs_fungi.zip'
with zipfile.ZipFile(zip_path) as z:
    print('Zip contents:')
    print('\n'.join(z.namelist()))

# Try to locate a table that might have saturation
with zipfile.ZipFile(zip_path) as z:
    candidates = [n for n in z.namelist() if n.lower().endswith(('.tsv','.csv'))]
    print('Tabular files:', candidates)
