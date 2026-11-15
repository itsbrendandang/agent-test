
# %% cell 0
import os, pandas as pd
print(os.environ['DATA_DIR'])

chip_summary = pd.read_excel(os.path.join(os.environ['DATA_DIR'], 'CHIP VAF mean proportions.xlsx'))
print(chip_summary.columns)
print(chip_summary.head())

# %% cell 1
import os, pandas as pd
status = pd.read_excel(os.path.join(os.environ['DATA_DIR'], '230215_Trio_Status.xlsx'))
print(status.columns)
print(status.head())

# %% cell 2
import os, pandas as pd, glob

data_dir = os.environ['DATA_DIR']
chip_files = glob.glob(os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS', '*.xlsx'))
print(len(chip_files))

# peek one file
f = chip_files[0]
print(f)
df = pd.read_excel(f)
print(df.columns)
print(df.head())

# %% cell 3
import os, pandas as pd, glob

data_dir = os.environ['DATA_DIR']
status = pd.read_excel(os.path.join(data_dir, '230215_Trio_Status.xlsx'))

# Identify BLM variant groups
print(status['BLM Mutation Status'].value_counts())

chip_files = glob.glob(os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS', '*.xlsx'))

records = []
for path in chip_files:
    fname = os.path.basename(path)
    sample_part = fname.split('_CHIP_')[1].replace('.xlsx','')
    sample_id = sample_part
    df = pd.read_excel(path)
    sample_col = [c for c in df.columns if 'Proband' in c or 'SRR' in c or sample_part in c]
    if not sample_col:
        continue
    sample_col = sample_col[0]
    for _, row in df.iterrows():
        info = str(row.get(sample_col, ''))
        if '%' not in info:
            continue
        try:
            vaf = float(info.split('%')[0]) / 100.0
        except:
            continue
        gene = str(row.get('RefSeq Genes 110, NCBI', ''))
        records.append({'sample_raw': sample_part, 'vaf': vaf, 'gene': gene})

chip = pd.DataFrame(records)
print(chip.head())
print('n variants:', len(chip))

# link to status by sample numeric id where possible
import re
chip['Sample ID'] = chip['sample_raw'].str.extract(r'^(\d+)', expand=False)
chip = chip.merge(status[['Sample ID','Status','BLM Mutation Status']], on='Sample ID', how='left')
print(chip['BLM Mutation Status'].value_counts(dropna=False))

# Define CHIP variants: I assume all listed here are CHIP; gene list given in other file
chip_genes = pd.read_excel(os.path.join(data_dir,'230214_Schenz_et_al_2022_CHIP_Genes.xlsx'))
print(chip_genes.head())

chip_only = chip[chip['gene'].isin(chip_genes['Gene Symbol'].astype(str))]
print('n CHIP variants with gene in list:', len(chip_only))

# q1: individuals with BLM variant (Carrier or Affected?)
mask_blm = chip_only['BLM Mutation Status'].isin(['Carrier','Affected'])
chip_blm = chip_only[mask_blm]
prop_somatic_q1 = (chip_blm['vaf'] < 0.3).mean()
print('q1 proportion:', prop_somatic_q1)

# Need Control Children cohort for q2
print(status['Status'].value_counts())

# infer Control Children as Status == 'Control child'
control_children = chip_only[chip_only['Status'] == 'Control child']
prop_mid_q2 = ((control_children['vaf'] >= 0.3) & (control_children['vaf'] <= 0.7)).mean()
print('q2 proportion:', prop_mid_q2, 'count', len(control_children))

# %% cell 4
import os, pandas as pd, glob, re

data_dir = os.environ['DATA_DIR']

chip_files = glob.glob(os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS', '*.xlsx'))
print('n files', len(chip_files))

path = chip_files[0]
df = pd.read_excel(path)
print(df.columns)
print(df.iloc[:10, :10])

# inspect sample column more carefully
for c in df.columns:
    print(c, 'unique example:', df[c].iloc[0])

# %% cell 5
import os, pandas as pd, glob

data_dir = os.environ['DATA_DIR']
chip_genes = pd.read_excel(os.path.join(data_dir,'230214_Schenz_et_al_2022_CHIP_Genes.xlsx'))
chip_gene_set = set(chip_genes['Gene Symbol'].astype(str))

status = pd.read_excel(os.path.join(data_dir, '230215_Trio_Status.xlsx'))

chip_files = glob.glob(os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS', '*.xlsx'))

records = []
for path in chip_files:
    fname = os.path.basename(path)
    sample_raw = fname.split('_CHIP_')[1].replace('.xlsx','')
    df = pd.read_excel(path)
    header = df.iloc[0]
    df2 = df[1:].copy()
    df2.columns = header
    # keep CHIP-flagged variants
    if 'In_CHIP' not in df2.columns:
        continue
    df2 = df2[df2['In_CHIP'] == True]
    if df2.empty:
        continue
    for _, row in df2.iterrows():
        gene = str(row.get('Gene Names',''))
        vaf = row.get('Variant Allele Freq')
        try:
            vaf = float(vaf)
        except:
            continue
        records.append({'sample_raw': sample_raw, 'gene': gene, 'vaf': vaf})

chip = pd.DataFrame(records)
print('total CHIP rows', len(chip))
print(chip.head())

# split gene names if multiple
import itertools
rows_expanded = []
for _, r in chip.iterrows():
    genes = [g.strip() for g in str(r['gene']).split(';') if g.strip()]
    for g in genes:
        rows_expanded.append({'sample_raw': r['sample_raw'], 'gene': g, 'vaf': r['vaf']})
chip2 = pd.DataFrame(rows_expanded)

chip2 = chip2[chip2['gene'].isin(chip_gene_set)]
print('after gene filter', len(chip2))

chip2['Sample ID'] = chip2['sample_raw'].str.extract(r'^(\d+)', expand=False)
chip2 = chip2.merge(status[['Sample ID','Status','BLM Mutation Status']], on='Sample ID', how='left')
print(chip2['BLM Mutation Status'].value_counts(dropna=False))
print(chip2['Status'].value_counts(dropna=False))

# q1
mask_blm = chip2['BLM Mutation Status'].isin(['Carrier','Affected'])
chip_blm = chip2[mask_blm]
prop_q1 = (chip_blm['vaf'] < 0.3).mean()
print('q1:', prop_q1, 'n=', len(chip_blm))

# q2: Control Children cohort
control = chip2[chip2['Status'] == 'Control child']
prop_q2 = ((control['vaf'] >= 0.3) & (control['vaf'] <= 0.7)).mean()
print('q2:', prop_q2, 'n=', len(control))

# %% cell 6
import os, pandas as pd

chip_genes = pd.read_excel(os.path.join(os.environ['DATA_DIR'],'230214_Schenz_et_al_2022_CHIP_Genes.xlsx'))
print(chip_genes.columns)
print(chip_genes.head())

# %% cell 7
import os, pandas as pd, glob

data_dir = os.environ['DATA_DIR']
chip_gene_set = set(pd.read_excel(os.path.join(data_dir,'230214_Schenz_et_al_2022_CHIP_Genes.xlsx'))['ABL1'].astype(str))

status = pd.read_excel(os.path.join(data_dir, '230215_Trio_Status.xlsx'))

chip_files = glob.glob(os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS', '*.xlsx'))

records = []
for path in chip_files:
    fname = os.path.basename(path)
    sample_raw = fname.split('_CHIP_')[1].replace('.xlsx','')
    df = pd.read_excel(path)
    header = df.iloc[0]
    df2 = df[1:].copy()
    df2.columns = header
    if 'In_CHIP' not in df2.columns:
        continue
    df2 = df2[df2['In_CHIP'] == True]
    if df2.empty:
        continue
    for _, row in df2.iterrows():
        gene = str(row.get('Gene Names',''))
        vaf = row.get('Variant Allele Freq')
        try:
            vaf = float(vaf)
        except:
            continue
        records.append({'sample_raw': sample_raw, 'gene': gene, 'vaf': vaf})

chip = pd.DataFrame(records)
print('total CHIP rows', len(chip))
print(chip.head())

rows_expanded = []
for _, r in chip.iterrows():
    genes = [g.strip() for g in str(r['gene']).split(';') if g.strip()]
    for g in genes:
        rows_expanded.append({'sample_raw': r['sample_raw'], 'gene': g, 'vaf': r['vaf']})
chip2 = pd.DataFrame(rows_expanded)

chip2 = chip2[chip2['gene'].isin(chip_gene_set)]
print('after gene filter', len(chip2))

chip2['Sample ID'] = chip2['sample_raw'].str.extract(r'^(\d+)', expand=False)
chip2 = chip2.merge(status[['Sample ID','Status','BLM Mutation Status']], on='Sample ID', how='left')
print(chip2['BLM Mutation Status'].value_counts(dropna=False))
print(chip2['Status'].value_counts(dropna=False))

mask_blm = chip2['BLM Mutation Status'].isin(['Carrier','Affected'])
chip_blm = chip2[mask_blm]
prop_q1 = (chip_blm['vaf'] < 0.3).mean()
print('q1:', prop_q1, 'n=', len(chip_blm))

control = chip2[chip2['Status'] == 'Control child']
prop_q2 = ((control['vaf'] >= 0.3) & (control['vaf'] <= 0.7)).mean()
print('q2:', prop_q2, 'n=', len(control))

# %% cell 8
import os, pandas as pd, glob

data_dir = os.environ['DATA_DIR']

path = glob.glob(os.path.join(data_dir,'CHIP_DP10_GQ20_PASS','*.xlsx'))[0]
print(path)
df = pd.read_excel(path)
print(df.iloc[:5,:15])

# %% cell 9
import os, pandas as pd, glob

data_dir = os.environ['DATA_DIR']

path = glob.glob(os.path.join(data_dir,'CHIP_DP10_GQ20_PASS','*.xlsx'))[0]
df = pd.read_excel(path)
header = df.iloc[0]
df2 = df[1:].copy(); df2.columns = header
print(df2.columns)
print(df2[['Gene Names','Variant Allele Freq','In_CHIP']].head())

# %% cell 10
import os, pandas as pd, glob

data_dir = os.environ['DATA_DIR']
chip_genes = set(pd.read_excel(os.path.join(data_dir,'230214_Schenz_et_al_2022_CHIP_Genes.xlsx'))['ABL1'].astype(str))
status = pd.read_excel(os.path.join(data_dir, '230215_Trio_Status.xlsx'))

chip_files = glob.glob(os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS', '*.xlsx'))

records = []
for path in chip_files:
    fname = os.path.basename(path)
    sample_raw = fname.split('_CHIP_')[1].replace('.xlsx','')
    df = pd.read_excel(path)
    header = df.iloc[0]
    df2 = df[1:].copy(); df2.columns = header
    if 'In_CHIP' not in df2.columns:
        continue
    df2 = df2[df2['In_CHIP'] == True]
    df2 = df2[df2['Gene Names'].isin(chip_genes)]
    for _, row in df2.iterrows():
        vaf = row['Variant Allele Freq']
        try:
            vaf = float(vaf)
        except:
            continue
        records.append({'sample_raw': sample_raw, 'gene': row['Gene Names'], 'vaf': vaf})

chip = pd.DataFrame(records)
print('n CHIP variants', len(chip))
print(chip.head())

chip['Sample ID'] = chip['sample_raw'].str.extract(r'^(\d+)', expand=False)
chip = chip.merge(status[['Sample ID','Status','BLM Mutation Status']], on='Sample ID', how='left')
print(chip['BLM Mutation Status'].value_counts(dropna=False))
print(chip['Status'].value_counts(dropna=False))

chip_blm = chip[chip['BLM Mutation Status'].isin(['Carrier','Affected'])]
prop_q1 = (chip_blm['vaf'] < 0.3).mean()
print('q1 proportion', prop_q1, 'n=', len(chip_blm))

control = chip[chip['Status'] == 'Control child']
prop_q2 = ((control['vaf'] >= 0.3) & (control['vaf'] <= 0.7)).mean()
print('q2 proportion', prop_q2, 'n=', len(control))

# %% cell 11
import os, pandas as pd, glob

data_dir = os.environ['DATA_DIR']

chip_files = glob.glob(os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS', '*.xlsx'))

records = []
for path in chip_files:
    fname = os.path.basename(path)
    sample_raw = fname.split('_CHIP_')[1].replace('.xlsx','')
    df = pd.read_excel(path)
    header = df.iloc[0]
    df2 = df[1:].copy(); df2.columns = header
    if 'In_CHIP' not in df2.columns:
        continue
    df2 = df2[df2['In_CHIP'] == True]
    for _, row in df2.iterrows():
        vaf = row['Variant Allele Freq']
        try:
            vaf = float(vaf)
        except:
            continue
        records.append({'sample_raw': sample_raw, 'vaf': vaf})

chip = pd.DataFrame(records)
print('n CHIP variants (all genes)', len(chip))
print(chip.head())

status = pd.read_excel(os.path.join(data_dir, '230215_Trio_Status.xlsx'))
chip['Sample ID'] = chip['sample_raw'].str.extract(r'^(\d+)', expand=False)
chip = chip.merge(status[['Sample ID','Status','BLM Mutation Status']], on='Sample ID', how='left')
print(chip['BLM Mutation Status'].value_counts(dropna=False))
print(chip['Status'].value_counts(dropna=False))

chip_blm = chip[chip['BLM Mutation Status'].isin(['Carrier','Affected'])]
prop_q1 = (chip_blm['vaf'] < 0.3).mean()
print('q1 proportion', prop_q1, 'n=', len(chip_blm))

control = chip[chip['Status'] == 'Control child']
prop_q2 = ((control['vaf'] >= 0.3) & (control['vaf'] <= 0.7)).mean()
print('q2 proportion', prop_q2, 'n=', len(control))

# %% cell 12
import os, pandas as pd, glob

data_dir = os.environ['DATA_DIR']

chip_files = glob.glob(os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS', '*.xlsx'))

for path in chip_files[:3]:
    print('file', os.path.basename(path))
    df = pd.read_excel(path)
    header = df.iloc[0]
    df2 = df[1:].copy(); df2.columns = header
    print('In_CHIP in columns?', 'In_CHIP' in df2.columns)
    if 'In_CHIP' in df2.columns:
        print(df2['In_CHIP'].value_counts(dropna=False).head())

# %% cell 13
import os, pandas as pd, glob

data_dir = os.environ['DATA_DIR']

chip_files = glob.glob(os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS', '*.xlsx'))

records = []
for path in chip_files:
    fname = os.path.basename(path)
    sample_raw = fname.split('_CHIP_')[1].replace('.xlsx','')
    df = pd.read_excel(path)
    header = df.iloc[0]
    df2 = df[1:].copy(); df2.columns = header
    for _, row in df2.iterrows():
        vaf = row.get('Variant Allele Freq')
        try:
            vaf = float(vaf)
        except:
            continue
        records.append({'sample_raw': sample_raw, 'vaf': vaf})

chip = pd.DataFrame(records)
print('n variants total', len(chip))
print(chip.head())

status = pd.read_excel(os.path.join(data_dir, '230215_Trio_Status.xlsx'))
chip['Sample ID'] = chip['sample_raw'].str.extract(r'^(\d+)', expand=False)
chip = chip.merge(status[['Sample ID','Status','BLM Mutation Status']], on='Sample ID', how='left')
print(chip['BLM Mutation Status'].value_counts(dropna=False))
print(chip['Status'].value_counts(dropna=False))

chip_blm = chip[chip['BLM Mutation Status'].isin(['Carrier','Affected'])]
prop_q1 = (chip_blm['vaf'] < 0.3).mean()
print('q1 proportion', prop_q1, 'n=', len(chip_blm))

control = chip[chip['Status'] == 'Control child']
prop_q2 = ((control['vaf'] >= 0.3) & (control['vaf'] <= 0.7)).mean()
print('q2 proportion', prop_q2, 'n=', len(control))

# %% cell 14
import os, pandas as pd
status = pd.read_excel(os.path.join(os.environ['DATA_DIR'],'230215_Trio_Status.xlsx'))
print(status.head())

# %% cell 15
import os, glob
from openpyxl import load_workbook

data_dir = os.environ['DATA_DIR']
path = glob.glob(os.path.join(data_dir,'CHIP_DP10_GQ20_PASS','230209_Exome_GRCh38_CHIP_615-P1.xlsx'))[0]
wb = load_workbook(path, read_only=True)
print(wb.sheetnames)
ws = wb[wb.sheetnames[0]]
for row in ws.iter_rows(min_row=1, max_row=5, values_only=True):
    print(row)

# %% cell 16
import os, glob
from openpyxl import load_workbook

data_dir = os.environ['DATA_DIR']
path = glob.glob(os.path.join(data_dir,'CHIP_DP10_GQ20_PASS','230209_Exome_GRCh38_CHIP_615-P1.xlsx'))[0]
wb = load_workbook(path, read_only=True, data_only=True)
ws = wb[wb.sheetnames[0]]
for i,row in enumerate(ws.iter_rows(min_row=1, max_row=20, values_only=True), start=1):
    print(i, row)


# %% cell 17
import os, glob
from openpyxl import load_workbook

data_dir = os.environ['DATA_DIR']
path = glob.glob(os.path.join(data_dir,'CHIP_DP10_GQ20_PASS','230209_Exome_GRCh38_CHIP_615-P1.xlsx'))[0]
wb = load_workbook(path, read_only=True, data_only=True)
ws = wb[wb.sheetnames[0]]

# find non-empty in first 40 rows, 40 cols
for r in range(1, 15):
  vals = [ws.cell(row=r, column=c).value for c in range(1,15)]
  print(r, vals)

# %% cell 18
import os, glob
from openpyxl import load_workbook

data_dir = os.environ['DATA_DIR']
path = glob.glob(os.path.join(data_dir,'CHIP_DP10_GQ20_PASS','230209_Exome_GRCh38_CHIP_615-P1.xlsx'))[0]
wb = load_workbook(path, read_only=True, data_only=True)
ws = wb[wb.sheetnames[0]]

# search for 'In_CHIP'
for r in range(1,40):
  vals = [ws.cell(row=r, column=c).value for c in range(1,35)]
  if 'In_CHIP' in vals:
    print('row', r, 'has In_CHIP', vals)
    break

# %% cell 19
import os, glob, pandas as pd

data_dir = os.environ['DATA_DIR']
path = glob.glob(os.path.join(data_dir,'CHIP_DP10_GQ20_PASS','230209_Exome_GRCh38_CHIP_615-P1.xlsx'))[0]
df = pd.read_excel(path, header=1)
print(df.head())
print(df.columns)

# %% cell 20
import os, glob, pandas as pd

data_dir = os.environ['DATA_DIR']
chip_files = glob.glob(os.path.join(data_dir,'CHIP_DP10_GQ20_PASS','*.xlsx'))

records = []
for path in chip_files:
    fname = os.path.basename(path)
    sample_raw = fname.split('_CHIP_')[1].replace('.xlsx','')
    df = pd.read_excel(path, header=1)
    df = df[df['In_CHIP'] == True]
    for _, row in df.iterrows():
        try:
            vaf = float(row['Variant Allele Freq'])
        except:
            continue
        records.append({'sample_raw': sample_raw, 'vaf': vaf})

chip = pd.DataFrame(records)
print('n CHIP variants', len(chip))
print(chip.head())

status = pd.read_excel(os.path.join(data_dir,'230215_Trio_Status.xlsx'))
chip['Sample ID'] = chip['sample_raw'].str.extract(r'^(\d+)', expand=False)
print(chip['Sample ID'].head())
print(status['Sample ID'].head())

chip = chip.merge(status[['Sample ID','Status','BLM Mutation Status']], on='Sample ID', how='left')
print(chip['BLM Mutation Status'].value_counts(dropna=False))
print(chip['Status'].value_counts(dropna=False))

# %% cell 21
import os, glob

from openpyxl import load_workbook

data_dir = os.environ['DATA_DIR']
path = glob.glob(os.path.join(data_dir,'CHIP_DP10_GQ20_PASS','230209_Exome_GRCh38_CHIP_615-P1.xlsx'))[0]
print(os.path.basename(path))
wb = load_workbook(path, read_only=True)
print(wb.sheetnames)

# %% cell 22
import os, glob

data_dir = os.environ['DATA_DIR']
files = glob.glob(os.path.join(data_dir,'CHIP_DP10_GQ20_PASS','*.xlsx'))
print(sorted(os.path.basename(f) for f in files)[:20])

# %% cell 23
import os, glob, pandas as pd

data_dir = os.environ['DATA_DIR']
status = pd.read_excel(os.path.join(data_dir,'230215_Trio_Status.xlsx'))
print(status.head())

files = sorted(glob.glob(os.path.join(data_dir,'CHIP_DP10_GQ20_PASS','*.xlsx')))
for f in files[:5]:
    sid = os.path.basename(f).split('_CHIP_')[1].split('.')[0]
    print(f, '->', sid)

# %% cell 24
import os, glob, pandas as pd

data_dir = os.environ['DATA_DIR']

files = glob.glob(os.path.join(data_dir,'CHIP_DP10_GQ20_PASS','230209_Exome_GRCh38_CHIP_179-P1.xlsx'))
print(files)
if files:
    df = pd.read_excel(files[0], header=1)
    print(df.head())

# %% cell 25
import os, glob, pandas as pd

data_dir = os.environ['DATA_DIR']

# build mapping from sample display to Sample ID
status = pd.read_excel(os.path.join(data_dir,'230215_Trio_Status.xlsx'))

# assume mapping: e.g. 179-P1 -> 179, 185-PF -> 185 etc
# so use numeric prefix

files = glob.glob(os.path.join(data_dir,'CHIP_DP10_GQ20_PASS','230209_Exome_GRCh38_CHIP_179-P1.xlsx'))

for f in files:
    sid = os.path.basename(f).split('_CHIP_')[1].split('.')[0]
    df = pd.read_excel(f, header=1)
    df_chip = df[df['In_CHIP'] == True]
    vafs = pd.to_numeric(df_chip['Variant Allele Freq'], errors='coerce')
    print('non-null vafs', vafs.notna().sum())
    print(vafs.describe())

# %% cell 26
import os, glob, pandas as pd

data_dir = os.environ['DATA_DIR']
status = pd.read_excel(os.path.join(data_dir,'230215_Trio_Status.xlsx'))

files = glob.glob(os.path.join(data_dir,'CHIP_DP10_GQ20_PASS','230209_Exome_GRCh38_CHIP_179-P1.xlsx'))

records = []
for f in files:
    sid = os.path.basename(f).split('_CHIP_')[1].split('.')[0]
    df = pd.read_excel(f, header=1)
    df_chip = df[df['In_CHIP'] == True]
    vafs = pd.to_numeric(df_chip['Variant Allele Freq'], errors='coerce')
    records.append({'sample_display': sid, 'n': vafs.notna().sum(), 'prop_vaf<0.3': (vafs<0.3).mean()})
print(records)

# inspect which Sample ID 179 row corresponds to chip file
print(status[status['Sample ID']=='179'])

# %% cell 27
import os, pandas as pd
status = pd.read_excel(os.path.join(os.environ['DATA_DIR'],'230215_Trio_Status.xlsx'))
print(status['Sample ID'].tolist()[:50])

# %% cell 28
import os, glob, pandas as pd

data_dir = os.environ['DATA_DIR']
status = pd.read_excel(os.path.join(data_dir,'230215_Trio_Status.xlsx'))
status['Sample ID str'] = status['Sample ID'].astype(str).str.strip()

files = glob.glob(os.path.join(data_dir,'CHIP_DP10_GQ20_PASS','*.xlsx'))

def map_sample(sample_raw):
    # if starts with digits
    import re
    m = re.match(r'^(\d+)', sample_raw)
    if m:
        return m.group(1)
    # else SRR
    if sample_raw.startswith('SRR'):
        return sample_raw
    return None

records = []
for f in files:
    sample_raw = os.path.basename(f).split('_CHIP_')[1].split('.')[0]
    sid = map_sample(sample_raw)
    df = pd.read_excel(f, header=1)
    df_chip = df[df['In_CHIP']==True]
    vafs = pd.to_numeric(df_chip['Variant Allele Freq'], errors='coerce')
    for v in vafs.dropna():
        records.append({'Sample ID str': sid, 'vaf': float(v)})

chip = pd.DataFrame(records)
print('rows', len(chip))
chip = chip.merge(status[['Sample ID str','Status','BLM Mutation Status']], on='Sample ID str', how='left')
print(chip['BLM Mutation Status'].value_counts(dropna=False))
print(chip['Status'].value_counts(dropna=False))

chip_blm = chip[chip['BLM Mutation Status'].isin(['Carrier','Affected'])]
print('blm rows', len(chip_blm))
print(chip_blm['BLM Mutation Status'].value_counts())
prop_q1 = (chip_blm['vaf']<0.3).mean()
print('q1 proportion', prop_q1)

control = chip[chip['Status']=='Control child']
print('control rows', len(control))
prop_q2 = ((control['vaf']>=0.3)&(control['vaf']<=0.7)).mean()
print('q2 proportion', prop_q2)

# %% cell 29
import os, pandas as pd
status = pd.read_excel(os.path.join(os.environ['DATA_DIR'],'230215_Trio_Status.xlsx'))
print(status['Status'].value_counts())
