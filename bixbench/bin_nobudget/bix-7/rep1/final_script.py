
# %% cell 0
import os, pandas as pd
from glob import glob

data_dir = os.environ['DATA_DIR']
chip_dir = os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS')
files = sorted(glob(os.path.join(chip_dir, '*.xlsx')))
print(len(files))
print(os.path.basename(files[0]))

df_list = []
for f in files:
    d = pd.read_excel(f)
    d['sample_file'] = os.path.basename(f)
    df_list.append(d)
all_df = pd.concat(df_list, ignore_index=True)
print(all_df.columns)
print(all_df.head())
all_df.to_pickle('all_chip.pkl')


# %% cell 1
import os, pandas as pd

data_dir = os.environ['DATA_DIR']
print(pd.read_excel(os.path.join(data_dir, '230215_Trio_Status.xlsx')).head())


# %% cell 2
import pandas as pd
all_df = pd.read_pickle('all_chip.pkl')
print(all_df.iloc[:10, :12])


# %% cell 3
import pandas as pd
all_df = pd.read_pickle('all_chip.pkl')
# header row where Variant Info == 'Chr:Pos'
header_mask = all_df['Variant Info'] == 'Chr:Pos'
print(header_mask.sum())

# drop those
df = all_df[~header_mask].copy()
# split Variant Info
chrom = df['Variant Info'].str.split(':', expand=True)[0]
pos = df['Variant Info'].str.split(':', expand=True)[1]
df['CHROM'] = chrom
df['POS'] = pos.astype(int)
# ref/alt
refalt = df['Unnamed: 1'].str.split('/', expand=True)
df['REF'] = refalt[0]
df['ALT'] = refalt[1]

print(df[['CHROM','POS','REF','ALT']].head())

trio = pd.read_excel(os.path.join(os.environ['DATA_DIR'],'230215_Trio_Status.xlsx'))
print(trio['BLM Mutation Status'].value_counts())


# %% cell 4
import os, pandas as pd
trio = pd.read_excel(os.path.join(os.environ['DATA_DIR'],'230215_Trio_Status.xlsx'))
print(trio['BLM Mutation Status'].value_counts())

# %% cell 5
import os, pandas as pd

all_df = pd.read_pickle('all_chip.pkl')
# identify genotype columns for samples: they have parentheses in name
sample_cols = [c for c in all_df.columns if '(' in c and ')' in c]
print(len(sample_cols))
print(sample_cols[:10])

trio = pd.read_excel(os.path.join(os.environ['DATA_DIR'],'230215_Trio_Status.xlsx'))
# map Sample ID to BLM Mutation Status
status_map = dict(zip(trio['Sample ID'].astype(str), trio['BLM Mutation Status']))

# function to extract sample ID from column name such as 'Proband (179-P1)' or 'Father (SRR5566906)'
import re
col_sample = {}
for c in sample_cols:
    m = re.search(r'\(([^)]+)\)', c)
    if m:
        sid = m.group(1)
        col_sample[c] = sid

print(list(col_sample.items())[:10])

# restrict to exome non-reference calls: I assume entries like '0/1', '1/1' denote variants; ref '0/0' or NaN

# construct long format per sample-variant

header_mask = all_df['Variant Info'] == 'Chr:Pos'
df = all_df[~header_mask].copy()

records = []
for c in sample_cols:
    sid = col_sample[c]
    status = status_map.get(sid.split('-')[0], None) if '-' in sid else status_map.get(sid, None)
    # genotype codes
    g = df[c]
    # non-reference: not NaN and not '0/0'
    mask = g.notna() & (g != '0/0')
    sub = df.loc[mask, ['Variant Info','Unnamed: 1']].copy()
    sub['sample_col'] = c
    sub['SampleID_raw'] = sid
    sub['BLM_status'] = status
    records.append(sub)

long = pd.concat(records, ignore_index=True)
print(long.head())
print(long['BLM_status'].value_counts(dropna=False))
long.to_pickle('long_variants.pkl')


# %% cell 6
import pandas as pd
long = pd.read_pickle('long_variants.pkl')

# identify CHIP variants via gene list
import os
chip_genes = pd.read_excel(os.path.join(os.environ['DATA_DIR'],'230214_Schenz_et_al_2022_CHIP_Genes.xlsx'))
print(chip_genes.head())

# need gene annotation in all_df
all_df = pd.read_pickle('all_chip.pkl')
print(all_df.columns[:30])


# %% cell 7
import pandas as pd
import os

all_df = pd.read_pickle('all_chip.pkl')
header_mask = all_df['Variant Info']=='Chr:Pos'
df = all_df[~header_mask].copy()

chip_genes = pd.read_excel(os.path.join(os.environ['DATA_DIR'],'230214_Schenz_et_al_2022_CHIP_Genes.xlsx'))
chip_set = set(chip_genes.iloc[:,0].astype(str))

# RefSeq Genes col contains annotations like 'GENE:details;GENE2:details'; take gene symbols before ':'
ann = df['RefSeq Genes 110, NCBI'].astype(str)
primary_gene = ann.str.split(';').str[0].str.split(':').str[0].str.strip()
df['gene'] = primary_gene

chip_mask = df['gene'].isin(chip_set)
print(chip_mask.sum(), 'CHIP rows among variant rows (per-variant, not per-sample)')

# merge chip_mask into long based on Variant Info and ref/alt
long = pd.read_pickle('long_variants.pkl')
key = ['Variant Info','Unnamed: 1']
chip_keys = df.loc[chip_mask, key].drop_duplicates()
chip_keys['is_chip'] = True

long_chip = long.merge(chip_keys, on=key, how='inner')
print(long_chip.head())
print('total CHIP sample-variant records:', len(long_chip))

long_chip.to_pickle('long_chip.pkl')


# %% cell 8
import pandas as pd

long = pd.read_pickle('long_variants.pkl')

# identify reference calls: genotype=='0/0'
# need to reconstruct including ref calls; previously long excluded them. We'll recompute.
import os
all_df = pd.read_pickle('all_chip.pkl')
header_mask = all_df['Variant Info']=='Chr:Pos'
df = all_df[~header_mask].copy()

sample_cols = [c for c in all_df.columns if '(' in c and ')' in c]

# reconstruct long with genotype
import re
recs = []
for c in sample_cols:
    m = re.search(r'\(([^)]+)\)', c)
    sid = m.group(1)
    g = df[c]
    sub = df[['Variant Info','Unnamed: 1']].copy()
    sub['sample_col'] = c
    sub['SampleID_raw'] = sid
    sub['GT'] = g.astype(str)
    recs.append(sub)
long2 = pd.concat(recs, ignore_index=True)

# mark CHIP
chip_df = pd.read_pickle('long_chip.pkl')
chip_keys = chip_df[['Variant Info','Unnamed: 1']].drop_duplicates()
chip_keys['is_chip'] = True
long2 = long2.merge(chip_keys, on=['Variant Info','Unnamed: 1'], how='left')
long2['is_chip'] = long2['is_chip'].fillna(False)

# Q3: CHIP variants after removing reference calls: genotype not '0/0' and is_chip
nonref_chip = long2[long2['is_chip'] & (long2['GT']!='0/0')]
print('Q3 count sample-variants:', len(nonref_chip))

# unique variant sites (Chr:Pos + ref/alt)
nonref_chip_sites = nonref_chip[['Variant Info','Unnamed: 1']].drop_duplicates()
print('unique CHIP sites:', len(nonref_chip_sites))

nonref_chip.to_pickle('nonref_chip.pkl')


# %% cell 9
import pandas as pd, os

# bring in BLM status per sample
trio = pd.read_excel(os.path.join(os.environ['DATA_DIR'],'230215_Trio_Status.xlsx'))
status_map = dict(zip(trio['Sample ID'].astype(str), trio['BLM Mutation Status']))

nonref_chip = pd.read_pickle('nonref_chip.pkl')

# derive sample ID key to map
import re

sid_keys = {}
for s in nonref_chip['SampleID_raw'].unique():
    sid = s
    key = sid.split('-')[0]
    sid_keys[sid] = key

nonref_chip['SampleID_key'] = nonref_chip['SampleID_raw'].map(sid_keys)
nonref_chip['BLM_status'] = nonref_chip['SampleID_key'].map(status_map)

print(nonref_chip['BLM_status'].value_counts(dropna=False))

# need per-sample CHIP variant counts
sample_counts = nonref_chip.groupby('SampleID_raw').size().rename('chip_count').reset_index()

# add BLM status
sample_counts['SampleID_key'] = sample_counts['SampleID_raw'].map(sid_keys)
sample_counts['BLM_status'] = sample_counts['SampleID_key'].map(status_map)
print(sample_counts.head())
print(sample_counts['BLM_status'].value_counts(dropna=False))

# overall average number of CHIP variants per sample (q2) after region filtering will be later

sample_counts.to_pickle('sample_chip_counts.pkl')


# %% cell 10
import pandas as pd

sample_counts = pd.read_pickle('sample_chip_counts.pkl')

# Exclude samples with NaN BLM_status
sc = sample_counts.dropna(subset=['BLM_status']).copy()
print(sc['BLM_status'].value_counts())

# compute mean chip_count per group
print(sc.groupby('BLM_status')['chip_count'].describe())

# compare each mutation group vs control (Unaffected) using, say, Wilcoxon rank-sum
from scipy.stats import mannwhitneyu

control = sc.loc[sc['BLM_status']=='Unaffected','chip_count']

results = {}
for grp in ['Carrier','Affected']:
    grp_vals = sc.loc[sc['BLM_status']==grp,'chip_count']
    stat, p = mannwhitneyu(grp_vals, control, alternative='two-sided')
    results[grp] = (stat,p)
print(results)


# %% cell 11
import pandas as pd

# Need to filter out intronic, intergenic, UTR variants.
# Use 'RefSeq Genes 110, NCBI' annotation, keep variants with 'exonic' or 'splicing' etc.

all_df = pd.read_pickle('all_chip.pkl')
header_mask = all_df['Variant Info']=='Chr:Pos'
df = all_df[~header_mask].copy()

ann = df['RefSeq Genes 110, NCBI'].astype(str)
print(ann.head(20))


# %% cell 12
import pandas as pd

# need effect annotation columns around Unnamed:13-18
all_df = pd.read_pickle('all_chip.pkl')
print(all_df.columns[12:25])
print(all_df.iloc[1,12:25])


# %% cell 13
import pandas as pd, os

# Rebuild long per-sample with functional annotation
all_df = pd.read_pickle('all_chip.pkl')
header_mask = all_df['Variant Info']=='Chr:Pos'
df = all_df[~header_mask].copy()

# add function annotation
func = df['Unnamed: 13'].astype(str)

# Determine which are exonic/splicing vs intronic/intergenic/UTR
keep_mask = ~(func.str.contains('intron', case=False) | func.str.contains('UTR', case=False) | func.str.contains('intergenic', case=False))
print(func.value_counts().head(20))
print('keep proportion', keep_mask.mean())

# rebuild CHIP nonref with this filter
import re
sample_cols = [c for c in all_df.columns if '(' in c and ')' in c]

rows = []
for c in sample_cols:
    m = re.search(r'\(([^)]+)\)', c)
    sid = m.group(1)
    g = df[c]
    mask = (g.notna()) & (g!='0/0') & keep_mask
    sub = df.loc[mask, ['Variant Info','Unnamed: 1']].copy()
    sub['SampleID_raw'] = sid
    rows.append(sub)
long_func = pd.concat(rows, ignore_index=True)

# CHIP gene filter
chip_genes = pd.read_excel(os.path.join(os.environ['DATA_DIR'],'230214_Schenz_et_al_2022_CHIP_Genes.xlsx'))
chip_set = set(chip_genes.iloc[:,0].astype(str))
ann = df['RefSeq Genes 110, NCBI'].astype(str)
primary_gene = ann.str.split(';').str[0].str.split(':').str[0].str.strip()
chip_mask = primary_gene.isin(chip_set)
chip_keys = df.loc[chip_mask & keep_mask, ['Variant Info','Unnamed: 1']].drop_duplicates()
chip_keys['is_chip'] = True

long_func = long_func.merge(chip_keys, on=['Variant Info','Unnamed: 1'], how='inner')
print('functional CHIP sample-variants:', len(long_func))

# Q2 average number per sample
per_sample = long_func.groupby('SampleID_raw').size()
print('Q2 mean per sample:', per_sample.mean())


# %% cell 14
import pandas as pd, os

# Q1 using functional-filtered counts
trio = pd.read_excel(os.path.join(os.environ['DATA_DIR'],'230215_Trio_Status.xlsx'))
status_map = dict(zip(trio['Sample ID'].astype(str), trio['BLM Mutation Status']))

long_func = pd.read_pickle('long_chip.pkl') if False else None
# Actually recompute per_sample with filter result from previous cell


# %% cell 15
import pandas as pd, os, re

# Recreate long_func to also keep sample IDs
all_df = pd.read_pickle('all_chip.pkl')
header_mask = all_df['Variant Info']=='Chr:Pos'
df = all_df[~header_mask].copy()

func = df['Unnamed: 13'].astype(str)
keep_mask = ~(func.str.contains('intron', case=False) | func.str.contains('UTR', case=False) | func.str.contains('intergenic', case=False))

sample_cols = [c for c in all_df.columns if '(' in c and ')' in c]
rows = []
for c in sample_cols:
    m = re.search(r'\(([^)]+)\)', c)
    sid = m.group(1)
    g = df[c]
    mask = (g.notna()) & (g!='0/0') & keep_mask
    sub = df.loc[mask, ['Variant Info','Unnamed: 1']].copy()
    sub['SampleID_raw'] = sid
    rows.append(sub)
long_func = pd.concat(rows, ignore_index=True)

chip_genes = pd.read_excel(os.path.join(os.environ['DATA_DIR'],'230214_Schenz_et_al_2022_CHIP_Genes.xlsx'))
chip_set = set(chip_genes.iloc[:,0].astype(str))
ann = df['RefSeq Genes 110, NCBI'].astype(str)
primary_gene = ann.str.split(';').str[0].str.split(':').str[0].str.strip()
chip_mask = primary_gene.isin(chip_set)
chip_keys = df.loc[chip_mask & keep_mask, ['Variant Info','Unnamed: 1']].drop_duplicates()
chip_keys['is_chip'] = True

long_func = long_func.merge(chip_keys, on=['Variant Info','Unnamed: 1'], how='inner')

# map BLM status
trio = pd.read_excel(os.path.join(os.environ['DATA_DIR'],'230215_Trio_Status.xlsx'))
status_map = dict(zip(trio['Sample ID'].astype(str), trio['BLM Mutation Status']))

sid_key = long_func['SampleID_raw'].str.split('-').str[0]
long_func['BLM_status'] = sid_key.map(status_map)

per_sample = long_func.groupby(['SampleID_raw','BLM_status']).size().rename('chip_count').reset_index()
print(per_sample.head())
print(per_sample['BLM_status'].value_counts(dropna=False))
from scipy.stats import mannwhitneyu

control = per_sample.loc[per_sample['BLM_status']=='Unaffected','chip_count']
results = {}
for grp in ['Carrier','Affected']:
    grp_vals = per_sample.loc[per_sample['BLM_status']==grp,'chip_count']
    stat, p = mannwhitneyu(grp_vals, control, alternative='two-sided')
    results[grp] = p
print('p-values:', results)

