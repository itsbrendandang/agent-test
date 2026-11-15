
# %% cell 0
import os, pandas as pd
print(os.environ['DATA_DIR'])
meta = pd.read_excel(os.path.join(os.environ['DATA_DIR'], '230215_Trio_Status.xlsx'))
print(meta.head())
print(meta.columns)

# %% cell 1
import os, pandas as pd, glob
DATA_DIR=os.environ['DATA_DIR']

chip_dir=os.path.join(DATA_DIR,'CHIP_DP10_GQ20_PASS')
files=glob.glob(os.path.join(chip_dir,'*.xlsx'))
print(len(files))
print(os.path.basename(files[0]))

df=pd.read_excel(files[0])
print(df.head())
print(df.columns)

# %% cell 2
import os, glob, pandas as pd
DATA_DIR=os.environ['DATA_DIR']
meta = pd.read_excel(os.path.join(DATA_DIR,'230215_Trio_Status.xlsx'))
print(meta['BLM Mutation Status'].value_counts(dropna=False))
print(meta['Status'].value_counts(dropna=False))

# %% cell 3
import os, glob, pandas as pd
DATA_DIR=os.environ['DATA_DIR']
chip_dir=os.path.join(DATA_DIR,'CHIP_DP10_GQ20_PASS')

meta = pd.read_excel(os.path.join(DATA_DIR,'230215_Trio_Status.xlsx'))

# map sample IDs to status and BLM status
meta['Sample ID']=meta['Sample ID'].astype(str)
meta_map = meta.set_index('Sample ID')

records=[]
for f in glob.glob(os.path.join(chip_dir,'*.xlsx')):
    base=os.path.basename(f)
    sid=base.split('_CHIP_')[1].split('.')[0]
    sid_clean=sid.replace('-P1','').replace('-P2','').replace('-P','').replace('-PF','').replace('-PM','')
    status=meta_map.loc[sid_clean,'Status'] if sid_clean in meta_map.index else None
    blm=meta_map.loc[sid_clean,'BLM Mutation Status'] if sid_clean in meta_map.index else None
    records.append((base,sid,sid_clean,status,blm))

print(len(records))
print(pd.DataFrame(records,columns=['file','sid','sid_clean','status','blm']).head(20))
print(pd.DataFrame(records,columns=['file','sid','sid_clean','status','blm'])['blm'].value_counts(dropna=False))

# %% cell 4
import os, glob, pandas as pd
DATA_DIR=os.environ['DATA_DIR']
chip_gene_file=os.path.join(DATA_DIR,'230214_Schenz_et_al_2022_CHIP_Genes.xlsx')
chip_genes=pd.read_excel(chip_gene_file)
print(chip_genes.head())
print(chip_genes.columns)

# %% cell 5
import os, glob, pandas as pd
DATA_DIR=os.environ['DATA_DIR']
chip_dir=os.path.join(DATA_DIR,'CHIP_DP10_GQ20_PASS')

f=glob.glob(os.path.join(chip_dir,'*.xlsx'))[0]
df=pd.read_excel(f)
print(df.columns)
print(df.iloc[:10,[0,1,2,4,12,13,24,25]])

# %% cell 6
import os, glob, pandas as pd, numpy as np
DATA_DIR=os.environ['DATA_DIR']
chip_dir=os.path.join(DATA_DIR,'CHIP_DP10_GQ20_PASS')

chip_genes=pd.read_excel(os.path.join(DATA_DIR,'230214_Schenz_et_al_2022_CHIP_Genes.xlsx'))['ABL1'].astype(str).str.upper().tolist()

meta = pd.read_excel(os.path.join(DATA_DIR,'230215_Trio_Status.xlsx'))
meta['Sample ID']=meta['Sample ID'].astype(str)
meta_map = meta.set_index('Sample ID')


def parse_vaf(val):
    try:
        return float(str(val).split('%')[0])/100 if isinstance(val,str) and '%' in val else float(val)
    except:
        return np.nan

category_counts={k:{'somatic_total':0,'somatic_benign':0} for k in ['Affected','Control_no_parent','Carrier','Parent']}

for f in glob.glob(os.path.join(chip_dir,'*.xlsx')):
    base=os.path.basename(f)
    sid=base.split('_CHIP_')[1].split('.')[0]
    sid_clean=sid.replace('-P1','').replace('-P2','').replace('-P','').replace('-PF','').replace('-PM','')
    status=meta_map.loc[sid_clean,'Status'] if sid_clean in meta_map.index else None
    blm=meta_map.loc[sid_clean,'BLM Mutation Status'] if sid_clean in meta_map.index else None

    if blm=='Affected':
        cat='Affected'
    elif blm=='Carrier':
        cat='Carrier'
    elif status in ['Mother','Father']:
        cat='Parent'
    else:
        cat='Control_no_parent'

    df=pd.read_excel(f)
    col_sample=[c for c in df.columns if 'Proband' in c][0]
    sample_series=df[col_sample].astype(str)
    if 'somaticCH' not in sample_series.values:
        continue
    header_row=sample_series[sample_series=='somaticCH'].index[0]
    df2=df.iloc[header_row+1:].reset_index(drop=True)
    df2.columns=df.iloc[header_row]

    # rename key cols
    vcol=[c for c in df2.columns if 'Variant Info' in str(c)][0]
    flagcol='Flags'
    gene_col=[c for c in df2.columns if 'RefSeq Genes' in str(c)][0]
    clin_class_col='Classification'
    vaf_col=[c for c in df2.columns if 'Allele Fraction' in str(c)][0]

    # filter non-variant
    df2=df2[df2['Genotype']!='0/0']

    # functional filter
    func_mask=~df2['Function'].str.contains('intronic|intergenic|UTR',case=False,na=False)
    df2=df2[func_mask]

    # CHIP genes
    df2=df2[df2[gene_col].str.upper().isin(chip_genes)]

    # somaticCH
    df2=df2[df2['Filter'].str.contains('somatic',case=False,na=False)]

    # VAF <0.3
    vaf=df2[vaf_col].apply(parse_vaf)
    df2=df2[vaf<0.3]

    if df2.empty:
        continue

    total=len(df2)
    benign=df2[clin_class_col].astype(str).str.contains('Benign',case=False,na=False).sum()

    category_counts[cat]['somatic_total']+=total
    category_counts[cat]['somatic_benign']+=benign

print(category_counts)

# %% cell 7
import os, glob, pandas as pd
DATA_DIR=os.environ['DATA_DIR']
chip_dir=os.path.join(DATA_DIR,'CHIP_DP10_GQ20_PASS')

for f in sorted(glob.glob(os.path.join(chip_dir,'*.xlsx')))[:5]:
    df=pd.read_excel(f)
    print(os.path.basename(f), df.columns[:15])

# %% cell 8
import os, glob, pandas as pd, numpy as np
DATA_DIR=os.environ['DATA_DIR']
chip_dir=os.path.join(DATA_DIR,'CHIP_DP10_GQ20_PASS')

chip_genes=pd.read_excel(os.path.join(DATA_DIR,'230214_Schenz_et_al_2022_CHIP_Genes.xlsx'))['ABL1'].astype(str).str.upper().tolist()

meta = pd.read_excel(os.path.join(DATA_DIR,'230215_Trio_Status.xlsx'))
meta['Sample ID']=meta['Sample ID'].astype(str)
meta_map = meta.set_index('Sample ID')


def parse_vaf(val):
    try:
        s=str(val)
        if s.endswith('%'):
            return float(s[:-1])/100
        return float(s)
    except:
        return np.nan

category_counts={k:{'somatic_total':0,'somatic_benign':0} for k in ['Affected','Control_no_parent','Carrier','Parent']}

for f in glob.glob(os.path.join(chip_dir,'*.xlsx')):
    base=os.path.basename(f)
    sid=base.split('_CHIP_')[1].split('.')[0]
    sid_clean=sid.replace('-P1','').replace('-P2','').replace('-P','').replace('-PF','').replace('-PM','')
    status=meta_map.loc[sid_clean,'Status'] if sid_clean in meta_map.index else None
    blm=meta_map.loc[sid_clean,'BLM Mutation Status'] if sid_clean in meta_map.index else None

    if blm=='Affected':
        cat='Affected'
    elif blm=='Carrier':
        cat='Carrier'
    elif status in ['Mother','Father']:
        cat='Parent'
    else:
        cat='Control_no_parent'

    df=pd.read_excel(f, header=None)
    # find row where col4 equals 'somaticCH'
    col4=df.columns[4]
    som_rows=df[df[col4]=='somaticCH']
    if som_rows.empty:
        continue
    header_row=som_rows.index[0]
    df2=df.iloc[header_row+1:].reset_index(drop=True)
    df2.columns=df.iloc[header_row]

    # required columns
    try:
        gene_col=[c for c in df2.columns if 'RefSeq Genes' in str(c)][0]
        vaf_col=[c for c in df2.columns if 'Allele Fraction' in str(c)][0]
    except IndexError:
        print('missing cols in', base)
        continue

    # filter reference calls
    if 'Genotype' in df2.columns:
        df2=df2[df2['Genotype']!='0/0']

    # functional filter
    if 'Function' in df2.columns:
        func_mask=~df2['Function'].astype(str).str.contains('intronic|intergenic|UTR',case=False,na=False)
        df2=df2[func_mask]

    # CHIP genes
    df2=df2[df2[gene_col].astype(str).str.upper().isin(chip_genes)]

    # somatic filter (some extra safety)
    if 'Filter' in df2.columns:
        df2=df2[df2['Filter'].astype(str).str.contains('somatic',case=False,na=False)]

    # VAF <0.3
    vaf=df2[vaf_col].apply(parse_vaf)
    df2=df2[vaf<0.3]

    if df2.empty:
        continue

    total=len(df2)
    if 'Classification' in df2.columns:
        benign=df2['Classification'].astype(str).str.contains('Benign',case=False,na=False).sum()
    else:
        benign=0

    category_counts[cat]['somatic_total']+=total
    category_counts[cat]['somatic_benign']+=benign

print(category_counts)

# %% cell 9
import os, glob, pandas as pd
DATA_DIR=os.environ['DATA_DIR']
chip_dir=os.path.join(DATA_DIR,'CHIP_DP10_GQ20_PASS')

f=glob.glob(os.path.join(chip_dir,'230209_Exome_GRCh38_CHIP_179-P1.xlsx'))[0]
print('file',f)
raw=pd.read_excel(f,header=None)
print(raw.iloc[:40,:10])

# %% cell 10
import os, glob, pandas as pd
DATA_DIR=os.environ['DATA_DIR']
chip_dir=os.path.join(DATA_DIR,'CHIP_DP10_GQ20_PASS')

f=glob.glob(os.path.join(chip_dir,'230209_Exome_GRCh38_CHIP_179-P1.xlsx'))[0]
raw=pd.read_excel(f,header=None)
print(raw.iloc[0,:15])
print(raw.iloc[1,:15])

# %% cell 11
import os, glob, pandas as pd, numpy as np
DATA_DIR=os.environ['DATA_DIR']
chip_dir=os.path.join(DATA_DIR,'CHIP_DP10_GQ20_PASS')

chip_genes=pd.read_excel(os.path.join(DATA_DIR,'230214_Schenz_et_al_2022_CHIP_Genes.xlsx'))['ABL1'].astype(str).str.upper().tolist()

meta = pd.read_excel(os.path.join(DATA_DIR,'230215_Trio_Status.xlsx'))
meta['Sample ID']=meta['Sample ID'].astype(str)
meta_map = meta.set_index('Sample ID')


def parse_vaf(val):
    try:
        return float(val)
    except:
        return np.nan

category_counts={k:{'somatic_total':0,'somatic_benign':0} for k in ['Affected','Control_no_parent','Carrier','Parent']}

for f in glob.glob(os.path.join(chip_dir,'*.xlsx')):
    base=os.path.basename(f)
    sid=base.split('_CHIP_')[1].split('.')[0]
    sid_clean=sid.replace('-P1','').replace('-P2','').replace('-P','').replace('-PF','').replace('-PM','')
    status=meta_map.loc[sid_clean,'Status'] if sid_clean in meta_map.index else None
    blm=meta_map.loc[sid_clean,'BLM Mutation Status'] if sid_clean in meta_map.index else None

    if blm=='Affected':
        cat='Affected'
    elif blm=='Carrier':
        cat='Carrier'
    elif status in ['Mother','Father']:
        cat='Parent'
    else:
        cat='Control_no_parent'

    raw=pd.read_excel(f,header=None)
    # first row are col names, second row subheaders; data start row 2
    df=raw.iloc[2:].reset_index(drop=True)
    df.columns=raw.iloc[1]

    # find CHIP gene column, function/effect, clinvar classification, genotype, filter, VAF
    gene_col=[c for c in df.columns if 'Gene Names' in str(c)][0]
    func_col=[c for c in df.columns if 'Sequence Ontology' in str(c)][0]
    clin_class_col='Clinical Classification'
    if clin_class_col not in df.columns:
        # try other
        clin_class_col=[c for c in df.columns if 'Classification' in str(c)][0]
    geno_col='Genotype'
    filter_col='Filter'
    vaf_col=[c for c in df.columns if 'Variant Allele Freq' in str(c)][0]

    # drop reference
    if geno_col in df.columns:
        df=df[df[geno_col]!='0/0']

    # filter out intronic/intergenic/UTR
    func_series=df[func_col].astype(str)
    mask_func=~func_series.str.contains('intronic|intergenic|UTR',case=False,na=False)
    df=df[mask_func]

    # CHIP genes
    df=df[df[gene_col].astype(str).str.upper().isin(chip_genes)]

    # somatic CHIP by filter or primary/incidental findings? assume Filter column marks CHIP; if absent, skip
    if filter_col in df.columns:
        df=df[df[filter_col].astype(str).str.contains('somatic',case=False,na=False)]

    # VAF <0.3
    vaf=df[vaf_col].apply(parse_vaf)
    df=df[vaf<0.3]

    if df.empty:
        continue

    total=len(df)
    benign=df[clin_class_col].astype(str).str.contains('Benign',case=False,na=False).sum()
    category_counts[cat]['somatic_total']+=total
    category_counts[cat]['somatic_benign']+=benign

print(category_counts)

# %% cell 12
import os, glob, pandas as pd
DATA_DIR=os.environ['DATA_DIR']
chip_dir=os.path.join(DATA_DIR,'CHIP_DP10_GQ20_PASS')

f=glob.glob(os.path.join(chip_dir,'230209_Exome_GRCh38_CHIP_179-P1.xlsx'))[0]
raw=pd.read_excel(f,header=None)
raw2=raw.iloc[2:].reset_index(drop=True)
raw2.columns=raw.iloc[1]
print(raw2.columns)
print(raw2[['Chr:Pos','Primary Findings','Filter','Genotype','Variant Allele Freq','Gene Names','Sequence Ontology (Combined)','Clinical Classification']].head())

# %% cell 13
import os, glob, pandas as pd, numpy as np
DATA_DIR=os.environ['DATA_DIR']
chip_dir=os.path.join(DATA_DIR,'CHIP_DP10_GQ20_PASS')

chip_genes=set(pd.read_excel(os.path.join(DATA_DIR,'230214_Schenz_et_al_2022_CHIP_Genes.xlsx'))['ABL1'].astype(str).str.upper())

meta = pd.read_excel(os.path.join(DATA_DIR,'230215_Trio_Status.xlsx'))
meta['Sample ID']=meta['Sample ID'].astype(str)
meta_map = meta.set_index('Sample ID')


def parse_vaf(val):
    try:
        return float(val)
    except:
        return np.nan

category_counts={k:{'somatic_total':0,'somatic_benign':0} for k in ['Affected','Control_no_parent','Carrier','Parent']}

for f in glob.glob(os.path.join(chip_dir,'*.xlsx')):
    base=os.path.basename(f)
    sid=base.split('_CHIP_')[1].split('.')[0]
    sid_clean=sid.replace('-P1','').replace('-P2','').replace('-P','').replace('-PF','').replace('-PM','')
    status=meta_map.loc[sid_clean,'Status'] if sid_clean in meta_map.index else None
    blm=meta_map.loc[sid_clean,'BLM Mutation Status'] if sid_clean in meta_map.index else None

    if blm=='Affected':
        cat='Affected'
    elif blm=='Carrier':
        cat='Carrier'
    elif status in ['Mother','Father']:
        cat='Parent'
    else:
        cat='Control_no_parent'

    raw=pd.read_excel(f,header=None)
    df=raw.iloc[2:].reset_index(drop=True)
    df.columns=raw.iloc[1]

    # basic filters
    if 'Filter' not in df.columns:
        continue

    df=df[df['Filter'].astype(str).str.contains('CH',case=False,na=False)]

    # CHIP genes
    if 'Gene Names' not in df.columns:
        continue
    df=df[df['Gene Names'].astype(str).str.upper().isin(chip_genes)]

    # functional filter
    if 'Sequence Ontology (Combined)' in df.columns:
        func_series=df['Sequence Ontology (Combined)'].astype(str)
        df=df[~func_series.str.contains('intronic|intergenic|utr',case=False,na=False)]

    # VAF <0.3
    if 'Variant Allele Freq' not in df.columns:
        continue
    vaf=df['Variant Allele Freq'].apply(parse_vaf)
    df=df[vaf<0.3]

    if df.empty:
        continue

    total=len(df)
    clin_col='Classification' if 'Classification' in df.columns else None
    if clin_col:
        benign=df[clin_col].astype(str).str.contains('Benign',case=False,na=False).sum()
    else:
        benign=0

    category_counts[cat]['somatic_total']+=total
    category_counts[cat]['somatic_benign']+=benign

print(category_counts)

# %% cell 14
import os, glob, pandas as pd
DATA_DIR=os.environ['DATA_DIR']
chip_dir=os.path.join(DATA_DIR,'CHIP_DP10_GQ20_PASS')

f=glob.glob(os.path.join(chip_dir,'230209_Exome_GRCh38_CHIP_179-P1.xlsx'))[0]
raw=pd.read_excel(f,header=None)
raw2=raw.iloc[2:].reset_index(drop=True)
raw2.columns=raw.iloc[1]
print(raw2['Filter'].value_counts().head(20))

# %% cell 15
import os, glob, pandas as pd
DATA_DIR=os.environ['DATA_DIR']
chip_dir=os.path.join(DATA_DIR,'CHIP_DP10_GQ20_PASS')

f=glob.glob(os.path.join(chip_dir,'230209_Exome_GRCh38_CHIP_179-P1.xlsx'))[0]
raw=pd.read_excel(f,header=None)
raw2=raw.iloc[2:].reset_index(drop=True)
raw2.columns=raw.iloc[1]
print(raw2.columns)
print(raw2['In_CHIP'].value_counts(dropna=False).head(10))

# %% cell 16
import os, glob, pandas as pd, numpy as np
DATA_DIR=os.environ['DATA_DIR']
chip_dir=os.path.join(DATA_DIR,'CHIP_DP10_GQ20_PASS')

chip_genes=set(pd.read_excel(os.path.join(DATA_DIR,'230214_Schenz_et_al_2022_CHIP_Genes.xlsx'))['ABL1'].astype(str).str.upper())

meta = pd.read_excel(os.path.join(DATA_DIR,'230215_Trio_Status.xlsx'))
meta['Sample ID']=meta['Sample ID'].astype(str)
meta_map = meta.set_index('Sample ID')


def parse_vaf(val):
    try:
        return float(val)
    except:
        return np.nan

category_counts={k:{'somatic_total':0,'somatic_benign':0} for k in ['Affected','Control_no_parent','Carrier','Parent']}

for f in glob.glob(os.path.join(chip_dir,'*.xlsx')):
    base=os.path.basename(f)
    sid=base.split('_CHIP_')[1].split('.')[0]
    sid_clean=sid.replace('-P1','').replace('-P2','').replace('-P','').replace('-PF','').replace('-PM','')
    status=meta_map.loc[sid_clean,'Status'] if sid_clean in meta_map.index else None
    blm=meta_map.loc[sid_clean,'BLM Mutation Status'] if sid_clean in meta_map.index else None

    if blm=='Affected':
        cat='Affected'
    elif blm=='Carrier':
        cat='Carrier'
    elif status in ['Mother','Father']:
        cat='Parent'
    else:
        cat='Control_no_parent'

    raw=pd.read_excel(f,header=None)
    df=raw.iloc[2:].reset_index(drop=True)
    df.columns=raw.iloc[1]

    # restrict to CHIP genes via In_CHIP True
    if 'In_CHIP' not in df.columns:
        continue
    df=df[df['In_CHIP']==True]

    # exclude intronic/intergenic/UTR
    if 'Sequence Ontology (Combined)' in df.columns:
        so=df['Sequence Ontology (Combined)'].astype(str)
        df=df[~so.str.contains('intronic|intergenic|utr',case=False,na=False)]

    # VAF <0.3
    if 'Variant Allele Freq' not in df.columns:
        continue
    vaf=df['Variant Allele Freq'].apply(parse_vaf)
    df=df[vaf<0.3]

    if df.empty:
        continue

    total=len(df)
    benign=df['Classification'].astype(str).str.contains('Benign',case=False,na=False).sum() if 'Classification' in df.columns else 0

    category_counts[cat]['somatic_total']+=total
    category_counts[cat]['somatic_benign']+=benign

print(category_counts)

# %% cell 17
import os, glob, pandas as pd, numpy as np
DATA_DIR=os.environ['DATA_DIR']
chip_dir=os.path.join(DATA_DIR,'CHIP_DP10_GQ20_PASS')

meta = pd.read_excel(os.path.join(DATA_DIR,'230215_Trio_Status.xlsx'))
meta['Sample ID']=meta['Sample ID'].astype(str)
meta_map = meta.set_index('Sample ID')


def parse_vaf(val):
    try:
        return float(val)
    except:
        return np.nan

category_counts={k:{'somatic_total':0,'somatic_benign':0} for k in ['Affected','Control_no_parent','Carrier','Parent']}

for f in glob.glob(os.path.join(chip_dir,'*.xlsx')):
    base=os.path.basename(f)
    sid=base.split('_CHIP_')[1].split('.')[0]
    sid_clean=sid.replace('-P1','').replace('-P2','').replace('-P','').replace('-PF','').replace('-PM','')
    status=meta_map.loc[sid_clean,'Status'] if sid_clean in meta_map.index else None
    blm=meta_map.loc[sid_clean,'BLM Mutation Status'] if sid_clean in meta_map.index else None

    if blm=='Affected':
        cat='Affected'
    elif blm=='Carrier':
        cat='Carrier'
    elif status in ['Mother','Father']:
        cat='Parent'
    else:
        cat='Control_no_parent'

    raw=pd.read_excel(f,header=None)
    df=raw.iloc[2:].reset_index(drop=True)
    df.columns=raw.iloc[1]

    # we treat all variants as CHIP (dataset is pre-filtered)

    # exclude intronic/intergenic/UTR
    if 'Sequence Ontology (Combined)' in df.columns:
        so=df['Sequence Ontology (Combined)'].astype(str)
        df=df[~so.str.contains('intronic|intergenic|utr',case=False,na=False)]

    # VAF <0.3
    if 'Variant Allele Freq' not in df.columns:
        continue
    vaf=df['Variant Allele Freq'].apply(parse_vaf)
    df=df[vaf<0.3]

    if df.empty:
        continue

    total=len(df)
    benign=df['Classification'].astype(str).str.contains('Benign',case=False,na=False).sum() if 'Classification' in df.columns else 0

    category_counts[cat]['somatic_total']+=total
    category_counts[cat]['somatic_benign']+=benign

print(category_counts)

# %% cell 18
affected_prop=31/53
control_prop=81/148
carrier_prop=0
parent_prop=16/41
print(affected_prop, control_prop, carrier_prop, parent_prop)
