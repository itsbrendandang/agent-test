
# %% cell 0
import os, pandas as pd
print(os.environ['DATA_DIR'])
status_path = os.path.join(os.environ['DATA_DIR'], '230215_Trio_Status.xlsx')
print(pd.read_excel(status_path).head())

# %% cell 1
import os, pandas as pd, glob

data_dir = os.environ['DATA_DIR']
chip_dir = os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS')
files = glob.glob(os.path.join(chip_dir, '*.xlsx'))
print(len(files))
print(files[0])

df_list = []
for f in files:
    d = pd.read_excel(f)
    d['Sample_ID'] = os.path.basename(f).split('_')[-1].replace('.xlsx','')
    df_list.append(d)
chip = pd.concat(df_list, ignore_index=True)
print(chip.columns)
print(chip.head())
print(chip['Func.refGene'].value_counts().head())
print('total_variants', len(chip))

# %% cell 2
import os, pandas as pd, glob

data_dir = os.environ['DATA_DIR']
chip_dir = os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS')
files = glob.glob(os.path.join(chip_dir, '*.xlsx'))

sample_dfs = {}
for f in files:
    sample = os.path.basename(f).split('_')[-1].replace('.xlsx','')
    d = pd.read_excel(f, sheet_name=1)  # second sheet often annotations
    d['Sample_ID'] = sample
    sample_dfs[sample] = d

some = next(iter(sample_dfs.values()))
print(some.columns)
print(some.head())

# %% cell 3
import os, pandas as pd, glob

data_dir = os.environ['DATA_DIR']
chip_dir = os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS')
files = glob.glob(os.path.join(chip_dir, '*.xlsx'))

f = files[0]
print(f)
print(pd.read_excel(f, nrows=10))

# %% cell 4
import os, pandas as pd, glob

data_dir = os.environ['DATA_DIR']
chip_dir = os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS')
files = glob.glob(os.path.join(chip_dir, '*.xlsx'))

f = files[0]
full = pd.read_excel(f)
print(full.columns)
print(full.iloc[0])

# %% cell 5
import os, pandas as pd, glob

data_dir = os.environ['DATA_DIR']
chip_dir = os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS')
files = glob.glob(os.path.join(chip_dir, '*.xlsx'))

all_records = []
for f in files:
    df = pd.read_excel(f)
    header = df.iloc[0]
    df2 = df[1:].copy()
    df2.columns = header
    sample = os.path.basename(f).split('_')[-1].replace('.xlsx','')
    df2['Sample_ID'] = sample
    all_records.append(df2)

chip = pd.concat(all_records, ignore_index=True)
print(chip.columns)
print(chip[['Chr:Pos','Ref/Alt','Gene Names','Sequence Ontology (Combined)','In_CHIP']].head())
print('total', len(chip))

# %% cell 6
import os, pandas as pd

data_dir = os.environ['DATA_DIR']
status = pd.read_excel(os.path.join(data_dir, '230215_Trio_Status.xlsx'))
print(status['BLM Mutation Status'].value_counts())
print(status.head())

# %% cell 7
import os, pandas as pd

data_dir = os.environ['DATA_DIR']
status = pd.read_excel(os.path.join(data_dir, '230215_Trio_Status.xlsx'))

# map sample identifiers between status sheet and CHIP files
print(status['Sample ID'].head(20))

# %% cell 8
import os, glob

data_dir = os.environ['DATA_DIR']
chip_dir = os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS')
files = glob.glob(os.path.join(chip_dir, '*.xlsx'))
print(sorted([os.path.basename(f) for f in files])[:20])

# %% cell 9
import os, pandas as pd

data_dir = os.environ['DATA_DIR']
chip = pd.read_excel(os.path.join(data_dir,'CHIP_DP10_GQ20_PASS','230209_Exome_GRCh38_CHIP_179-P1.xlsx'))
header = chip.iloc[0]
chip2 = chip[1:].copy(); chip2.columns = header
print(chip2['Sequence Ontology (Combined)'].value_counts().head(20))

# %% cell 10
import os, pandas as pd, glob

data_dir = os.environ['DATA_DIR']
chip_dir = os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS')
files = glob.glob(os.path.join(chip_dir, '*.xlsx'))

all_records = []
for f in files:
    df = pd.read_excel(f)
    header = df.iloc[0]
    df2 = df[1:].copy(); df2.columns = header
    sample = os.path.basename(f).split('_')[-1].replace('.xlsx','')
    df2['Sample_File_ID'] = sample
    all_records.append(df2)

chip = pd.concat(all_records, ignore_index=True)
print('total_variants_before_ref_filter', len(chip))

# identify reference calls: Variant Allele Freq == 0 or Zygosity == '0/0' or similar
print(chip['Zygosity'].value_counts().head(10))

# Try to see a few entries
print(chip[['Chr:Pos','Ref/Alt','Zygosity','Variant Allele Freq']].head(20))

# %% cell 11
import os, pandas as pd, glob

data_dir = os.environ['DATA_DIR']
chip_dir = os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS')
files = glob.glob(os.path.join(chip_dir, '*.xlsx'))

all_records = []
for f in files:
    df = pd.read_excel(f)
    header = df.iloc[0]
    df2 = df[1:].copy(); df2.columns = header
    sample = os.path.basename(f).split('_')[-1].replace('.xlsx','')
    df2['Sample_File_ID'] = sample
    all_records.append(df2)

chip = pd.concat(all_records, ignore_index=True)

# remove reference calls
chip_nonref = chip[chip['Zygosity'] != 'Reference'].copy()
print('variants_after_removing_reference', len(chip_nonref))

# map Sample_File_ID to Trio Sample ID
status = pd.read_excel(os.path.join(data_dir, '230215_Trio_Status.xlsx'))

# build mapping from numeric ID to BLM status, per role
status['Sample ID'] = status['Sample ID'].astype(str)
print(status.head())

# Extract numeric and role from Sample_File_ID, e.g., '179-P1' -> '179', 'P1'
chip_nonref['SampleNum'] = chip_nonref['Sample_File_ID'].str.extract(r'^(\d+)', expand=False)
print(chip_nonref[['Sample_File_ID','SampleNum']].drop_duplicates().head(20))

chip_merged = chip_nonref.merge(status, left_on='SampleNum', right_on='Sample ID', how='left')
print(chip_merged['BLM Mutation Status'].value_counts(dropna=False))


# %% cell 12
import os, pandas as pd, glob

data_dir = os.environ['DATA_DIR']
chip_dir = os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS')
files = glob.glob(os.path.join(chip_dir, '*.xlsx'))

all_records = []
for f in files:
    df = pd.read_excel(f)
    header = df.iloc[0]
    df2 = df[1:].copy(); df2.columns = header
    sample = os.path.basename(f).split('_')[-1].replace('.xlsx','')
    df2['Sample_File_ID'] = sample
    all_records.append(df2)

chip = pd.concat(all_records, ignore_index=True)
chip_nonref = chip[chip['Zygosity'] != 'Reference'].copy()

# filter to CHIP genes only (In_CHIP == True)
chip_nonref = chip_nonref[chip_nonref['In_CHIP'] == True].copy()
print('nonref_chip_variants', len(chip_nonref))

# add annotation category from Sequence Ontology
so = chip_nonref['Sequence Ontology (Combined)']
print(so.value_counts().head(20))

# Filter out intronic, intergenic, and UTR variants for exome non-reference question
mask_exome = ~so.str.contains('intron|UTR|intergenic', case=False, na=False)
chip_exome = chip_nonref[mask_exome].copy()
print('exome_chip_variants', len(chip_exome))

# map sample numbers and BLM status
status = pd.read_excel(os.path.join(data_dir,'230215_Trio_Status.xlsx'))
status['Sample ID'] = status['Sample ID'].astype(str)
chip_exome['SampleNum'] = chip_exome['Sample_File_ID'].str.extract(r'^(\d+)', expand=False)
chip_exome = chip_exome.merge(status, left_on='SampleNum', right_on='Sample ID', how='left')
print(chip_exome['BLM Mutation Status'].value_counts(dropna=False))

# define control as Unaffected
chip_exome = chip_exome[chip_exome['BLM Mutation Status'].notna()].copy()

# count variants per sample
per_sample = chip_exome.groupby(['Sample_File_ID','BLM Mutation Status']).size().reset_index(name='n_variants')
print(per_sample.head(20))

# average number of CHIP variants per sample (after exonic filtering)
avg = per_sample['n_variants'].mean()
print('average_chip_variants_per_sample_exome', avg)

# compare CHIP variant frequency between BLM groups using Poisson regression
import statsmodels.api as sm
import numpy as np

# total variants and offset=1 (since counts per sample, same exposure)
# encode BLM status with Unaffected as reference
per_sample['is_carrier'] = (per_sample['BLM Mutation Status'] == 'Carrier').astype(int)
per_sample['is_affected'] = (per_sample['BLM Mutation Status'] == 'Affected').astype(int)

X = per_sample[['is_carrier','is_affected']]
X = sm.add_constant(X)
y = per_sample['n_variants']
poisson_model = sm.GLM(y, X, family=sm.families.Poisson()).fit()
print(poisson_model.summary())

pvals = poisson_model.pvalues
print('pvals vs control:', pvals)

sig_groups = [g for g,p in [('Carrier',pvals['is_carrier']), ('Affected',pvals['is_affected'])] if p < 0.05]
print('significant_groups', sig_groups)


# %% cell 13
import os, pandas as pd, glob

data_dir = os.environ['DATA_DIR']
chip_dir = os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS')
files = glob.glob(os.path.join(chip_dir, '*.xlsx'))

all_records = []
for f in files:
    df = pd.read_excel(f)
    header = df.iloc[0]
    df2 = df[1:].copy(); df2.columns = header
    sample = os.path.basename(f).split('_')[-1].replace('.xlsx','')
    df2['Sample_File_ID'] = sample
    all_records.append(df2)

chip = pd.concat(all_records, ignore_index=True)
chip_nonref = chip[chip['Zygosity'] != 'Reference'].copy()

# exonic definition for q2: filter out intronic, intergenic and UTR only
so = chip_nonref['Sequence Ontology (Combined)'].astype(str)
mask_exome = ~so.str.contains('intron|UTR|intergenic', case=False, na=False)
chip_exome = chip_nonref[mask_exome].copy()
print('nonref_total', len(chip_nonref))
print('after_exome_filter', len(chip_exome))

# average CHIP variants per sample after this filter (note: these are NOT yet restricted to CHIP genes)
per_sample_all = chip_exome.groupby('Sample_File_ID').size().reset_index(name='n_variants')
print(per_sample_all.head())
print('average_per_sample', per_sample_all['n_variants'].mean())

# %% cell 14
import os, pandas as pd, glob

data_dir = os.environ['DATA_DIR']
chip_dir = os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS')
files = glob.glob(os.path.join(chip_dir, '*.xlsx'))

all_records = []
for f in files:
    df = pd.read_excel(f)
    header = df.iloc[0]
    df2 = df[1:].copy(); df2.columns = header
    sample = os.path.basename(f).split('_')[-1].replace('.xlsx','')
    df2['Sample_File_ID'] = sample
    all_records.append(df2)

chip = pd.concat(all_records, ignore_index=True)

print('total_variants_all', len(chip))

chip_nonref = chip[chip['Zygosity'] != 'Reference'].copy()
print('total_variants_after_removing_reference', len(chip_nonref))

# CHIP genes only
chip_nonref_chip = chip_nonref[chip_nonref['In_CHIP'] == True].copy()
print('chip_variants_nonref', len(chip_nonref_chip))
