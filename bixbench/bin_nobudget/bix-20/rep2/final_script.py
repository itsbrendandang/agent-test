
# %% cell 0
import os, pandas as pd
print(os.environ['DATA_DIR'])
meta = pd.read_excel(os.path.join(os.environ['DATA_DIR'], '230215_Trio_Status.xlsx'))
print(meta.head())
print(meta.columns)


# %% cell 1
import os, pandas as pd, glob

data_dir = os.environ['DATA_DIR']
chip_dir = os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS')
fn = glob.glob(os.path.join(chip_dir, '*.xlsx'))[0]
print(fn)
df = pd.read_excel(fn)
print(df.head())
print(df.columns)


# %% cell 2
import os, pandas as pd, glob
from collections import Counter

data_dir = os.environ['DATA_DIR']
chip_dir = os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS')
meta = pd.read_excel(os.path.join(data_dir, '230215_Trio_Status.xlsx'))

status_map = {}
for sample_id, status, blm in zip(meta['Sample ID'], meta['Status'], meta['BLM Mutation Status']):
    for suffix in ['-P','-P1','-P2','-PM','-PF']:
        status_map[f"{sample_id}{suffix}"] = {'Status': status, 'BLM': blm}

regions_counter = Counter()
acmg_counter = Counter()
clinvar_counter = Counter()

for path in glob.glob(os.path.join(chip_dir, '*.xlsx')):
    base = os.path.basename(path)
    sample_code = base.split('_CHIP_')[1].replace('.xlsx','')
    info = status_map.get(sample_code)
    if not info:
        continue
    df = pd.read_excel(path)
    reg_col = 'RefSeq Genes 110, NCBI'
    acmg_col = 'Match ACMG SF v3.0'
    clin_col = 'ClinVar 2023-01-05, NCBI'
    regions_counter.update(df[reg_col].astype(str).head(20))
    acmg_counter.update(df[acmg_col].astype(str).head(20))
    clinvar_counter.update(df[clin_col].astype(str).head(20))

print('Regions example:', regions_counter.most_common(20))
print('ACMG example:', acmg_counter.most_common(20))
print('ClinVar example:', clinvar_counter.most_common(20))


# %% cell 3
import os, pandas as pd, glob

data_dir = os.environ['DATA_DIR']
chip_dir = os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS')

path = glob.glob(os.path.join(chip_dir, '*615-P1.xlsx'))[0]
df = pd.read_excel(path)
print(df.columns)
print(df.iloc[0:10,[0,1,2,3,4,10,12,19,24]])


# %% cell 4
import os, pandas as pd, glob

data_dir = os.environ['DATA_DIR']
chip_dir = os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS')

path = glob.glob(os.path.join(chip_dir, '*615-P1.xlsx'))[0]
df = pd.read_excel(path, header=1)
print(df.columns)
print(df[['Variant Info','Unnamed: 1','Flags','Proband (615-P1)','RefSeq Genes 110, NCBI']].head())


# %% cell 5
import os, pandas as pd, glob

data_dir = os.environ['DATA_DIR']
chip_dir = os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS')

path = glob.glob(os.path.join(chip_dir, '*615-P1.xlsx'))[0]
raw = pd.read_excel(path, header=None)
print(raw.head(5))


# %% cell 6
import os, pandas as pd, glob

data_dir = os.environ['DATA_DIR']
chip_dir = os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS')

path = glob.glob(os.path.join(chip_dir, '*615-P1.xlsx'))[0]
raw = pd.read_excel(path, header=None)
header = raw.iloc[1]
df = raw[2:]
df.columns = header
print(df[['Chr:Pos','Ref/Alt','Read Depths (DP)','Genotype Qualities (GQ)','Variant Allele Freq','Gene Names','Sequence Ontology (Combined)','Effect (Combined)','Variant ID','Classification']].head())


# %% cell 7
import os, pandas as pd, glob

data_dir = os.environ['DATA_DIR']
chip_dir = os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS')
meta = pd.read_excel(os.path.join(data_dir, '230215_Trio_Status.xlsx'))

status_map = {}
for sample_id, status, blm in zip(meta['Sample ID'], meta['Status'], meta['BLM Mutation Status']):
    for suffix in ['-P','-P1','-P2','-PM','-PF']:
        status_map[f"{sample_id}{suffix}"] = {'Status': status, 'BLM': blm}


import re

def classify_group(sample_code, info):
    status = info['Status']
    blm = info['BLM']
    if blm == 'Affected':
        return 'BSyn Probands'
    if blm == 'Carrier':
        return 'Carrier'
    if (pd.isna(blm) or blm == 'Control') and status == 'Patient':
        return 'Control'
    if status in ['Mother','Father']:
        return 'Parents'
    return None


def process_file(path, info):
    raw = pd.read_excel(path, header=None)
    if raw.shape[0] < 3:
        return pd.DataFrame()
    header = raw.iloc[1]
    df = raw[2:].copy()
    df.columns = header
    # drop reference / non-variant: AF==0 or Alt Allele Count 0?
    # Determine AF and VAF columns
    vaf_col = 'Variant Allele Freq'
    af_col = 'Alt Allele Freq (AF)'
    # coerce numeric
    for col in [vaf_col, af_col]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')
    # filter VAF < 0.3
    df = df[df[vaf_col] < 0.3]
    # filter out intronic, intergenic, UTR
    so_col = 'Sequence Ontology (Combined)'
    if so_col in df.columns:
        mask = True
        so = df[so_col].astype(str).str.lower()
        for bad in ['intronic','intergenic','utr']:
            mask &= ~so.str.contains(bad)
        df = df[mask]
    # filter out reference / non-variant calls: AF==0
    if af_col in df.columns:
        df = df[df[af_col] > 0]
    # classify benign
    class_col = 'Classification'
    if class_col in df.columns:
        cl = df[class_col].astype(str).str.lower()
        benign_mask = cl.isin(['benign','likely benign'])
        df['is_benign'] = benign_mask
    else:
        df['is_benign'] = False
    return df[['Chr:Pos','Ref/Alt','Variant Allele Freq','Sequence Ontology (Combined)','Alt Allele Freq (AF)','Variant ID','Classification','is_benign']]


stats = { 'BSyn Probands': {'benign':0,'total':0},
          'Control': {'benign':0,'total':0},
          'Carrier': {'benign':0,'total':0},
          'Parents': {'benign':0,'total':0}}

for path in glob.glob(os.path.join(chip_dir, '*.xlsx')):
    base = os.path.basename(path)
    sample_code = base.split('_CHIP_')[1].replace('.xlsx','')
    info = status_map.get(sample_code)
    if not info:
        continue
    group = classify_group(sample_code, info)
    if not group:
        continue
    df = process_file(path, info)
    if df.empty:
        continue
    stats[group]['total'] += len(df)
    stats[group]['benign'] += df['is_benign'].sum()

print(stats)
for g, d in stats.items():
    if d['total']>0:
        print(g, d['benign']/d['total'])


# %% cell 8
import os, pandas as pd, glob

data_dir = os.environ['DATA_DIR']
chip_dir = os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS')
meta = pd.read_excel(os.path.join(data_dir, '230215_Trio_Status.xlsx'))
print(meta)


# %% cell 9
import os, pandas as pd, glob

data_dir = os.environ['DATA_DIR']
chip_dir = os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS')
meta = pd.read_excel(os.path.join(data_dir, '230215_Trio_Status.xlsx'))

status_map = {}
for sample_id, status, blm in zip(meta['Sample ID'], meta['Status'], meta['BLM Mutation Status']):
    for suffix in ['-P','-P1','-P2','-PM','-PF']:
        status_map[f"{sample_id}{suffix}"] = {'Status': status, 'BLM': blm}


import re

def classify_group(sample_code, info):
    status = info['Status']
    blm = info['BLM']
    if blm == 'Affected':
        return 'BSyn Probands'
    if blm == 'Carrier':
        return 'Carrier'
    if (blm in ['Unaffected', 'Control']) and status == 'Patient':
        return 'Control'
    if status in ['Mother','Father']:
        return 'Parents'
    return None


def process_file(path, info):
    raw = pd.read_excel(path, header=None)
    if raw.shape[0] < 3:
        return pd.DataFrame()
    header = raw.iloc[1]
    df = raw[2:].copy()
    df.columns = header
    vaf_col = 'Variant Allele Freq'
    af_col = 'Alt Allele Freq (AF)'
    so_col = 'Sequence Ontology (Combined)'
    class_col = 'Classification'
    for col in [vaf_col, af_col]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')
    if vaf_col not in df.columns:
        return pd.DataFrame()
    df = df[df[vaf_col] < 0.3]
    if so_col in df.columns:
        so = df[so_col].astype(str).str.lower()
        bad_mask = so.str.contains('intronic') | so.str.contains('intergenic') | so.str.contains('utr')
        df = df[~bad_mask]
    if af_col in df.columns:
        df = df[df[af_col] > 0]
    if class_col in df.columns:
        cl = df[class_col].astype(str).str.lower()
        benign_mask = cl.isin(['benign','likely benign'])
        df = df[~cl.isin(['nan',''])]
        df['is_benign'] = benign_mask
    else:
        return pd.DataFrame()
    return df

stats = { 'BSyn Probands': {'benign':0,'total':0},
          'Control': {'benign':0,'total':0},
          'Carrier': {'benign':0,'total':0},
          'Parents': {'benign':0,'total':0}}

for path in glob.glob(os.path.join(chip_dir, '*.xlsx')):
    base = os.path.basename(path)
    sample_code = base.split('_CHIP_')[1].replace('.xlsx','')
    info = status_map.get(sample_code)
    if not info:
        continue
    group = classify_group(sample_code, info)
    if not group:
        continue
    df = process_file(path, info)
    if df.empty:
        continue
    stats[group]['total'] += len(df)
    stats[group]['benign'] += df['is_benign'].sum()

print(stats)
for g, d in stats.items():
    if d['total']>0:
        print(g, d['benign']/d['total'])


# %% cell 10
import os, pandas as pd, glob

data_dir = os.environ['DATA_DIR']
chip_dir = os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS')

files = sorted(glob.glob(os.path.join(chip_dir, '*.xlsx')))
print(len(files))
for p in files:
    base = os.path.basename(p)
    code = base.split('_CHIP_')[1].replace('.xlsx','')
    print(code)


# %% cell 11
import os, pandas as pd, glob

data_dir = os.environ['DATA_DIR']
meta = pd.read_excel(os.path.join(data_dir, '230215_Trio_Status.xlsx'))
print(meta[['Sample ID','Status','BLM Mutation Status']])


# %% cell 12
import os, pandas as pd, glob

data_dir = os.environ['DATA_DIR']
chip_dir = os.path.join(data_dir, 'CHIP_DP10_GQ20_PASS')
meta = pd.read_excel(os.path.join(data_dir, '230215_Trio_Status.xlsx'))

meta['BLM Mutation Status'] = meta['BLM Mutation Status'].fillna('')

status_map = {}
for sample_id, status, blm in zip(meta['Sample ID'], meta['Status'], meta['BLM Mutation Status']):
    for suffix in ['-P','-P1','-P2','-PM','-PF']:
        status_map[f"{sample_id}{suffix}"] = {'Status': status, 'BLM': blm}


def classify_group_q(sample_code, info):
    status = info['Status']
    blm = info['BLM']
    if blm == 'Affected':
        return 'q1'
    if blm == 'Carrier':
        return 'q3'
    if status in ['Mother','Father']:
        return 'q4'
    if blm in ['Unaffected',''] and status == 'Patient':
        return 'q2'
    return None


def process_file(path):
    raw = pd.read_excel(path, header=None)
    if raw.shape[0] < 3:
        return pd.DataFrame()
    header = raw.iloc[1]
    df = raw[2:].copy()
    df.columns = header
    vaf_col = 'Variant Allele Freq'
    af_col = 'Alt Allele Freq (AF)'
    so_col = 'Sequence Ontology (Combined)'
    class_col = 'Classification'
    for col in [vaf_col, af_col]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')
    if vaf_col not in df.columns:
        return pd.DataFrame()
    df = df[df[vaf_col] < 0.3]
    if so_col in df.columns:
        so = df[so_col].astype(str).str.lower()
        bad_mask = so.str.contains('intronic') | so.str.contains('intergenic') | so.str.contains('utr')
        df = df[~bad_mask]
    if af_col in df.columns:
        df = df[df[af_col] > 0]
    if class_col in df.columns:
        cl = df[class_col].astype(str)
        df = df[~cl.isin(['nan',''])]
        cl = df[class_col].astype(str).str.lower()
        benign_mask = cl.isin(['benign','likely benign'])
        df['is_benign'] = benign_mask
    else:
        return pd.DataFrame()
    return df

stats = {'q1':{'benign':0,'total':0}, 'q2':{'benign':0,'total':0}, 'q3':{'benign':0,'total':0}, 'q4':{'benign':0,'total':0}}

for path in glob.glob(os.path.join(chip_dir, '*.xlsx')):
    base = os.path.basename(path)
    sample_code = base.split('_CHIP_')[1].replace('.xlsx','')
    info = status_map.get(sample_code)
    if not info:
        continue
    q = classify_group_q(sample_code, info)
    if not q:
        continue
    df = process_file(path)
    if df.empty:
        continue
    stats[q]['total'] += len(df)
    stats[q]['benign'] += df['is_benign'].sum()

print(stats)
for k,v in stats.items():
    if v['total']>0:
        print(k, v['benign']/v['total'])

