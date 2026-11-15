
# %% cell 0
import os, pandas as pd
from glob import glob

trio_path = os.path.join(os.environ['DATA_DIR'], '230215_Trio_Status.xlsx')
trio = pd.read_excel(trio_path)
print(trio.head())
print(trio.columns)

chip_dir = os.path.join(os.environ['DATA_DIR'], 'CHIP_DP10_GQ20_PASS')
files = glob(os.path.join(chip_dir, '*.xlsx'))
print(len(files))
print(os.path.basename(files[0]))

df0 = pd.read_excel(files[0])
print(df0.head())
print(df0.columns)

# %% cell 1
import os, pandas as pd
trio = pd.read_excel(os.path.join(os.environ['DATA_DIR'], '230215_Trio_Status.xlsx'))
carriers = trio[trio['BLM Mutation Status']=='Carrier']
print(carriers.head())
print(len(carriers))

chip_dir = os.path.join(os.environ['DATA_DIR'], 'CHIP_DP10_GQ20_PASS')

sample_to_file = {}
import glob, re
for path in glob.glob(os.path.join(chip_dir,'*.xlsx')):
    base = os.path.basename(path)
    sid = re.search(r'CHIP_(.+)\.xlsx', base).group(1)
    if '-' in sid:
        sid = sid.split('-')[0]
    sample_to_file[sid] = path

print(list(sample_to_file.items())[:10])

# inspect a couple carrier samples
for sid in carriers['Sample ID'].astype(str).head(5):
    print('SID', sid, 'file', sample_to_file.get(sid))

# %% cell 2
import os, pandas as pd, glob, re
chip_dir = os.path.join(os.environ['DATA_DIR'],'CHIP_DP10_GQ20_PASS')
path = os.path.join(chip_dir,'230209_Exome_GRCh38_CHIP_185-PF.xlsx')
df = pd.read_excel(path)
print(df.columns)
print(df[['Variant Info','Unnamed: 1','Flags','Proband (185-PF)','Unnamed: 6']].head())

# %% cell 3
import os, pandas as pd
path = os.path.join(os.environ['DATA_DIR'],'CHIP_DP10_GQ20_PASS','230209_Exome_GRCh38_CHIP_185-PF.xlsx')
df = pd.read_excel(path, header=[0,1])
print(df.columns.tolist()[:15])
print(df.head())

# %% cell 4
import os, pandas as pd, glob, re
trio = pd.read_excel(os.path.join(os.environ['DATA_DIR'], '230215_Trio_Status.xlsx'))
carriers = trio[trio['BLM Mutation Status']=='Carrier']
chip_dir = os.path.join(os.environ['DATA_DIR'],'CHIP_DP10_GQ20_PASS')

sample_to_file = {}
for path in glob.glob(os.path.join(chip_dir,'*.xlsx')):
    base = os.path.basename(path)
    sid = re.search(r'CHIP_(.+)\.xlsx', base).group(1)
    if '-' in sid:
        sid = sid.split('-')[0]
    sample_to_file[sid] = path

counts = []
for _, row in carriers.iterrows():
    sid = str(row['Sample ID'])
    f = sample_to_file.get(sid)
    if not f:
        continue
    df = pd.read_excel(f, header=[0,1])
    # identify this sample's column prefix
    sample_cols = [c for c in df.columns if c[0].startswith(tuple(['Father','Mother','P1','P2','PM','PF','P']))]
    # pick first person column
    person_prefix = sample_cols[0][0]
    zyg = df[(person_prefix,'Zygosity')]
    vaf = df[(person_prefix,'Variant Allele Freq')]
    seq_ont = df[('RefSeq Genes 110, NCBI','Sequence Ontology (Combined)')]
    effects = df[('RefSeq Genes 110, NCBI','Effect (Combined)')]
    mask = vaf < 0.3
    mask &= ~seq_ont.fillna('').str.contains('intronic|intergenic|UTR', case=False)
    mask &= ~effects.fillna('').str.contains('intronic|intergenic|UTR', case=False)
    mask &= ~zyg.fillna('').str.contains('Reference', case=False)
    n = mask.sum()
    print(sid, person_prefix, n)
    counts.append(n)

import numpy as np
print('counts', counts)
print('median', np.median(counts))
