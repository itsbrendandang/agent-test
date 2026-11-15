
# %% cell 0
import os, pandas as pd
print(os.environ['DATA_DIR'])
trio_path = os.path.join(os.environ['DATA_DIR'], '230215_Trio_Status.xlsx')
trio = pd.read_excel(trio_path)
print(trio.head())
print(trio.columns)

# %% cell 1
import os, pandas as pd, numpy as np

data_dir = os.environ['DATA_DIR']
chip_dir = os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS')

# get BLM mutation carriers
trio = pd.read_excel(os.path.join(data_dir, '230215_Trio_Status.xlsx'))
carriers = trio[trio['BLM Mutation Status']=='Carrier']
print('N carriers', len(carriers))

carrier_ids = set(carriers['Sample ID'].astype(str))

per_patient_counts = {}

for fname in os.listdir(chip_dir):
    if not fname.endswith('.xlsx'): continue
    sample = fname.split('_')[-1].split('.')[0]  # e.g. '179-P1' or 'SRR...'
    base = sample.split('-')[0]
    if base not in carrier_ids: continue
    path = os.path.join(chip_dir, fname)
    df = pd.read_excel(path)
    cols = [c for c in df.columns]
    # infer relevant columns
    # assume 'Consequence' for annotation, 'VAF' for allele frequency, 'Zygosity' for reference/hom/het
    conseq_col = next((c for c in cols if 'Consequence' in str(c)), None)
    vaf_col = next((c for c in cols if 'VAF' in str(c)), None)
    zyg_col = next((c for c in cols if 'Zygosity' in str(c)), None)
    print(fname, 'cols:', conseq_col, vaf_col, zyg_col)
    print(df.head(3))
    break

# %% cell 2
import os, pandas as pd

chip_path = os.path.join(os.environ['DATA_DIR'], 'CHIP_DP10_GQ20_PASS', '230209_Exome_GRCh38_CHIP_287-PM.xlsx')
df = pd.read_excel(chip_path, header=[0,1])
print(df.columns)
print(df.head())

# %% cell 3
import os, pandas as pd

chip_path = os.path.join(os.environ['DATA_DIR'], 'CHIP_DP10_GQ20_PASS', '230209_Exome_GRCh38_CHIP_287-PM.xlsx')
df = pd.read_excel(chip_path, header=[0,1])
print([col for col in df.columns if 'onsequence' in str(col)])
print([col for col in df.columns if 'AF ' in str(col) or 'VAF' in str(col)])
print([col for col in df.columns if 'Zygosity' in str(col)])
print(df.columns.tolist())

# %% cell 4
import os, pandas as pd, numpy as np

data_dir = os.environ['DATA_DIR']
chip_dir = os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS')
trio = pd.read_excel(os.path.join(data_dir, '230215_Trio_Status.xlsx'))
carriers = trio[trio['BLM Mutation Status']=='Carrier']
carrier_ids = set(carriers['Sample ID'].astype(str))

per_patient_counts = {}

for fname in os.listdir(chip_dir):
    if not fname.endswith('.xlsx'): continue
    sample = fname.split('_')[-1].split('.')[0]
    base = sample.split('-')[0]
    if base not in carrier_ids: continue
    df = pd.read_excel(os.path.join(chip_dir, fname), header=[0,1])
    # columns
    zyg_col = ('%s (%s)' % (trio.loc[trio['Sample ID']==int(base), 'Status'].iloc[0] if base.isdigit() else sample, sample), 'Zygosity') if ('%s (%s)' % (trio.loc[trio['Sample ID']==int(base), 'Status'].iloc[0] if base.isdigit() else sample, sample), 'Zygosity') in df.columns else None
    # but from example, patient '287-PM' has header 'Mother (287-PM)'
    # so just search second level name 'Zygosity'
    zyg_col = next((c for c in df.columns if c[1]=='Zygosity'), None)
    vaf_col = next((c for c in df.columns if 'Variant Allele Freq' in c[1]), None)
    conseq_col = next((c for c in df.columns if 'Sequence Ontology' in c[1]), None)

    if not (zyg_col and vaf_col and conseq_col):
        print('Missing columns for', fname, zyg_col, vaf_col, conseq_col)
        continue

    sub = df.copy()
    # exclude Intronic, Intergenic, UTR regions
    cons = sub[conseq_col].astype(str)
    mask_region = cons.str.contains('intronic', case=False) | cons.str.contains('intergenic', case=False) | cons.str.contains('UTR', case=False)
    sub = sub[~mask_region]
    # exclude Reference zygosity
    zyg = sub[zyg_col].astype(str)
    sub = sub[~zyg.str.contains('Reference', case=False)]
    # VAF <0.3
    vaf = pd.to_numeric(sub[vaf_col], errors='coerce')
    sub = sub[vaf < 0.3]
    per_patient_counts[sample] = len(sub)
    print(fname, sample, 'count', len(sub))

print('counts', per_patient_counts)

# map to Sample ID
patient_counts = {}
for sample, cnt in per_patient_counts.items():
    base = sample.split('-')[0]
    patient_counts.setdefault(base, 0)
    patient_counts[base] += cnt

print('patient_counts', patient_counts)

# median among carrier patients
vals = [v for k,v in patient_counts.items()]
print('median', np.median(vals))
