
# %% cell 0
import os, zipfile, pandas as pd, numpy as np, scipy.stats as stats
from pathlib import Path

DATA_DIR = os.environ['DATA_DIR']
print(DATA_DIR)

# list work dir
print('WORK_DIR listing:', os.listdir('.'))

# %% cell 1
import os, zipfile, pandas as pd
from pathlib import Path
DATA_DIR = os.environ['DATA_DIR']

# inspect scogs zip files
for fname in ['scogs_animals.zip','scogs_fungi.zip']:
    path = Path(DATA_DIR)/fname
    with zipfile.ZipFile(path) as z:
        print('\nContents of', fname)
        z.printdir()

# %% cell 2
import os, zipfile, pandas as pd
from pathlib import Path
DATA_DIR = os.environ['DATA_DIR']

# maybe DVMC precomputed? search within zips
import zipfile, re

for fname in ['scogs_animals.zip','scogs_fungi.zip']:
    path = Path(DATA_DIR)/fname
    with zipfile.ZipFile(path) as z:
        matches = [n for n in z.namelist() if 'dvmc' in n.lower() or 'DVMC' in n]
        print(fname, 'DVMC-related:', matches[:20])

# %% cell 3
import os, zipfile, io, numpy as np, pandas as pd, scipy.stats as stats
from pathlib import Path

DATA_DIR = os.environ['DATA_DIR']

# get all treefiles and compute DVMC from branch lengths using PhyKIT formula

def parse_newick_lengths(s):
    # returns list of branch lengths
    lens = []
    num = ''
    in_len = False
    for ch in s:
        if ch == ':':
            in_len = True
            num = ''
        elif in_len and (ch.isdigit() or ch in '.eE-+'):
            num += ch
        elif in_len:
            if num:
                try:
                    lens.append(float(num))
                except:
                    pass
            in_len = False
    if in_len and num:
        try:
            lens.append(float(num))
        except:
            pass
    return lens


def dvmc_from_tree(newick_str):
    blens = np.array(parse_newick_lengths(newick_str))
    return float(np.std(blens, ddof=1))


res_anim = []
res_fun = []

for kingdom, zipname in [('animals','scogs_animals.zip'),('fungi','scogs_fungi.zip')]:
    path = Path(DATA_DIR)/zipname
    with zipfile.ZipFile(path) as z:
        for nm in z.namelist():
            if nm.endswith('.treefile'):
                gid = nm.split('.')[0]
                txt = z.read(nm).decode('utf-8').strip()
                # first line newick
                newick = txt.split('\n')[0].strip()
                d = dvmc_from_tree(newick)
                if kingdom=='animals':
                    res_anim.append({'gene':gid,'DVMC':d})
                else:
                    res_fun.append({'gene':gid,'DVMC':d})

anim_df = pd.DataFrame(res_anim)
fun_df = pd.DataFrame(res_fun)

print('animals n', len(anim_df),'fungi n', len(fun_df))
print(anim_df.head())
print(fun_df.head())

# save for reuse
anim_df.to_csv('animals_dvmc.csv', index=False)
fun_df.to_csv('fungi_dvmc.csv', index=False)

# Qs
q1 = (fun_df['DVMC']<0.3).mean()*100
q2 = anim_df['DVMC'].median()
U, p = stats.mannwhitneyu(anim_df['DVMC'], fun_df['DVMC'], alternative='two-sided')
q4 = anim_df['DVMC'].std(ddof=1)
q5 = fun_df['DVMC'].median()
q6 = anim_df['DVMC'].max()
q7 = float(fun_df.loc[fun_df['gene']=='324863at2759','DVMC'])
print('q1',q1,'q2',q2,'U',U,'q4',q4,'q5',q5,'q6',q6,'q7',q7)
