
# %% cell 0
import os, pandas as pd
from glob import glob

trio_path = os.path.join(os.environ['DATA_DIR'], '230215_Trio_Status.xlsx')
trio = pd.read_excel(trio_path)
print(trio.head())
print(trio.columns)

# %% cell 1
import os, pandas as pd
from glob import glob

data_dir = os.environ['DATA_DIR']
chip_dir = os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS')
files = glob(os.path.join(chip_dir, '*.xlsx'))
print(len(files))
print(files[:5])

# load one to inspect columns
example = pd.read_excel(files[0])
print(example.head())
print(example.columns)

# %% cell 2
import os, pandas as pd, re
from glob import glob

data_dir = os.environ['DATA_DIR']
chip_dir = os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS')

trio = pd.read_excel(os.path.join(data_dir, '230215_Trio_Status.xlsx'))

# identify BLM mutation carriers
carriers = trio[trio['BLM Mutation Status']=='Carrier']
print(carriers.head())
print('N carriers', len(carriers))

# map sample IDs to patient code used in filenames
carriers['file_id'] = carriers['Sample ID'].astype(str)
print(carriers[['Sample ID','file_id']].head())

files = glob(os.path.join(chip_dir, '*.xlsx'))

# build mapping from sample id to file path by matching _<ID>- in filename
id_to_file = {}
for f in files:
    m = re.search(r'_(\d+)-', os.path.basename(f))
    if m:
        sid = m.group(1)
        id_to_file[sid] = f

print('mapped ids in files:', sorted(id_to_file.keys())[:10])

carriers['file_path'] = carriers['file_id'].map(id_to_file)
print(carriers[['Sample ID','file_path']])

# %% cell 3
import os, pandas as pd

example_path = os.path.join(os.environ['DATA_DIR'], 'CHIP_DP10_GQ20_PASS', '230209_Exome_GRCh38_CHIP_185-PF.xlsx')
df = pd.read_excel(example_path)
print(df.columns)
print(df.head())

# %% cell 4
import os, pandas as pd

path = os.path.join(os.environ['DATA_DIR'], 'CHIP_DP10_GQ20_PASS', '230209_Exome_GRCh38_CHIP_185-PF.xlsx')
raw = pd.read_excel(path, header=None)
for i in range(6):
    print(f'Row {i}:')
    print(raw.iloc[i, :10])

# %% cell 5
import os, pandas as pd

path = os.path.join(os.environ['DATA_DIR'], 'CHIP_DP10_GQ20_PASS', '230209_Exome_GRCh38_CHIP_185-PF.xlsx')
raw = pd.read_excel(path, header=None)

# find header row where first cell is 'Chr:Pos'
header_row = raw.index[raw[0]=='Chr:Pos'][0]
print('header_row', header_row)

header = raw.iloc[header_row]
print(header[:15])

df = raw.iloc[header_row+1:].copy()
df.columns = header
print(df.head())
print(df.columns)


# %% cell 6
import os, pandas as pd

path = os.path.join(os.environ['DATA_DIR'], 'CHIP_DP10_GQ20_PASS', '230209_Exome_GRCh38_CHIP_185-PF.xlsx')
raw = pd.read_excel(path, header=None)
header_row = raw.index[raw[0]=='Chr:Pos'][0]
header = raw.iloc[header_row]
df = raw.iloc[header_row+1:].copy()
df.columns = header

print(df['Sequence Ontology (Combined)'].value_counts().head(20))
print('\nZygosity counts:')
print(df['Zygosity'].value_counts())
print('\nVAF example non-null:')
print(df['Variant Allele Freq'].dropna().head())

# %% cell 7
import os, pandas as pd

path = os.path.join(os.environ['DATA_DIR'], 'CHIP_DP10_GQ20_PASS', '230209_Exome_GRCh38_CHIP_185-PF.xlsx')
raw = pd.read_excel(path, header=None)
header_row = raw.index[raw[0]=='Chr:Pos'][0]
header = raw.iloc[header_row]
df = raw.iloc[header_row+1:].copy()
df.columns = header

# apply filters: remove Intronic, Intergenic, UTR
so = df['Sequence Ontology (Combined)'].astype(str)
mask_so = ~so.str.contains('intron|intergenic|UTR', case=False, na=False)
mask_zyg = df['Zygosity']!='Reference'
mask_vaf = pd.to_numeric(df['Variant Allele Freq'], errors='coerce') < 0.3
filtered = df[mask_so & mask_zyg & mask_vaf]
print('Total variants:', len(df))
print('After filter:', len(filtered))
print(filtered[['Chr:Pos','Ref/Alt','Sequence Ontology (Combined)','Zygosity','Variant Allele Freq']].head())

# %% cell 8
import os, pandas as pd, re
from glob import glob

DATA_DIR = os.environ['DATA_DIR']
chip_dir = os.path.join(DATA_DIR, 'CHIP_DP10_GQ20_PASS')
trio = pd.read_excel(os.path.join(DATA_DIR, '230215_Trio_Status.xlsx'))
carriers = trio[trio['BLM Mutation Status']=='Carrier'].copy()
carriers['file_id'] = carriers['Sample ID'].astype(str)

files = glob(os.path.join(chip_dir, '*.xlsx'))
id_to_file = {}
for f in files:
    m = re.search(r'_(\d+)-', os.path.basename(f))
    if m:
        sid = m.group(1)
        id_to_file[sid] = f

carriers['file_path'] = carriers['file_id'].map(id_to_file)
print('Carrier rows with files:')
print(carriers[['Sample ID','file_path']])

variant_counts = []
for _, row in carriers.iterrows():
    sid = row['Sample ID']
    fpath = row['file_path']
    if pd.isna(fpath):
        print('No file for sample', sid)
        continue
    raw = pd.read_excel(fpath, header=None)
    header_row = raw.index[raw[0]=='Chr:Pos'][0]
    header = raw.iloc[header_row]
    df = raw.iloc[header_row+1:].copy()
    df.columns = header

    so = df['Sequence Ontology (Combined)'].astype(str)
    mask_so = ~so.str.contains('intron|intergenic|UTR', case=False, na=False)
    mask_zyg = df['Zygosity']!='Reference'
    vaf = pd.to_numeric(df['Variant Allele Freq'], errors='coerce')
    mask_vaf = vaf < 0.3

    filtered = df[mask_so & mask_zyg & mask_vaf]
    count = len(filtered)
    variant_counts.append({'Sample ID': sid, 'count': count})
    print('Sample', sid, 'variants', count)

vc_df = pd.DataFrame(variant_counts)
print(vc_df)
print('Median:', vc_df['count'].median())
