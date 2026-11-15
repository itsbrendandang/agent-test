
# %% cell 0
import os, pandas as pd
print(os.environ['DATA_DIR'])
status_path = os.path.join(os.environ['DATA_DIR'], '230215_Trio_Status.xlsx')
status = pd.read_excel(status_path)
print(status.head()); print(status.columns); print(status['BLM mutation status'].value_counts(dropna=False))

# %% cell 1
import os, pandas as pd
chip_dir = os.path.join(os.environ['DATA_DIR'], 'CHIP_DP10_GQ20_PASS')
files = sorted(f for f in os.listdir(chip_dir) if f.endswith('.xlsx'))
print(len(files))
first = pd.read_excel(os.path.join(chip_dir, files[0]))
print(files[0])
print(first.head())
print(first.columns)

# %% cell 2
import os, pandas as pd
chip_genes_path = os.path.join(os.environ['DATA_DIR'], '12031_230214_Schenz_et_al_2022_CHIP_Genes.xlsx')
chip_genes = pd.read_excel(chip_genes_path)
print(chip_genes.head()); print(chip_genes.columns); print(len(chip_genes))

# %% cell 3
import os, pandas as pd
chip_genes_path = os.path.join(os.environ['DATA_DIR'], '230214_Schenz_et_al_2022_CHIP_Genes.xlsx')
chip_genes = pd.read_excel(chip_genes_path)
print(chip_genes.head()); print(chip_genes.columns); print(len(chip_genes))

status_path = os.path.join(os.environ['DATA_DIR'], '230215_Trio_Status.xlsx')
status = pd.read_excel(status_path)
print(status['BLM Mutation Status'].value_counts(dropna=False))

# %% cell 4
import os, pandas as pd, numpy as np
chip_dir = os.path.join(os.environ['DATA_DIR'], 'CHIP_DP10_GQ20_PASS')
files = sorted(f for f in os.listdir(chip_dir) if f.endswith('.xlsx'))
print(len(files))

# inspect one file more
fpath = os.path.join(chip_dir, files[0])
df = pd.read_excel(fpath)
print(df.head())
print(df.iloc[0])

# %% cell 5
import os, pandas as pd, numpy as np
chip_dir = os.path.join(os.environ['DATA_DIR'], 'CHIP_DP10_GQ20_PASS')
files = sorted(f for f in os.listdir(chip_dir) if f.endswith('.xlsx'))

# build mapping sample id -> status row
status_path = os.path.join(os.environ['DATA_DIR'], '230215_Trio_Status.xlsx')
status = pd.read_excel(status_path)
status['Sample ID'] = status['Sample ID'].astype(str)
status_map = status.set_index('Sample ID').to_dict(orient='index')

chip_genes_path = os.path.join(os.environ['DATA_DIR'], '230214_Schenz_et_al_2022_CHIP_Genes.xlsx')
chip_genes = pd.read_excel(chip_genes_path)
chip_genes_list = set(chip_genes.iloc[:,0].astype(str))

syn_count_lowvaf = 0
lowvaf_total_carrier = 0

missense_lowvaf_by_group = {'Carrier_parental_controls':0, 'Affected_BSyn_probands':0}
lowvaf_counts_group = {'Carrier_parental_controls':0, 'Affected_BSyn_probands':0}

chip_exonic_nonref_total = 0

for fname in files:
    fpath = os.path.join(chip_dir, fname)
    df = pd.read_excel(fpath)
    header = df.iloc[0]
    df = df[1:].copy()
    df.columns = header
    # get sample id from filename
    base = fname.split('_CHIP_')[1].split('.xlsx')[0]
    sample_id = base.split('-')[0].split('SRR')[-1]  # for SRR and numeric
    srow = status_map.get(sample_id)

    # common columns
    gene_col = 'Gene Names'
    effect_col = 'Effect (Combined)'
    so_col = 'Sequence Ontology (Combined)'
    vaf_col = 'Variant Allele Freq'
    zyg_col = 'Zygosity'

    # filter low VAF
    df[vaf_col] = pd.to_numeric(df[vaf_col], errors='coerce')
    lowvaf = df[df[vaf_col] < 0.3]

    # Q1: among BLM carriers only
    if srow and srow['BLM Mutation Status'] == 'Carrier':
        lowvaf_total_carrier += len(lowvaf)
        syn = lowvaf[so_col].astype(str).str.contains('synonymous', case=False, na=False)
        syn_count_lowvaf += syn.sum()

    # define groups for Q2
    group = None
    if srow:
        if srow['BLM Mutation Status'] == 'Carrier' and srow['Status'] in ['Father','Mother']:
            group = 'Carrier_parental_controls'
        elif srow['BLM Mutation Status'] == 'Affected' and srow['Status'] == 'Patient':
            group = 'Affected_BSyn_probands'
    if group:
        lowvaf_counts_group[group] += len(lowvaf)
        missense = lowvaf[effect_col].astype(str).str.contains('missense', case=False, na=False)
        missense_lowvaf_by_group[group] += missense.sum()

    # Q3: CHIP genes, exonic, non-reference
    in_chip = df[gene_col].astype(str).apply(lambda x: any(g in chip_genes_list for g in str(x).split(', ')))
    df_chip = df[in_chip].copy()
    # exonic: exclude intronic, intergenic, UTR
    so = df_chip[so_col].astype(str).str.lower()
    exonic_mask = ~so.str.contains('intron', na=False) & ~so.str.contains('utr', na=False) & ~so.str.contains('intergenic', na=False)
    df_chip_exonic = df_chip[exonic_mask].copy()
    # non-reference: zygosity not 'HomRef'
    nonref = df_chip_exonic[zyg_col].astype(str).str.contains('HomRef', case=False, na=False) == False
    chip_exonic_nonref_total += nonref.sum()

print('Q1 syn_count_lowvaf, total_lowvaf_carrier', syn_count_lowvaf, lowvaf_total_carrier)
print('Q2 missense_lowvaf_by_group', missense_lowvaf_by_group)
print('Q2 lowvaf_counts_group', lowvaf_counts_group)
print('Q3 chip_exonic_nonref_total', chip_exonic_nonref_total)
