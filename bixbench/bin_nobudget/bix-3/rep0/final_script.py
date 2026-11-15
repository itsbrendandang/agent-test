
# %% cell 0
import os
import pandas as pd
print(os.environ['DATA_DIR'])
file_path = os.path.join(os.environ['DATA_DIR'], '38665421_Data_deposition_RNAseq_Paroxetine_2017.xlsx')
xl = pd.ExcelFile(file_path)
print(xl.sheet_names)
for sheet in xl.sheet_names:
    print('---', sheet, '---')
    df = xl.parse(sheet, nrows=5)
    print(df.head())

# %% cell 1
import os, glob, textwrap
root = os.environ['DATA_DIR']
print(root)
print(os.listdir(root))
for p in glob.glob(root+'/*'):
    print('glob', repr(p))
    try:
        st = os.stat(p)
        print(' size', st.st_size)
    except Exception as e:
        print(' err', e)


# %% cell 2
import os, pandas as pd
file_path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
print(file_path)
xl = pd.ExcelFile(file_path)
print(xl.sheet_names)
for sheet in xl.sheet_names:
    print('---', sheet, '---')
    df = xl.parse(sheet, nrows=5)
    print(df.head())

# %% cell 3
import os, pandas as pd
file_path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
norm = pd.read_excel(file_path, sheet_name='NormCount')
print(norm.head(10))
print(norm.iloc[0:5,0:20])
print(norm.columns[:40])

# %% cell 4
import os, pandas as pd
file_path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
norm = pd.read_excel(file_path, sheet_name='NormCount')
# find header row where first col == 'Index'
header_row = norm.index[norm.iloc[:,0] == 'Index'][0]
print('header_row', header_row)
header = norm.iloc[header_row]
print(header[:40])

# build new df
counts = norm.iloc[header_row+1:].reset_index(drop=True)
counts.columns = header
print(counts.head())
print(counts.columns[:40])

# %% cell 5
import os, pandas as pd, numpy as np, textwrap, json, subprocess, sys, math, statistics
file_path = os.path.join(os.environ['DATA_DIR'], 'Data_deposition_RNAseq_Paroxetine_2017.xlsx')
norm = pd.read_excel(file_path, sheet_name='NormCount')
header_row = norm.index[norm.iloc[:,0] == 'Index'][0]
header = norm.iloc[header_row]
counts = norm.iloc[header_row+1:].reset_index(drop=True)
counts.columns = header
# keep Control samples
tcontrol_cols = [c for c in counts.columns if isinstance(c,str) and c.startswith('Control_')]
print(len(tcontrol_cols), tcontrol_cols[:20])
# identify tissues
from collections import Counter
print(Counter([c.split('_')[1] for c in tcontrol_cols]))
# pivot gene x sample matrix
expr = counts[['GeneID'] + tcontrol_cols].copy()
expr.set_index('GeneID', inplace=True)
expr = expr.apply(pd.to_numeric)
print(expr.shape)
# samples
samples = pd.DataFrame({'sample': tcontrol_cols})
samples['mouse'] = samples['sample'].str.extract(r'Control_(.*)_\d+')[0]
samples['tissue'] = samples['mouse'].str.replace('_blood',' blood')
print(samples.head(20))
print(samples['tissue'].value_counts())

# For DESeq2 need integer counts; these look normalized; scale to pseudo counts per sample
scale_expr = expr.copy()
for col in scale_expr.columns:
    col_min = scale_expr[col].min()
    if col_min < 0:
        scale_expr[col] = scale_expr[col] - col_min
    factor = 10
    vals = (scale_expr[col] * factor).round().astype(int)
    while vals.max() < 1e6 and math.gcd.reduce(vals[vals>0].tolist())>1:
        factor *=2
        vals = (scale_expr[col] * factor).round().astype(int)
    scale_expr[col] = vals
print(scale_expr.iloc[:5,:5])
scale_expr.to_csv('control_pseudocounts.tsv', sep='\t')

# metadata for Control mice only
samples.to_csv('control_sample_metadata.tsv', sep='\t', index=False)
print('files written')

# %% cell 6
import pandas as pd
samp = pd.read_csv('control_sample_metadata.tsv', sep='\t')
print(samp['sample'].unique())

# %% cell 7
import subprocess, textwrap, os, json, pandas as pd

# write R script
r_script = '''
library(DESeq2)
counts <- read.table("control_pseudocounts.tsv", header=TRUE, row.names=1, sep="\t", check.names=FALSE)
coldata <- read.table("control_sample_metadata.tsv", header=TRUE, sep="\t", check.names=FALSE)
rownames(coldata) <- coldata$sample
coldata$tissue <- factor(gsub("Control_", "", coldata$sample))
coldata$tissue <- factor(ifelse(grepl("baseline_blood", coldata$sample), "baseline_blood",
                         ifelse(grepl("final_blood", coldata$sample), "final_blood", "dentate_gyrus")))

# reorder columns to match coldata
counts <- counts[, rownames(coldata)]

# DESeq2 analysis overall
dds <- DESeqDataSetFromMatrix(countData=counts, colData=coldata, design=~ tissue)
dds <- DESeq(dds)
res_fb_vs_bb <- results(dds, contrast=c("tissue","final_blood","baseline_blood"))
res_dg_vs_bb <- results(dds, contrast=c("tissue","dentate_gyrus","baseline_blood"))
res_dg_vs_fb <- results(dds, contrast=c("tissue","dentate_gyrus","final_blood"))

# add baseMean
res_fb_vs_bb_df <- as.data.frame(res_fb_vs_bb)
res_dg_vs_bb_df <- as.data.frame(res_dg_vs_bb)
res_dg_vs_fb_df <- as.data.frame(res_dg_vs_fb)

write.csv(res_fb_vs_bb_df, file="res_final_vs_baseline_blood.csv")
write.csv(res_dg_vs_bb_df, file="res_dg_vs_baseline_blood.csv")
write.csv(res_dg_vs_fb_df, file="res_dg_vs_final_blood.csv")

sig_fb_vs_bb <- rownames(subset(res_fb_vs_bb_df, !is.na(padj) & padj < 0.05 & abs(log2FoldChange) > 1 & baseMean >= 10))
length(sig_fb_vs_bb)

'''
open('deseq_analysis.R','w').write(r_script)

# run Rscript
res = subprocess.run(['Rscript','deseq_analysis.R'], capture_output=True, text=True)
print('R stdout:', res.stdout)
print('R stderr:', res.stderr)
print('R returncode:', res.returncode)

print(os.listdir('.'))

