
# %% cell 0
import os, pandas as pd
print(os.environ['DATA_DIR'])

trio_path = os.path.join(os.environ['DATA_DIR'], '230215_Trio_Status.xlsx')
trio = pd.read_excel(trio_path)
print(trio.head())

chip_gene_path = os.path.join(os.environ['DATA_DIR'], '230214_Schenz_et_al_2022_CHIP_Genes.xlsx')
chip_genes = pd.read_excel(chip_gene_path)
print(chip_genes.head())

chip_dir = os.path.join(os.environ['DATA_DIR'], 'CHIP_DP10_GQ20_PASS')
files = sorted(os.listdir(chip_dir))
print(len(files), 'vcf-like excel files')

sample = pd.read_excel(os.path.join(chip_dir, files[0]))
print(sample.columns)
print(sample.head())

# %% cell 1
import os, pandas as pd
chip_gene_path = os.path.join(os.environ['DATA_DIR'], '230214_Schenz_et_al_2022_CHIP_Genes.xlsx')
chip_genes = pd.read_excel(chip_gene_path, header=None)[0].astype(str).str.strip().tolist()
print(len(chip_genes), chip_genes[:10])

trio = pd.read_excel(os.path.join(os.environ['DATA_DIR'], '230215_Trio_Status.xlsx'))
print(trio['BLM Mutation Status'].value_counts())

chip_dir = os.path.join(os.environ['DATA_DIR'], 'CHIP_DP10_GQ20_PASS')
files = sorted(os.listdir(chip_dir))

all_rows = []
for f in files:
    sample_id = f.split('_')[-1].replace('.xlsx','')
    df = pd.read_excel(os.path.join(chip_dir,f))
    # keep CHIP gene variants
    df = df[df['RefSeq Genes 110, NCBI'].astype(str).str.contains('|'.join(chip_genes))]
    # parse genotype in proband column (5th col)
    geno_col = df.columns[4]
    s = df[geno_col].astype(str)
    non_ref = s.str.contains('0/0')==False
    df = df[non_ref]
    # annotation column near end for consequence
    ann_col = 'Match String List'
    conseq = df[ann_col].astype(str)
    # filter non-intronic/intergenic/UTR
    mask = ~conseq.str.contains('intronic|intergenic|UTR', case=False, na=False)
    df = df[mask]
    df['sample_id'] = sample_id
    all_rows.append(df[['sample_id']])

all_df = pd.concat(all_rows, ignore_index=True)
print('Total CHIP variants after filters:', len(all_df))
print('Average per sample:', all_df.groupby('sample_id').size().mean())

# bring in BLM status
trio['Sample key'] = trio['Sample ID'].astype(str)+'-'+trio['Status'].str[0]
counts = all_df['sample_id'].value_counts().rename_axis('Sample key').reset_index(name='n_chip')
merged = counts.merge(trio, on='Sample key', how='left')
print(merged.head())
print(merged['BLM Mutation Status'].value_counts())

# %% cell 2
import os, pandas as pd, numpy as np, re

data_dir = os.environ['DATA_DIR']
chip_genes = pd.read_excel(os.path.join(data_dir,'230214_Schenz_et_al_2022_CHIP_Genes.xlsx'), header=None)[0].astype(str).str.strip().tolist()

chip_dir = os.path.join(data_dir,'CHIP_DP10_GQ20_PASS')
files = sorted(os.listdir(chip_dir))

rows = []
for f in files:
    sample_key = f.split('CHIP_')[1].replace('.xlsx','')
    df = pd.read_excel(os.path.join(chip_dir,f))
    gene_col = 'RefSeq Genes 110, NCBI'
    df = df[df[gene_col].astype(str).apply(lambda x: any(g in x.split(';') for g in chip_genes))]
    geno_col = df.columns[4]
    gt = df[geno_col].astype(str)
    df = df[~gt.str.startswith('0/0')]
    ann = df['Match String List'].astype(str)
    mask = ~ann.str.contains('intronic|intergenic|UTR', flags=re.IGNORECASE, na=False)
    df = df[mask]
    df['Sample key'] = sample_key
    rows.append(df[['Sample key']])

chip_df = pd.concat(rows, ignore_index=True)
print('variants after filters:', len(chip_df))
print('avg per sample:', chip_df.groupby('Sample key').size().mean())

trio = pd.read_excel(os.path.join(data_dir,'230215_Trio_Status.xlsx'))
trio['Sample key'] = trio['Sample ID'].astype(str)+'-'+trio['Status'].str[0]

sample_counts = chip_df.groupby('Sample key').size().rename('n_chip').reset_index()
merged = sample_counts.merge(trio[['Sample key','BLM Mutation Status']], on='Sample key', how='left')
print(merged['BLM Mutation Status'].value_counts(dropna=False))

# Define groups
control = merged[merged['BLM Mutation Status'].isna()]['n_chip']

results = {}
for status in ['Unaffected','Carrier','Affected']:
    grp = merged[merged['BLM Mutation Status']==status]['n_chip']
    if len(grp)==0: continue
    from scipy.stats import mannwhitneyu
    stat, p = mannwhitneyu(grp, control, alternative='two-sided')
    results[status] = (len(grp), stat, p)

print('MW results vs control:', results)

# %% cell 3
import os, pandas as pd, re

data_dir = os.environ['DATA_DIR']
chip_genes = pd.read_excel(os.path.join(data_dir,'230214_Schenz_et_al_2022_CHIP_Genes.xlsx'), header=None)[0].astype(str).str.strip().tolist()
chip_dir = os.path.join(data_dir,'CHIP_DP10_GQ20_PASS')
files = sorted(os.listdir(chip_dir))

rows_all = []
rows_filtered = []
for f in files:
    sample_key = f.split('CHIP_')[1].replace('.xlsx','')
    df = pd.read_excel(os.path.join(chip_dir,f))
    gene_col = 'RefSeq Genes 110, NCBI'
    df_gene = df[df[gene_col].astype(str).apply(lambda x: any(g in x.split(';') for g in chip_genes))]
    geno_col = df_gene.columns[4]
    gt = df_gene[geno_col].astype(str)
    non_ref_mask = ~gt.str.startswith('0/0')
    # Q3 all CHIP variants non-ref exome
    df_all = df_gene[non_ref_mask].copy()
    df_all['Sample key'] = sample_key
    rows_all.append(df_all[['Sample key']])
    # Q2 filtered for consequence
    ann = df_all['Match String List'].astype(str)
    mask = ~ann.str.contains('intronic|intergenic|UTR', flags=re.IGNORECASE, na=False)
    df_filt = df_all[mask].copy()
    df_filt['Sample key'] = sample_key
    rows_filtered.append(df_filt[['Sample key']])

all_chip = pd.concat(rows_all, ignore_index=True)
filtered_chip = pd.concat(rows_filtered, ignore_index=True)
print('Q3 total non-ref CHIP variants:', len(all_chip))
print('Q2 variants after anno filter:', len(filtered_chip))
print('Q2 avg per sample:', filtered_chip.groupby('Sample key').size().mean())
