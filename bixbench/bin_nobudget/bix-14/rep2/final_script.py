
# %% cell 0
import os, pandas as pd
print(os.environ['DATA_DIR'])
status_path = os.path.join(os.environ['DATA_DIR'], '230215_Trio_Status.xlsx')
status = pd.read_excel(status_path)
print(status.head())
print(status.columns)

# %% cell 1
import os, pandas as pd
chip_genes_path = os.path.join(os.environ['DATA_DIR'], '230214_Schenz_et_al_2022_CHIP_Genes.xlsx')
chip_genes = pd.read_excel(chip_genes_path)
print(chip_genes.head())
print(chip_genes.columns)
print('n CHIP genes', len(chip_genes))

# %% cell 2
import os, pandas as pd, glob

status = pd.read_excel(os.path.join(os.environ['DATA_DIR'], '230215_Trio_Status.xlsx'))
status['Sample ID'] = status['Sample ID'].astype(str)
print(status['BLM Mutation Status'].value_counts())

files = glob.glob(os.path.join(os.environ['DATA_DIR'], 'CHIP_DP10_GQ20_PASS', '*.xlsx'))
print(len(files))
print(files[:5])

df_list = []
for f in files:
    sid = os.path.basename(f).split('_')[-1].split('.')[0]
    d = pd.read_excel(f)
    d['SampleID'] = sid
    df_list.append(d)

all_vars = pd.concat(df_list, ignore_index=True)
print(all_vars.head())
print(all_vars.columns)

# %% cell 3
import os, pandas as pd

status = pd.read_excel(os.path.join(os.environ['DATA_DIR'], '230215_Trio_Status.xlsx'))
status['Sample ID'] = status['Sample ID'].astype(str)

# map internal SampleID (e.g. 615-P1 or SRR...) to status table
sample_map = {}
for sid in status['Sample ID']:
    sample_map[str(sid)] = status.loc[status['Sample ID']==sid, 'BLM Mutation Status'].iloc[0]

print(sample_map.get('615-P1'))
print(status.head())

# %% cell 4
import os, pandas as pd, glob, re

status = pd.read_excel(os.path.join(os.environ['DATA_DIR'], '230215_Trio_Status.xlsx'))
status['Sample ID'] = status['Sample ID'].astype(str)

id_to_blm = dict(zip(status['Sample ID'], status['BLM Mutation Status']))

files = glob.glob(os.path.join(os.environ['DATA_DIR'], 'CHIP_DP10_GQ20_PASS', '*.xlsx'))

# inspect one file structure more closely
f = files[0]
print('Using file', f)
raw = pd.read_excel(f, header=None)
print(raw.head(10))
print('shape', raw.shape)


# %% cell 5
import os, pandas as pd, glob

files = glob.glob(os.path.join(os.environ['DATA_DIR'], 'CHIP_DP10_GQ20_PASS', '*.xlsx'))

f = files[0]
raw = pd.read_excel(f, header=None)
header = raw.iloc[0]
df = raw[1:].copy()
df.columns = header
print(df.head())
print(df.columns)


# %% cell 6
import os, pandas as pd, glob

# load trio status
data_dir = os.environ['DATA_DIR']
status = pd.read_excel(os.path.join(data_dir, '230215_Trio_Status.xlsx'))
status['Sample ID'] = status['Sample ID'].astype(str)

# determine CHIP genes set
chip_genes = pd.read_excel(os.path.join(data_dir, '230214_Schenz_et_al_2022_CHIP_Genes.xlsx'))
chip_set = set(chip_genes.iloc[:,0].astype(str))

files = glob.glob(os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS', '*.xlsx'))

# helper to parse a single file and return tidy long format
all_long = []
for f in files:
    raw = pd.read_excel(f, header=None)
    header = raw.iloc[0]
    df = raw[1:].copy()
    df.columns = header

    # basic variant annotations
    var = pd.DataFrame()
    var['ChrPos'] = df['Variant Info']
    var['RefAlt'] = df.iloc[:,1]
    var['Flags'] = df['Flags']

    # gene info column name contains 'RefSeq Genes'
    gene_col = [c for c in df.columns if isinstance(c,str) and 'RefSeq Genes' in c]
    var['Genes'] = df[gene_col[0]] if gene_col else None

    # functional annotation roughly in next column
    func_col = df.columns[df.columns.get_loc(gene_col[0])+1] if gene_col else None
    var['Func'] = df[func_col] if func_col is not None else None

    # per-sample genotype/VAF columns: those containing '(' and ')' and not in annotations
    sample_cols = [c for c in df.columns if isinstance(c,str) and '(' in c and ')' in c and 'Proband' in c or 'Father' in c or 'Mother' in c or 'SRR' in c]

    for c in sample_cols:
        sname = c
        vals = df[c].astype(str)
        # expecting like '0/1:DP:ADref,ADalt:VAF' etc; get last colon-separated field as VAF
        vaf = vals.str.split(':').str[-1]
        # coerce to float, invalid to NaN
        vaf = pd.to_numeric(vaf, errors='coerce')
        tmp = var.copy()
        tmp['SampleCol'] = c
        tmp['VAF'] = vaf
        all_long.append(tmp)

long = pd.concat(all_long, ignore_index=True)
print(long.head())
print(long['Func'].value_counts().head(20))


# %% cell 7
import os, pandas as pd, glob

data_dir = os.environ['DATA_DIR']
files = glob.glob(os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS', '*.xlsx'))

raw = pd.read_excel(files[0], header=None)
header = raw.iloc[0]
df = raw[1:].copy()
df.columns = header
print(df.columns)

# print a few columns around gene annotation
cols = list(df.columns)
for i,c in enumerate(cols):
    if isinstance(c,str) and 'RefSeq Genes' in c:
        print('gene col index', i, c)
        print('neighbors:', cols[i-3:i+5])
        break

print(df.iloc[0:5, 10:25])

# %% cell 8
import os, pandas as pd, glob, numpy as np

data_dir = os.environ['DATA_DIR']
status = pd.read_excel(os.path.join(data_dir, '230215_Trio_Status.xlsx'))
status['Sample ID'] = status['Sample ID'].astype(str)

chip_genes = pd.read_excel(os.path.join(data_dir, '230214_Schenz_et_al_2022_CHIP_Genes.xlsx'))
chip_set = set(chip_genes.iloc[:,0].astype(str))

files = glob.glob(os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS', '*.xlsx'))

long_records = []

for f in files:
    raw = pd.read_excel(f, header=None)
    header = raw.iloc[0]
    df = raw[1:].copy()
    df.columns = header

    base = pd.DataFrame()
    base['ChrPos'] = df['Variant Info']
    base['RefAlt'] = df.iloc[:,1]
    base['Flags'] = df['Flags']

    # gene and func
    gene_col = [c for c in df.columns if isinstance(c,str) and 'RefSeq Genes' in c][0]
    base['Genes'] = df[gene_col]
    # assume next non-nan col is functional consequence
    gene_idx = list(df.columns).index(gene_col)
    func_col = None
    for j in range(gene_idx+1, min(gene_idx+5, len(df.columns))):
        if isinstance(df.columns[j], str):
            func_col = df.columns[j]
            break
    base['Func'] = df[func_col] if func_col else np.nan

    # per-file proband ID from filename
    fname = os.path.basename(f)
    pid = fname.split('_')[-1].split('.')[0]
    sample_col = [c for c in df.columns if isinstance(c,str) and 'Proband' in c][0]
    vals = df[sample_col].astype(str)
    vaf = pd.to_numeric(vals.str.split(':').str[-1], errors='coerce')

    tmp = base.copy()
    tmp['SampleID'] = pid
    tmp['VAF'] = vaf
    long_records.append(tmp)

long = pd.concat(long_records, ignore_index=True)
print(long.head())
print(long['Func'].value_counts().head())

# map proband IDs (numeric part before dash) to trio status Sample ID
long['NumericID'] = long['SampleID'].str.extract(r'^(\d+)').iloc[:,0]
long = long.merge(status[['Sample ID','BLM Mutation Status','Status']], left_on='NumericID', right_on='Sample ID', how='left', suffixes=('','_status'))
print(long[['SampleID','NumericID','BLM Mutation Status','Status']].drop_duplicates().head(20))

# Q1: BLM mutation carrier cohort "Carrier" in status
carriers = long[long['BLM Mutation Status']=='Carrier']
sub = carriers[carriers['VAF']<0.3]
# annotate synonymous by Func containing 'synonymous'
is_syn = sub['Func'].astype(str).str.contains('synonymous', case=False, na=False)
frac_syn = is_syn.mean()
print('Q1 fraction', frac_syn, 'n=', len(sub))

# Q2: parental control group = Status Father or Mother & Unaffected? assume BLM Mutation Status == 'Unaffected'
parent_ctrl = long[(long['Status'].isin(['Father','Mother'])) & (long['BLM Mutation Status']=='Unaffected') & (long['VAF']<0.3)]
affected = long[(long['BLM Mutation Status']=='Affected') & (long['Status']=='Patient') & (long['VAF']<0.3)]

miss_parent = parent_ctrl['Func'].astype(str).str.contains('missense', case=False, na=False).mean()
miss_aff = affected['Func'].astype(str).str.contains('missense', case=False, na=False).mean()
print('missense freq parent', miss_parent, 'n', len(parent_ctrl))
print('missense freq affected', miss_aff, 'n', len(affected))
print('difference aff - parent', miss_aff-miss_parent)

# Q3: after filtering out reference, intronic/intergenic/UTR, count non-ref exonic variants in CHIP genes

# define non-reference: Flags not containing 'Homozygous_Ref' etc, and VAF>0?
nonref = long[ (long['VAF']>0) ]

# region filtering via Func
func = nonref['Func'].astype(str)
mask_exonic = ~func.str.contains('intronic|intergenic|UTR', case=False, na=False)
nonref_exonic = nonref[mask_exonic]

# restrict to CHIP genes (Genes col may contain multiple genes; match any)
genes = nonref_exonic['Genes'].astype(str)
mask_chip = genes.apply(lambda x: any(g in chip_set for g in x.replace(';',',').split(',')))
chip_vars = nonref_exonic[mask_chip]

print('Q3 count', chip_vars['ChrPos'].nunique())

# %% cell 9
import os, pandas as pd, glob, numpy as np

data_dir = os.environ['DATA_DIR']
files = glob.glob(os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS', '*.xlsx'))

# inspect column names per file to see proband/sample columns
for f in files[:10]:
    raw = pd.read_excel(f, header=None)
    header = raw.iloc[0]
    df = raw[1:].copy(); df.columns = header
    print('\nFile', os.path.basename(f))
    print([c for c in df.columns if isinstance(c,str) and any(k in c for k in ['Proband','Father','Mother','SRR'])])

# %% cell 10
import os, pandas as pd, glob, numpy as np

data_dir = os.environ['DATA_DIR']
status = pd.read_excel(os.path.join(data_dir, '230215_Trio_Status.xlsx'))
status['Sample ID'] = status['Sample ID'].astype(str)
chip_genes = pd.read_excel(os.path.join(data_dir, '230214_Schenz_et_al_2022_CHIP_Genes.xlsx'))
chip_set = set(chip_genes.iloc[:,0].astype(str))

files = glob.glob(os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS', '*.xlsx'))

records = []

for f in files:
    raw = pd.read_excel(f, header=None)
    header = raw.iloc[0]
    df = raw[1:].copy(); df.columns = header

    base = pd.DataFrame()
    base['ChrPos'] = df['Variant Info']
    base['RefAlt'] = df.iloc[:,1]
    base['Flags'] = df['Flags']

    gene_col = [c for c in df.columns if isinstance(c,str) and 'RefSeq Genes' in c][0]
    base['Genes'] = df[gene_col]

    gene_idx = list(df.columns).index(gene_col)
    func_col = None
    for j in range(gene_idx+1, min(gene_idx+5, len(df.columns))):
        if isinstance(df.columns[j], str):
            func_col = df.columns[j]
            break
    base['Func'] = df[func_col] if func_col else np.nan

    sample_cols = [c for c in df.columns if isinstance(c,str) and any(k in c for k in ['Proband','Father','Mother','Child'])]
    for c in sample_cols:
        vals = df[c].astype(str)
        vaf = pd.to_numeric(vals.str.split(':').str[-1], errors='coerce')
        tmp = base.copy()
        tmp['SampleCol'] = c
        tmp['VAF'] = vaf
        # extract sample ID within parentheses
        tmp['SampleID'] = tmp['SampleCol'].str.extract(r'\(([^)]+)\)').iloc[:,0]
        records.append(tmp)

long = pd.concat(records, ignore_index=True)

# map SampleID numeric part to trio status
long['NumericID'] = long['SampleID'].str.extract(r'^(\d+)').iloc[:,0]
long = long.merge(status[['Sample ID','BLM Mutation Status','Status']], left_on='NumericID', right_on='Sample ID', how='left')

print(long.head())
print(long[['SampleID','NumericID','BLM Mutation Status','Status']].drop_duplicates().head(30))

# Q1
carriers = long[long['BLM Mutation Status']=='Carrier']
sub = carriers[carriers['VAF']<0.3]
print('carrier <0.3 n', len(sub))
issyn = sub['Func'].astype(str).str.contains('synonymous', case=False, na=False)
print('syn count', issyn.sum())
frac_syn = issyn.mean()
print('Q1 fraction', frac_syn)

# Q2
parent_ctrl = long[(long['Status'].isin(['Father','Mother'])) & (long['BLM Mutation Status']=='Unaffected') & (long['VAF']<0.3)]
affected = long[(long['BLM Mutation Status']=='Affected') & (long['Status']=='Patient') & (long['VAF']<0.3)]
miss_parent = parent_ctrl['Func'].astype(str).str.contains('missense', case=False, na=False).mean()
miss_aff = affected['Func'].astype(str).str.contains('missense', case=False, na=False).mean()
print('parent missense freq', miss_parent, 'n', len(parent_ctrl))
print('affected missense freq', miss_aff, 'n', len(affected))
print('difference (affected - parent)', miss_aff - miss_parent)

# Q3
nonref = long[long['VAF']>0]
func = nonref['Func'].astype(str)
mask_exonic = ~func.str.contains('intronic|intergenic|UTR', case=False, na=False)
nonref_exonic = nonref[mask_exonic]

# restrict to CHIP genes
genes = nonref_exonic['Genes'].astype(str)
mask_chip = genes.apply(lambda x: any(g in chip_set for g in x.replace(';',',').split(',')))
chip_vars = nonref_exonic[mask_chip]

print('Q3 count unique ChrPos per sample', chip_vars[['ChrPos','SampleID']].drop_duplicates().shape[0])

# %% cell 11
import os, pandas as pd, glob, numpy as np

data_dir = os.environ['DATA_DIR']
files = glob.glob(os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS', '*.xlsx'))

# Inspect Func column values more directly
f = files[0]
raw = pd.read_excel(f, header=None)
header = raw.iloc[0]
df = raw[1:].copy(); df.columns = header

gene_col = [c for c in df.columns if isinstance(c,str) and 'RefSeq Genes' in c][0]
idx = list(df.columns).index(gene_col)
print('around gene col headers:', list(df.columns)[idx:idx+6])
print(df.iloc[:10, idx:idx+6])

# %% cell 12
import os, pandas as pd, glob, numpy as np

data_dir = os.environ['DATA_DIR']
files = glob.glob(os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS', '*.xlsx'))

f = files[0]
raw = pd.read_excel(f, header=None)
header = raw.iloc[0]
df = raw[1:].copy(); df.columns = header

# find functional consequence by searching text in whole row for 'missense','synonymous'
func_terms = []
for i,row in df.iterrows():
    txt = ' '.join(str(x) for x in row.values)
    if 'missense' in txt.lower():
        func_terms.append('missense')
    elif 'synonymous' in txt.lower():
        func_terms.append('synonymous')
    else:
        func_terms.append('other')

print(func_terms[:20])

# %% cell 13
import os, pandas as pd, glob, numpy as np

data_dir = os.environ['DATA_DIR']
status = pd.read_excel(os.path.join(data_dir, '230215_Trio_Status.xlsx'))
status['Sample ID'] = status['Sample ID'].astype(str)
chip_genes = pd.read_excel(os.path.join(data_dir, '230214_Schenz_et_al_2022_CHIP_Genes.xlsx'))
chip_set = set(chip_genes.iloc[:,0].astype(str))

files = glob.glob(os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS', '*.xlsx'))

records = []

for f in files:
    raw = pd.read_excel(f, header=None)
    header = raw.iloc[0]
    df = raw[1:].copy(); df.columns = header

    base = pd.DataFrame()
    base['ChrPos'] = df['Variant Info']
    base['RefAlt'] = df.iloc[:,1]
    base['Flags'] = df['Flags']

    gene_col = [c for c in df.columns if isinstance(c,str) and 'RefSeq Genes' in c][0]
    base['Genes'] = df[gene_col]

    # derive Func_free by scanning row text
    func_terms = []
    for _,row in df.iterrows():
        txt = ' '.join(str(x) for x in row.values).lower()
        if 'missense' in txt:
            func_terms.append('missense')
        elif 'synonymous' in txt:
            func_terms.append('synonymous')
        elif any(t in txt for t in ['intron','intronic']):
            func_terms.append('intronic')
        elif 'intergenic' in txt:
            func_terms.append('intergenic')
        elif 'utr' in txt:
            func_terms.append('utr')
        else:
            func_terms.append('other')
    base['Func'] = func_terms

    sample_cols = [c for c in df.columns if isinstance(c,str) and any(k in c for k in ['Proband','Father','Mother','Child'])]
    for c in sample_cols:
        vals = df[c].astype(str)
        vaf = pd.to_numeric(vals.str.split(':').str[-1], errors='coerce')
        tmp = base.copy()
        tmp['SampleCol'] = c
        tmp['VAF'] = vaf
        tmp['SampleID'] = tmp['SampleCol'].str.extract(r'\(([^)]+)\)').iloc[:,0]
        records.append(tmp)

long = pd.concat(records, ignore_index=True)
long['NumericID'] = long['SampleID'].str.extract(r'^(\d+)').iloc[:,0]
long = long.merge(status[['Sample ID','BLM Mutation Status','Status']], left_on='NumericID', right_on='Sample ID', how='left')

print(long.head())
print(long['Func'].value_counts())

# Q1
carriers = long[long['BLM Mutation Status']=='Carrier']
sub = carriers[carriers['VAF']<0.3]
issyn = sub['Func']=='synonymous'
print('Q1 n<0.3 carriers', len(sub), 'syn', issyn.sum())
frac_syn = issyn.mean() if len(sub)>0 else float('nan')
print('Q1 fraction', frac_syn)

# Q2
parent_ctrl = long[(long['Status'].isin(['Father','Mother'])) & (long['BLM Mutation Status']=='Unaffected') & (long['VAF']<0.3)]
affected = long[(long['BLM Mutation Status']=='Affected') & (long['Status']=='Patient') & (long['VAF']<0.3)]
miss_parent = (parent_ctrl['Func']=='missense').mean() if len(parent_ctrl)>0 else float('nan')
miss_aff = (affected['Func']=='missense').mean() if len(affected)>0 else float('nan')
print('parent missense freq', miss_parent, 'n', len(parent_ctrl))
print('affected missense freq', miss_aff, 'n', len(affected))
print('Q2 difference', miss_aff-miss_parent)

# Q3
nonref = long[long['VAF']>0]
mask_exonic = ~nonref['Func'].isin(['intronic','intergenic','utr'])
nonref_exonic = nonref[mask_exonic]

mask_chip = nonref_exonic['Genes'].astype(str).apply(lambda x: any(g in chip_set for g in x.replace(';',',').split(',')))
chip_vars = nonref_exonic[mask_chip]

print('Q3 count variants rows', len(chip_vars))
print('Q3 unique variant+sample', chip_vars[['ChrPos','SampleID']].drop_duplicates().shape[0])


# %% cell 14
import os, pandas as pd, glob, numpy as np

data_dir = os.environ['DATA_DIR']
status = pd.read_excel(os.path.join(data_dir, '230215_Trio_Status.xlsx'))
status['Sample ID'] = status['Sample ID'].astype(str)
chip_genes = pd.read_excel(os.path.join(data_dir, '230214_Schenz_et_al_2022_CHIP_Genes.xlsx'))
chip_set = set(chip_genes.iloc[:,0].astype(str))

files = glob.glob(os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS', '*.xlsx'))

records = []

for f in files:
    raw = pd.read_excel(f, header=None)
    header = raw.iloc[0]
    df = raw[1:].copy(); df.columns = header

    base = pd.DataFrame()
    base['ChrPos'] = df['Variant Info']
    base['RefAlt'] = df.iloc[:,1]
    base['Flags'] = df['Flags']
    gene_col = [c for c in df.columns if isinstance(c,str) and 'RefSeq Genes' in c][0]
    base['Genes'] = df[gene_col]

    func_terms = []
    for _,row in df.iterrows():
        txt = ' '.join(str(x) for x in row.values).lower()
        if 'missense' in txt:
            func_terms.append('missense')
        elif 'synonymous' in txt:
            func_terms.append('synonymous')
        elif any(t in txt for t in ['intron','intronic']):
            func_terms.append('intronic')
        elif 'intergenic' in txt:
            func_terms.append('intergenic')
        elif 'utr' in txt:
            func_terms.append('utr')
        else:
            func_terms.append('other')
    base['Func'] = func_terms

    sample_cols = [c for c in df.columns if isinstance(c,str) and any(k in c for k in ['Proband','Father','Mother','Child'])]
    for c in sample_cols:
        vals = df[c].astype(str)
        vaf = pd.to_numeric(vals.str.split(':').str[-1], errors='coerce')
        tmp = base.copy()
        tmp['SampleCol'] = c
        tmp['VAF'] = vaf
        tmp['SampleID'] = tmp['SampleCol'].str.extract(r'\(([^)]+)\)').iloc[:,0]
        records.append(tmp)

long = pd.concat(records, ignore_index=True)
print(long.columns)
print(long.head())

# map status
long['NumericID'] = long['SampleID'].str.extract(r'^(\d+)').iloc[:,0]
long = long.merge(status[['Sample ID','BLM Mutation Status','Status']], left_on='NumericID', right_on='Sample ID', how='left')
print(long.columns)
print(long.head())

# recompute Q1-3 without errors
# Q1
carriers = long[long['BLM Mutation Status']=='Carrier']
sub = carriers[carriers['VAF']<0.3]
issyn = sub['Func']=='synonymous'
frac_syn = issyn.mean() if len(sub)>0 else float('nan')
print('Q1: n', len(sub), 'frac', frac_syn)

# Q2
parent_ctrl = long[(long['Status'].isin(['Father','Mother'])) & (long['BLM Mutation Status']=='Unaffected') & (long['VAF']<0.3)]
affected = long[(long['BLM Mutation Status']=='Affected') & (long['Status']=='Patient') & (long['VAF']<0.3)]
miss_parent = (parent_ctrl['Func']=='missense').mean() if len(parent_ctrl)>0 else float('nan')
miss_aff = (affected['Func']=='missense').mean() if len(affected)>0 else float('nan')
print('Q2: parent n', len(parent_ctrl), 'freq', miss_parent)
print('Q2: affected n', len(affected), 'freq', miss_aff)
print('Q2 diff', miss_aff-miss_parent)

# Q3
nonref = long[long['VAF']>0]
mask_exonic = ~nonref['Func'].isin(['intronic','intergenic','utr'])
nonref_exonic = nonref[mask_exonic]

mask_chip = nonref_exonic['Genes'].astype(str).apply(lambda x: any(g in chip_set for g in x.replace(';',',').split(',')))
chip_vars = nonref_exonic[mask_chip]
print('Q3 non-ref exonic chip variants count', chip_vars.shape[0])
