
# %% cell 0
import os, pandas as pd
print(os.environ['DATA_DIR'])
meta = pd.read_excel(os.path.join(os.environ['DATA_DIR'], '230215_Trio_Status.xlsx'))
print(meta.columns)
print(meta.head())

# %% cell 1
import os, pandas as pd, numpy as np
DATA_DIR=os.environ['DATA_DIR']
meta = pd.read_excel(os.path.join(DATA_DIR, '230215_Trio_Status.xlsx'))
meta['Sample ID']=meta['Sample ID'].astype(str)

chip_dir=os.path.join(DATA_DIR,'CHIP_DP10_GQ20_PASS')

# inspect one variant file
f=os.listdir(chip_dir)[0]
df=pd.read_excel(os.path.join(chip_dir,f))
print(f)
print(df.columns)
print(df.head())

# %% cell 2
import os, pandas as pd, numpy as np
DATA_DIR=os.environ['DATA_DIR']
meta = pd.read_excel(os.path.join(DATA_DIR, '230215_Trio_Status.xlsx'))
meta['Sample ID']=meta['Sample ID'].astype(str)

chip_dir=os.path.join(DATA_DIR,'CHIP_DP10_GQ20_PASS')

# function to parse per-sample file
import re

def load_sample(fname):
    sid=re.search(r'CHIP_(.*).xlsx', fname).group(1)
    df=pd.read_excel(os.path.join(chip_dir,fname))
    # drop header row 0
    df=df.iloc[1:].reset_index(drop=True)
    # parse sample col name
    sample_col=[c for c in df.columns if c.startswith('Proband')][0]
    sc=df[sample_col].astype(str)
    # filter out reference calls: assuming genotype and VAF encoded like '0/1;0.12'
    gt_vaf=sc.str.split(';',expand=True)
    if gt_vaf.shape[1]<2:
        return sid, pd.DataFrame()
    df['GT']=gt_vaf[0]
    df['VAF']=pd.to_numeric(gt_vaf[1], errors='coerce')
    # non-reference: GT not 0/0
    df=df[df['GT']!='0/0']
    # VAF <0.3
    df=df[df['VAF']<0.3]
    # annotation columns
    func_col='Unnamed: 13'
    clnsig_col='Unnamed: 27'
    df['Func']=df[func_col].astype(str)
    df['ClinSig']=df[clnsig_col].astype(str)
    # filter regions
    mask=~df['Func'].str.contains('intronic|intergenic|UTR', case=False, na=False)
    df=df[mask]
    return sid, df

# test on one
files=os.listdir(chip_dir)[:3]
for f in files:
    sid,df=load_sample(f)
    print(sid, df.shape)
    print(df[['Variant Info','Func','ClinSig','VAF']].head())

# %% cell 3
import os, pandas as pd, numpy as np, re
DATA_DIR=os.environ['DATA_DIR']
chip_dir=os.path.join(DATA_DIR,'CHIP_DP10_GQ20_PASS')

f=os.listdir(chip_dir)[0]
df=pd.read_excel(os.path.join(chip_dir,f))
print(df.iloc[:5,:15])
print(df.iloc[:5,15:30])

# %% cell 4
import os, pandas as pd, numpy as np, re
DATA_DIR=os.environ['DATA_DIR']
chip_dir=os.path.join(DATA_DIR,'CHIP_DP10_GQ20_PASS')


def load_sample(fname):
    sid=re.search(r'CHIP_(.*).xlsx', fname).group(1)
    raw=pd.read_excel(os.path.join(chip_dir,fname))
    # header row index where Variant Info == 'Chr:Pos'
    header_idx=raw.index[raw['Variant Info']=='Chr:Pos'][0]
    header=raw.iloc[header_idx]
    df=raw.iloc[header_idx+1:].reset_index(drop=True)
    df.columns=header
    sample_col=[c for c in df.columns if 'Proband' in str(c)][0]
    sc=df[sample_col].astype(str)
    gt_vaf=sc.str.split(';',expand=True)
    if gt_vaf.shape[1]<2:
        return sid, pd.DataFrame()
    df['GT']=gt_vaf[0]
    df['VAF']=pd.to_numeric(gt_vaf[1], errors='coerce')
    df=df[df['GT']!='0/0']
    df=df[df['VAF']<0.3]
    func_col='Sequence Ontology (Combined)'
    clnsig_col='Clinical Significance'
    df['Func']=df[func_col].astype(str)
    df['ClinSig']=df[clnsig_col].astype(str)
    mask=~df['Func'].str.contains('intron|intergenic|UTR', case=False, na=False)
    df=df[mask]
    return sid, df

for f in os.listdir(chip_dir)[:3]:
    sid,df=load_sample(f)
    print(f,sid,df.shape)
    print(df[['Chr:Pos','Func','ClinSig','VAF']].head())

# %% cell 5
import os, pandas as pd
DATA_DIR=os.environ['DATA_DIR']
chip_dir=os.path.join(DATA_DIR,'CHIP_DP10_GQ20_PASS')

f=[x for x in os.listdir(chip_dir) if '615-P1' in x][0]
raw=pd.read_excel(os.path.join(chip_dir,f))
print(raw.iloc[:3])
# find header row
hidx=raw.index[raw['Variant Info']=='Chr:Pos'][0]
header=raw.iloc[hidx]
print('header row:',hidx)
print(header)

df=raw.iloc[hidx+1:].reset_index(drop=True)
df.columns=header
print(df.columns)
print(df.head())

# %% cell 6
import os, pandas as pd, numpy as np, re
DATA_DIR=os.environ['DATA_DIR']
chip_dir=os.path.join(DATA_DIR,'CHIP_DP10_GQ20_PASS')


def load_sample(fname):
    sid=re.search(r'CHIP_(.*).xlsx', fname).group(1)
    raw=pd.read_excel(os.path.join(chip_dir,fname))
    hidx=raw.index[raw['Variant Info']=='Chr:Pos'][0]
    header=raw.iloc[hidx]
    df=raw.iloc[hidx+1:].reset_index(drop=True)
    df.columns=header
    vaf_col='Variant Allele Freq'
    df['VAF']=pd.to_numeric(df[vaf_col], errors='coerce')
    df=df[df['VAF']<0.3]
    func_col='Sequence Ontology (Combined)'
    df['Func']=df[func_col].astype(str)
    mask=~df['Func'].str.contains('intron|intergenic|UTR', case=False, na=False)
    df=df[mask]
    # ClinVar classification columns
    df['Clin_Class']=df['Classification'].astype(str)
    df['Clin_Review']=df['Review Status'].astype(str)
    return sid, df

for f in os.listdir(chip_dir)[:3]:
    sid,df=load_sample(f)
    print(f,sid,df.shape)
    print(df[['Chr:Pos','Func','Clin_Class','Clin_Review','VAF']].head())

# %% cell 7
import os, pandas as pd, numpy as np, re
DATA_DIR=os.environ['DATA_DIR']
chip_dir=os.path.join(DATA_DIR,'CHIP_DP10_GQ20_PASS')
meta = pd.read_excel(os.path.join(DATA_DIR, '230215_Trio_Status.xlsx'))
meta['Sample ID']=meta['Sample ID'].astype(str)

# map filenames to sample IDs
files=os.listdir(chip_dir)
recs=[]
for f in files:
    sid=re.search(r'CHIP_(.*).xlsx', f).group(1)
    if sid.startswith('SRR'):
        sample_id=sid
    else:
        sample_id=sid.split('-')[0]
    recs.append((f,sample_id))
file_map=pd.DataFrame(recs, columns=['file','Sample ID'])
merged=file_map.merge(meta, on='Sample ID', how='left')
print(merged.head(20))
print(merged['Status'].value_counts(dropna=False))
print(merged['BLM Mutation Status'].value_counts(dropna=False))

# %% cell 8
import os, pandas as pd, numpy as np, re
DATA_DIR=os.environ['DATA_DIR']
chip_dir=os.path.join(DATA_DIR,'CHIP_DP10_GQ20_PASS')
meta = pd.read_excel(os.path.join(DATA_DIR, '230215_Trio_Status.xlsx'))
meta['Sample ID']=meta['Sample ID'].astype(str)

files=os.listdir(chip_dir)

# define benign based on ClinVar Classification contains 'Benign'

def process_group(mask_desc, sample_mask):
    from collections import Counter
    total_vars=0
    benign_vars=0
    for f in files:
        sid=re.search(r'CHIP_(.*).xlsx', f).group(1)
        sample_id=sid if sid.startswith('SRR') else sid.split('-')[0]
        row=meta[meta['Sample ID']==sample_id]
        if row.empty:
            continue
        if not sample_mask(row.iloc[0]):
            continue
        raw=pd.read_excel(os.path.join(chip_dir,f))
        hidx=raw.index[raw['Variant Info']=='Chr:Pos'][0]
        header=raw.iloc[hidx]
        df=raw.iloc[hidx+1:].reset_index(drop=True)
        df.columns=header
        df['VAF']=pd.to_numeric(df['Variant Allele Freq'], errors='coerce')
        df=df[df['VAF']<0.3]
        df['Func']=df['Sequence Ontology (Combined)'].astype(str)
        df=df[~df['Func'].str.contains('intron|intergenic|UTR', case=False, na=False)]
        df['Clin_Class']=df['Classification'].astype(str)
        total_vars+=len(df)
        benign=df[df['Clin_Class'].str.contains('Benign', case=False, na=False)]
        benign_vars+=len(benign)
    print(mask_desc, 'total', total_vars, 'benign', benign_vars, 'prop', benign_vars/total_vars if total_vars>0 else None)

# q1: BLM Affected (BSyn probands)
process_group('Affected', lambda r: r['BLM Mutation Status']=='Affected')

# q2: lacking both BLM Mutation Status (Control) and 'Mother/Father' (Parents)
process_group('Control_nonparents', lambda r: (r['BLM Mutation Status']=='Unaffected') and (r['Status'] not in ['Mother','Father']))

# q3: Carrier
process_group('Carrier', lambda r: r['BLM Mutation Status']=='Carrier')

# q4: Mother or Father
process_group('Parents', lambda r: r['Status'] in ['Mother','Father'])
