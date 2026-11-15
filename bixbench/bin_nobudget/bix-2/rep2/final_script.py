
# %% cell 0
import os, pandas as pd
print(os.environ['DATA_DIR'])
base = os.environ['DATA_DIR']
print(pd.read_excel(os.path.join(base,'230215_Trio_Status.xlsx')).head())

# %% cell 1
import os, pandas as pd
base = os.environ['DATA_DIR']
status = pd.read_excel(os.path.join(base,'230215_Trio_Status.xlsx'))
print(status['Status'].unique())
print(status['BLM Mutation Status'].unique())

# %% cell 2
import os, pandas as pd, glob
base = os.environ['DATA_DIR']
chip_dir = os.path.join(base,'CHIP_DP10_GQ20_PASS')
files = glob.glob(os.path.join(chip_dir,'*.xlsx'))
print(len(files))
print(os.path.basename(files[0]))
df = pd.read_excel(files[0])
print(df.head()); print(df.columns)

# %% cell 3
import os, pandas as pd
base = os.environ['DATA_DIR']
chip_mean = pd.read_excel(os.path.join(base,'CHIP VAF mean proportions.xlsx'))
print(chip_mean.head()); print(chip_mean.columns)

# %% cell 4
import os, pandas as pd
base = os.environ['DATA_DIR']
status = pd.read_excel(os.path.join(base,'230215_Trio_Status.xlsx'))
print(status.head())
print(status['Status'].value_counts())


# %% cell 5
import os, pandas as pd, glob, re
base = os.environ['DATA_DIR']
status = pd.read_excel(os.path.join(base,'230215_Trio_Status.xlsx'))
status['Status'] = status['Status'].str.strip()
status_map = dict(zip(status['Sample ID'].astype(str), zip(status['Status'], status['BLM Mutation Status'])))

import numpy as np
chip_dir = os.path.join(base,'CHIP_DP10_GQ20_PASS')
files = glob.glob(os.path.join(chip_dir,'*.xlsx'))

records = []
for f in files:
    name = os.path.basename(f)
    m = re.search(r'CHIP_(.+)\.xlsx', name)
    sid = m.group(1)
    if '-' in sid:
        sid = sid.split('-')[0]
    sid_key = sid
    status_info = status_map.get(sid_key)
    if status_info is None:
        continue
    df = pd.read_excel(f)
    col = [c for c in df.columns if 'Proband' in c][0]
    vafs = df[col].dropna().astype(str).str.extract(r'VAF:([0-9\.]+)').astype(float)[0]
    genes = df['RefSeq Genes 110, NCBI'].astype(str)
    for vaf,g in zip(vafs,genes):
        records.append({'sample':sid_key,'status':status_info[0],'blm':status_info[1],'vaf':vaf,'genes':g})

var_df = pd.DataFrame(records)
print(var_df.head())
print(var_df['status'].value_counts())
print(var_df['blm'].value_counts())

# %% cell 6
import os, pandas as pd, glob, re
base = os.path.dirname(os.environ['DATA_DIR'])
print(base)
print(pd.read_excel(os.path.join(base,'12031','230214_Schenz_et_al_2022_CHIP_Genes.xlsx')).head())

# %% cell 7
import os, pandas as pd
base = os.environ['DATA_DIR']
print(pd.read_excel(os.path.join(base,'230214_Schenz_et_al_2022_CHIP_Genes.xlsx')).head())

# %% cell 8
import os, pandas as pd
base = os.environ['DATA_DIR']
chip_genes = pd.read_excel(os.path.join(base,'230214_Schenz_et_al_2022_CHIP_Genes.xlsx'))['ABL1'].astype(str).str.strip().tolist()
print(len(chip_genes), chip_genes[:10])

# %% cell 9
import os, pandas as pd, glob, re
base = os.environ['DATA_DIR']
status = pd.read_excel(os.path.join(base,'230215_Trio_Status.xlsx'))
status['Status'] = status['Status'].str.strip()
status_map = dict(zip(status['Sample ID'].astype(str), zip(status['Status'], status['BLM Mutation Status'])))
chip_genes = pd.read_excel(os.path.join(base,'230214_Schenz_et_al_2022_CHIP_Genes.xlsx'))['ABL1'].astype(str).str.strip().tolist()
chip_dir = os.path.join(base,'CHIP_DP10_GQ20_PASS')
files = glob.glob(os.path.join(chip_dir,'*.xlsx'))

import numpy as np
records = []
for f in files:
    name = os.path.basename(f)
    sid = re.search(r'CHIP_(.+)\.xlsx', name).group(1)
    if '-' in sid:
        sid = sid.split('-')[0]
    info = status_map.get(sid)
    if info is None:
        continue
    df = pd.read_excel(f)
    proband_cols = [c for c in df.columns if 'Proband' in str(c)]
    if not proband_cols:
        continue
    col = proband_cols[0]
    for _, row in df.iterrows():
        genes = str(row.get('RefSeq Genes 110, NCBI',''))
        if not any(g for g in chip_genes if g in genes.split('; ')):
            continue
        val = row[col]
        if isinstance(val,str) and 'VAF:' in val:
            try:
                vaf = float(re.search(r'VAF:([0-9\.]+)', val).group(1))
            except:
                continue
        else:
            continue
        records.append({'sample':sid,'status':info[0],'blm':info[1],'vaf':vaf})

chip_df = pd.DataFrame(records)
print(chip_df.head())
print(chip_df['blm'].value_counts())
print(chip_df['status'].value_counts())

# %% cell 10
import os, pandas as pd, glob, re
base = os.environ['DATA_DIR']
chip_dir = os.path.join(base,'CHIP_DP10_GQ20_PASS')
import random, itertools

for f in random.sample(glob.glob(os.path.join(chip_dir,'*.xlsx')), 3):
    print('FILE', os.path.basename(f))
    df = pd.read_excel(f)
    print(df.columns)
    print(df.head(3))
    break

# %% cell 11
import os, pandas as pd, glob, re
base = os.environ['DATA_DIR']
status = pd.read_excel(os.path.join(base,'230215_Trio_Status.xlsx'))
status['Status'] = status['Status'].str.strip()
status_map = dict(zip(status['Sample ID'].astype(str), zip(status['Status'], status['BLM Mutation Status'])))
chip_genes = pd.read_excel(os.path.join(base,'230214_Schenz_et_al_2022_CHIP_Genes.xlsx'))['ABL1'].astype(str).str.strip().tolist()
chip_dir = os.path.join(base,'CHIP_DP10_GQ20_PASS')
import numpy as np
records = []
for f in glob.glob(os.path.join(chip_dir,'*.xlsx')):
    name = os.path.basename(f)
    sid = re.search(r'CHIP_(.+)\.xlsx', name).group(1)
    if '-' in sid and not sid.startswith('SRR'):
        sid = sid.split('-')[0]
    info = status_map.get(sid)
    if info is None:
        continue
    df = pd.read_excel(f, skiprows=1)
    sample_col = [c for c in df.columns if '(' in c and ')' in c]
    if not sample_col:
        continue
    col = sample_col[0]
    for _, row in df.iterrows():
        genes = str(row.get('RefSeq Genes 110, NCBI',''))
        if not any(g in genes for g in chip_genes):
            continue
        val = row[col]
        if isinstance(val,str) and 'VAF:' in val:
            m = re.search(r'VAF:([0-9\.]+)', val)
            if not m: continue
            vaf = float(m.group(1))
        else:
            continue
        records.append({'sample':sid,'status':info[0],'blm':info[1],'vaf':vaf})

chip_df = pd.DataFrame(records)
print(chip_df.head())
print(chip_df['blm'].value_counts())

# %% cell 12
import os, pandas as pd, glob, re
base = os.environ['DATA_DIR']
chip_dir = os.path.join(base,'CHIP_DP10_GQ20_PASS')
import random
f = random.choice(glob.glob(os.path.join(chip_dir,'*.xlsx')))
print(os.path.basename(f))
for skip in [0,1,2,3,4]:
    print('skiprows', skip)
    df = pd.read_excel(f, skiprows=skip)
    print(df.head(5))
    break

# %% cell 13
import os, pandas as pd, glob, re
base = os.environ['DATA_DIR']
chip_dir = os.path.join(base,'CHIP_DP10_GQ20_PASS')

f = os.path.join(chip_dir,'230209_Exome_GRCh38_CHIP_179-P1.xlsx')
df = pd.read_excel(f)
print(df.columns)
print(df.iloc[:10,[0,4,12]])

# %% cell 14
import os, pandas as pd, re, glob
base = os.environ['DATA_DIR']
chip_genes = set(pd.read_excel(os.path.join(base,'230214_Schenz_et_al_2022_CHIP_Genes.xlsx'))['ABL1'].astype(str))
print(len(chip_genes))

f = os.path.join(base,'CHIP_DP10_GQ20_PASS','230209_Exome_GRCh38_CHIP_179-P1.xlsx')
df = pd.read_excel(f)
print(df.iloc[:20,[0,4,12]])

rows = []
for _,row in df.iterrows():
  gene = str(row['RefSeq Genes 110, NCBI'])
  if gene in chip_genes:
    rows.append(row)
print(len(rows))
print(rows[:5])

# %% cell 15
import os, pandas as pd, glob, re
base = os.environ['DATA_DIR']
chip_dir = os.path.join(base,'CHIP_DP10_GQ20_PASS')

f = os.path.join(chip_dir,'230209_Exome_GRCh38_CHIP_179-P1.xlsx')
df = pd.read_excel(f)
print(df.iloc[0:15,[0,4,7,8]])

# %% cell 16
import os, pandas as pd, glob, re
base = os.environ['DATA_DIR']
status = pd.read_excel(os.path.join(base,'230215_Trio_Status.xlsx'))
status['Status'] = status['Status'].str.strip()
status_map = dict(zip(status['Sample ID'].astype(str), zip(status['Status'], status['BLM Mutation Status'])))
chip_genes = set(pd.read_excel(os.path.join(base,'230214_Schenz_et_al_2022_CHIP_Genes.xlsx'))['ABL1'].astype(str))

chip_dir = os.path.join(base,'CHIP_DP10_GQ20_PASS')
records = []
for f in glob.glob(os.path.join(chip_dir,'*.xlsx')):
    name = os.path.basename(f)
    sid = re.search(r'CHIP_(.+)\.xlsx', name).group(1)
    if '-' in sid and not sid.startswith('SRR'):
        sid = sid.split('-')[0]
    info = status_map.get(sid)
    if info is None:
        continue
    df = pd.read_excel(f)
    sample_col = [c for c in df.columns if '(' in c and ')' in c][0]
    dp_col = df.columns[7]
    ad_col = df.columns[8]
    for i,row in df.iloc[1:].iterrows():
        gene = str(row['RefSeq Genes 110, NCBI'])
        if gene not in chip_genes:
            continue
        zyg = str(row[sample_col])
        if 'Heterozygous' not in zyg and 'Homozygous' not in zyg:
            continue
        dp = row[dp_col]
        ad = row[ad_col]
        try:
            dp = float(dp); ad = float(ad)
        except:
            continue
        if dp<=0: continue
        vaf = ad/dp
        records.append({'sample':sid,'status':info[0],'blm':info[1],'vaf':vaf})

chip_df = pd.DataFrame(records)
print(chip_df.head())
print('n variants', len(chip_df))
print(chip_df['blm'].value_counts())
print(chip_df['status'].value_counts())

# %% cell 17
import pandas as pd, os
base = os.environ['DATA_DIR']
status = pd.read_excel(os.path.join(base,'230215_Trio_Status.xlsx'))
print(status['Status'].value_counts())

# %% cell 18
import os,pandas as pd
base=os.environ['DATA_DIR']
status=pd.read_excel(os.path.join(base,'230215_Trio_Status.xlsx'))
status['Status']=status['Status'].str.strip()
print(status['Status'].value_counts())

# %% cell 19
import os,pandas as pd
base=os.environ['DATA_DIR']
status=pd.read_excel(os.path.join(base,'230215_Trio_Status.xlsx'))
status['Status']=status['Status'].str.strip()
print(status.head())

# %% cell 20
import os,pandas as pd
base=os.environ['DATA_DIR']
status=pd.read_excel(os.path.join(base,'230215_Trio_Status.xlsx'))
status['Status']=status['Status'].str.strip()
print(status['BLM Mutation Status'].value_counts())

# %% cell 21
import pandas as pd, os
base=os.environ['DATA_DIR']
chip_dir=os.path.join(base,'CHIP_DP10_GQ20_PASS')

chip_df=pd.read_pickle('chip_df.pkl') if os.path.exists('chip_df.pkl') else None
if chip_df is None:
    raise SystemExit('missing pickle')

# Q1: BLM variant (Carrier or Affected)
blm_var=chip_df[chip_df['blm'].isin(['Carrier','Affected'])]
prop_somatic=(blm_var['vaf']<0.3).mean()
print('Q1 n',len(blm_var),'prop',prop_somatic)

# Q2: Control Children cohort -> BLM Unaffected and Status Child
ctrl_child=chip_df[(chip_df['blm']=='Unaffected') & (chip_df['status']=='Child')]
perc=( (ctrl_child['vaf']>=0.3) & (ctrl_child['vaf']<=0.7) ).mean()*100
print('Q2 n',len(ctrl_child),'perc',perc)

# %% cell 22
import os, pandas as pd, glob, re
base = os.environ['DATA_DIR']
status = pd.read_excel(os.path.join(base,'230215_Trio_Status.xlsx'))
status['Status'] = status['Status'].str.strip()
status_map = dict(zip(status['Sample ID'].astype(str), zip(status['Status'], status['BLM Mutation Status'])))
chip_genes = set(pd.read_excel(os.path.join(base,'230214_Schenz_et_al_2022_CHIP_Genes.xlsx'))['ABL1'].astype(str))
chip_dir = os.path.join(base,'CHIP_DP10_GQ20_PASS')
records = []
for f in glob.glob(os.path.join(chip_dir,'*.xlsx')):
    name = os.path.basename(f)
    sid = re.search(r'CHIP_(.+)\.xlsx', name).group(1)
    if '-' in sid and not sid.startswith('SRR'):
        sid = sid.split('-')[0]
    info = status_map.get(sid)
    if info is None:
        continue
    df = pd.read_excel(f)
    sample_col = [c for c in df.columns if '(' in c and ')' in c][0]
    dp_col = df.columns[7]
    ad_col = df.columns[8]
    for i,row in df.iloc[1:].iterrows():
        gene = str(row['RefSeq Genes 110, NCBI'])
        if gene not in chip_genes:
            continue
        zyg = str(row[sample_col])
        if 'Heterozygous' not in zyg and 'Homozygous' not in zyg:
            continue
        dp = row[dp_col]; ad = row[ad_col]
        try:
            dp = float(dp); ad = float(ad)
        except:
            continue
        if dp<=0: continue
        vaf = ad/dp
        records.append({'sample':sid,'status':info[0],'blm':info[1],'vaf':vaf})

chip_df = pd.DataFrame(records)
print('n variants', len(chip_df))
chip_df.to_pickle('chip_df.pkl')
print(chip_df.head())
print(chip_df['blm'].value_counts())
print(chip_df['status'].value_counts())

# %% cell 23
import pandas as pd
chip_df=pd.read_pickle('chip_df.pkl')
# Q1
blm_var=chip_df[chip_df['blm'].isin(['Carrier','Affected'])]
prop_somatic=(blm_var['vaf']<0.3).mean()
print('Q1 n',len(blm_var),'prop',prop_somatic)
# Q2
ctrl_child=chip_df[(chip_df['blm']=='Unaffected') & (chip_df['status']=='Child')]
mask=(ctrl_child['vaf']>=0.3) & (ctrl_child['vaf']<=0.7)
perc=mask.mean()*100
print('Q2 n',len(ctrl_child),'perc',perc)
