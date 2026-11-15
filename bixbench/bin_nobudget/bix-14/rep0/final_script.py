
# %% cell 0
import os, pandas as pd
print(os.environ['DATA_DIR'])
status = pd.read_excel(os.path.join(os.environ['DATA_DIR'], '230215_Trio_Status.xlsx'))
print(status.head())
print(status.columns)
chip_genes = pd.read_excel(os.path.join(os.environ['DATA_DIR'], '230214_Schenz_et_al_2022_CHIP_Genes.xlsx'))
print(chip_genes.head())
print(chip_genes.columns)

# %% cell 1
import os, pandas as pd, glob

chip_dir = os.path.join(os.environ['DATA_DIR'], 'CHIP_DP10_GQ20_PASS')
files = sorted(glob.glob(os.path.join(chip_dir, '*.xlsx')))
print(len(files))
print(files[0])

df0 = pd.read_excel(files[0])
print(df0.head())
print(df0.columns)

# %% cell 2
import os, pandas as pd, glob, numpy as np

DATA_DIR = os.environ['DATA_DIR']
status = pd.read_excel(os.path.join(DATA_DIR, '230215_Trio_Status.xlsx'))

chip_dir = os.path.join(DATA_DIR, 'CHIP_DP10_GQ20_PASS')
files = sorted(glob.glob(os.path.join(chip_dir, '*.xlsx')))

blm_carriers = status[status['BLM Mutation Status']=='Carrier']['Sample ID'].astype(str).tolist()
blm_affected = status[status['BLM Mutation Status']=='Affected']['Sample ID'].astype(str).tolist()
parents = status[status['Status'].isin(['Father','Mother'])]['Sample ID'].astype(str).tolist()

print('carriers', blm_carriers[:10])
print('affected', blm_affected[:10])
print('parents', parents[:10])

# map sample id to file
sample_to_file = {}
for f in files:
    base = os.path.basename(f)
    sid = base.split('_')[-1].split('-')[0]
    sample_to_file[sid] = f

print({k: sample_to_file.get(k) for k in blm_carriers+blm_affected if k in sample_to_file})

# function to parse file
import re

def parse_sample(file):
    df = pd.read_excel(file, skiprows=1)
    # find proband column with VAF info
    vaf_col = None
    for c in df.columns:
        if isinstance(c,str) and ('P1' in c or 'PF' in c or 'PM' in c or c.endswith('-P') or 'SRR' in c):
            vaf_col = c
            break
    # parse variant annotation effect from RefSeq Genes col (assuming contains exonic function like synonymous/missense)
    ann_col = 'RefSeq Genes 110, NCBI'
    if ann_col not in df.columns:
        return pd.DataFrame()
    sub = df[['Variant Info', vaf_col, ann_col, 'Flags']].copy()
    sub = sub.rename(columns={vaf_col:'SampleInfo'})
    # extract VAF pattern like '0.12' inside parentheses after depth
    def get_vaf(s):
        if not isinstance(s,str):
            return np.nan
        m = re.search(r"VAF=(0\.\d+|1\.0+|0)", s)
        if m:
            return float(m.group(1))
        m = re.search(r"\((0\.\d+|1\.0+|0)\)", s)
        return float(m.group(1)) if m else np.nan
    sub['VAF'] = sub['SampleInfo'].apply(get_vaf)
    return sub

# test parse on one carrier and one affected
for sid in list(sample_to_file.keys())[:3]:
    print('testing',sid)
    print(parse_sample(sample_to_file[sid]).head())

# %% cell 3
import os, pandas as pd, glob

chip_dir = os.path.join(os.environ['DATA_DIR'], 'CHIP_DP10_GQ20_PASS')
files = sorted(glob.glob(os.path.join(chip_dir, '*.xlsx')))

for f in files[:1]:
    print(f)
    xls = pd.ExcelFile(f)
    print(xls.sheet_names)
    df = xls.parse(xls.sheet_names[0])
    print(df.head())
    print(df.columns)

# %% cell 4
import os, pandas as pd, glob, re, numpy as np

DATA_DIR = os.environ['DATA_DIR']
chip_dir = os.path.join(DATA_DIR, 'CHIP_DP10_GQ20_PASS')
files = sorted(glob.glob(os.path.join(chip_dir, '*.xlsx')))

f = files[0]
df = pd.read_excel(f)
print(df.iloc[:10, :10])

col = [c for c in df.columns if 'Proband' in c or '-P' in c][0]
print('sample col', col)

print(df[col].head(10))

sample_col = col

def get_vaf(s):
    if not isinstance(s,str):
        return np.nan
    m = re.search(r"VAF=(0?\.\d+|1\.0+|0)", s)
    if m:
        return float(m.group(1))
    return np.nan

vafs = df[sample_col].apply(get_vaf)
print(vafs.head(20))
print('num non-na', vafs.notna().sum())
print(df.loc[vafs.notna(), [sample_col]].head())

# %% cell 5
import os, pandas as pd, glob

DATA_DIR = os.environ['DATA_DIR']
chip_dir = os.path.join(DATA_DIR, 'CHIP_DP10_GQ20_PASS')
files = sorted(glob.glob(os.path.join(chip_dir, '*.xlsx')))

f = files[0]
df = pd.read_excel(f)
print(df.columns[:12])
print(df.iloc[:5, :12])

vaf_col = None
for c in df.columns:
    if 'Variant Allele Freq' in str(c):
        vaf_col = c
        break
print('vaf_col', vaf_col)
print(df[vaf_col].head(15))

# %% cell 6
import os, pandas as pd, glob

DATA_DIR = os.environ['DATA_DIR']
chip_dir = os.path.join(DATA_DIR, 'CHIP_DP10_GQ20_PASS')
files = sorted(glob.glob(os.path.join(chip_dir, '*.xlsx')))

f = files[0]
df = pd.read_excel(f)
print(df.iloc[0])
print('\nRow1')
print(df.iloc[1])

print('\nRow0 full')
print(df.iloc[0,:20])

# %% cell 7
import os, pandas as pd, glob

DATA_DIR = os.environ['DATA_DIR']
chip_dir = os.path.join(DATA_DIR, 'CHIP_DP10_GQ20_PASS')
files = sorted(glob.glob(os.path.join(chip_dir, '*.xlsx')))

f = files[0]
df = pd.read_excel(f)
# drop header row
body = df.iloc[1:].reset_index(drop=True)

vaf = pd.to_numeric(body['Unnamed: 9'], errors='coerce')
ann = body['Unnamed: 13']
print('VAF summary', vaf.describe())

mask_low = vaf < 0.3
print('n low', mask_low.sum())
print('example low rows')
print(body.loc[mask_low, ['Variant Info','Proband (179-P1)','Unnamed: 13','Unnamed: 14','Unnamed: 9']].head())

# %% cell 8
import os, pandas as pd, glob
import numpy as np

DATA_DIR = os.environ['DATA_DIR']
chip_dir = os.path.join(DATA_DIR, 'CHIP_DP10_GQ20_PASS')
files = sorted(glob.glob(os.path.join(chip_dir, '*.xlsx')))
status = pd.read_excel(os.path.join(DATA_DIR, '230215_Trio_Status.xlsx'))

# map sample id to file
sample_to_file = {}
for f in files:
    base = os.path.basename(f)
    sid = base.split('_')[-1].split('-')[0]
    sample_to_file[sid] = f

blm_carriers = status[status['BLM Mutation Status']=='Carrier']['Sample ID'].astype(str).tolist()
blm_affected = status[status['BLM Mutation Status']=='Affected']['Sample ID'].astype(str).tolist()
parents = status[status['Status'].isin(['Father','Mother'])]['Sample ID'].astype(str).tolist()

print('n carriers with files', sum(s in sample_to_file for s in blm_carriers))
print('n affected with files', sum(s in sample_to_file for s in blm_affected))

# Q1: in BLM mutation carrier cohort, fraction of VAF<0.3 that are synonymous
low_total = 0
low_syn = 0
for sid in blm_carriers:
    f = sample_to_file.get(sid)
    if not f:
        continue
    df = pd.read_excel(f)
    body = df.iloc[1:].reset_index(drop=True)
    vaf = pd.to_numeric(body['Unnamed: 9'], errors='coerce')
    ann = body['Unnamed: 13'].astype(str)
    mask_low = vaf < 0.3
    low_total += mask_low.sum()
    low_syn += (mask_low & ann.str.contains('synonymous_variant')).sum()

print('Q1 low_total', low_total, 'low_syn', low_syn, 'fraction', low_syn/low_total if low_total>0 else np.nan)

# Q2: VAF<0.3 missense variant frequency: parents (controls) vs affected
# interpret frequency as proportion of low-VAF variants that are missense

def count_low_missense(sample_ids):
    total_low = 0
    miss_low = 0
    for sid in sample_ids:
        f = sample_to_file.get(sid)
        if not f:
            continue
        df = pd.read_excel(f)
        body = df.iloc[1:].reset_index(drop=True)
        vaf = pd.to_numeric(body['Unnamed: 9'], errors='coerce')
        ann = body['Unnamed: 13'].astype(str)
        mask_low = vaf < 0.3
        total_low += mask_low.sum()
        miss_low += (mask_low & ann.str.contains('missense_variant')).sum()
    return total_low, miss_low

par_low, par_miss = count_low_missense(parents)
aff_low, aff_miss = count_low_missense(blm_affected)

par_freq = par_miss / par_low if par_low>0 else np.nan
aff_freq = aff_miss / aff_low if aff_low>0 else np.nan
print('parents', par_low, par_miss, par_freq)
print('affected', aff_low, aff_miss, aff_freq)
print('difference (affected - parent)', aff_freq - par_freq)

# Q3: non-reference exonic variants in CHIP genes after filtering
chip_genes = pd.read_excel(os.path.join(DATA_DIR, '230214_Schenz_et_al_2022_CHIP_Genes.xlsx'))
chip_set = set(chip_genes['ABL1'].astype(str))

nonref_exonic_chip_variants = 0

for f in files:
    df = pd.read_excel(f)
    body = df.iloc[1:].reset_index(drop=True)
    zyg = body[df.columns[4]].astype(str)  # proband column is 5th
    gene = body['RefSeq Genes 110, NCBI'].astype(str)
    so = body['Unnamed: 13'].astype(str)
    # non-reference: exclude 'Reference'
    mask_nonref = zyg != 'Reference'
    # exonic: exclude intron, intergenic, UTR
    mask_exonic = ~so.str.contains('intron_variant') & ~so.str.contains('intergenic') & ~so.str.contains('UTR')
    mask_chip = gene.isin(chip_set)
    count = (mask_nonref & mask_exonic & mask_chip).sum()
    nonref_exonic_chip_variants += count

print('Q3 total nonref exonic CHIP variants', nonref_exonic_chip_variants)
