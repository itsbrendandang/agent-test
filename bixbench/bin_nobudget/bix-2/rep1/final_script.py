
# %% cell 0
import os, pandas as pd
print(os.environ['DATA_DIR'])


# %% cell 1
import os, pandas as pd
DATA_DIR = os.environ['DATA_DIR']

trio = pd.read_excel(os.path.join(DATA_DIR, '230215_Trio_Status.xlsx'))
print(trio.head())
print(trio.columns)


# %% cell 2
import os, pandas as pd
from glob import glob
DATA_DIR = os.environ['DATA_DIR']

paths = glob(os.path.join(DATA_DIR, 'CHIP_DP10_GQ20_PASS', '*.xlsx'))
print(len(paths))
print(os.path.basename(paths[0]))

dfs = []
for p in paths:
    df = pd.read_excel(p)
    df['source_file'] = os.path.basename(p)
    dfs.append(df)
chip = pd.concat(dfs, ignore_index=True)
print(chip.head())
print(chip.columns)


# %% cell 3
import os, pandas as pd
DATA_DIR = os.environ['DATA_DIR']

chip = pd.read_excel(os.path.join(DATA_DIR, 'CHIP VAF mean proportions.xlsx'))
print(chip.head())
print(chip.columns)


# %% cell 4
import os, pandas as pd
DATA_DIR = os.environ['DATA_DIR']

chip_vaf = pd.read_excel(os.path.join(DATA_DIR, 'CHIP VAF mean proportions.xlsx'), sheet_name=1)
print(chip_vaf.head(10))
print(chip_vaf.columns)


# %% cell 5
import os, pandas as pd
DATA_DIR = os.environ['DATA_DIR']

chip_vaf = pd.read_excel(os.path.join(DATA_DIR, 'CHIP VAF mean proportions.xlsx'), header=2)
print(chip_vaf.head(20))
print(chip_vaf.columns)


# %% cell 6
import os, pandas as pd
DATA_DIR = os.environ['DATA_DIR']

chip_vaf = pd.read_excel(os.path.join(DATA_DIR, 'CHIP VAF mean proportions.xlsx'), header=2)

# derive mean proportions under simple linear constraints within each VAF band
results = {}
for band in ['VAF < 0.3', 'VAF 0.3-0.7']:
    sub = chip_vaf[chip_vaf['CHIP VAF']==band].dropna()
    comps = dict(zip(sub['comparison'], sub['difference']))
    # unknowns: A, Cc, Cp, Ch (Affected, Carrier, Control Child, Control Parent)
    # from differences
    # d1: A-Cc
    d1 = comps.get('Affected - Control Child')
    # d2: C - Cc (Carrier)
    d2 = comps.get('Carrier - Control Child')
    # d3: Cc - Cp
    d3 = comps.get('Control Child - Control Parent')
    # Let Cc = x
    # Then A = x + d1; C = x + d2; Cp = x - d3
    # Sum to 1: (x+d1)+(x+d2)+x+(x-d3) = 1 -> 4x + d1 + d2 - d3 = 1
    x = (1 - d1 - d2 + d3)/4
    Cc = x
    A = x + d1
    C = x + d2
    Cp = x - d3
    results[band] = {'Affected':A, 'Carrier':C, 'Control Child':Cc, 'Control Parent':Cp}

print(results)


# %% cell 7
import os, pandas as pd
DATA_DIR = os.environ['DATA_DIR']

chip_vaf = pd.read_excel(os.path.join(DATA_DIR, 'CHIP VAF mean proportions.xlsx'), header=2)
sub = chip_vaf[chip_vaf['CHIP VAF']=='VAF < 0.3'].dropna()
print(sub)

