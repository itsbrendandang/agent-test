
# %% cell 0
import os, pandas as pd
from pathlib import Path
print(os.environ['DATA_DIR'])
DATA_DIR = os.environ['DATA_DIR']
counts = pd.read_csv(Path(DATA_DIR)/'raw_counts.csv')
meta = pd.read_csv(Path(DATA_DIR)/'experiment_metadata.csv')
print(counts.head())
print(meta.head())
print(counts.shape, meta.shape)
print(meta['Strain'].value_counts())

# %% cell 1
import pandas as pd, os
from pathlib import Path
DATA_DIR = os.environ['DATA_DIR']
counts = pd.read_csv(Path(DATA_DIR)/'raw_counts.csv')
meta = pd.read_csv(Path(DATA_DIR)/'experiment_metadata.csv')
counts = counts.rename(columns={'Unnamed: 0':'gene'})
counts = counts.set_index('gene')
# order columns to match meta
counts = counts[meta['AzentaName']]
# write out for R
counts.to_csv('counts_for_deseq2.csv')
meta.to_csv('coldata_for_deseq2.csv', index=False)
print(counts.shape)
print(meta.shape)

# %% cell 2
# write an R script to run DESeq2 analyses
r_script = '''
library(DESeq2)
counts <- read.csv('counts_for_deseq2.csv', row.names=1, check.names=FALSE)
coldata <- read.csv('coldata_for_deseq2.csv')
rownames(coldata) <- coldata$AzentaName
coldata$Strain <- factor(coldata$Strain)
coldata$Media <- factor(coldata$Media)
coldata$Replicate <- factor(coldata$Replicate)
coldata <- coldata[colnames(counts),]
# design for q3
dds <- DESeqDataSetFromMatrix(countData = counts, colData = coldata, design = ~ Replicate + Media + Strain)
# estimate dispersions to get pre-shrinkage values
dds <- estimateSizeFactors(dds)
dds <- estimateDispersions(dds)
# save pre-shrinkage dispersion estimates
write.csv(dispersions(dds), file='dispersions_preshrinkage.csv')
# run full DESeq for contrasts vs Strain1
dds <- DESeq(dds)
# get results for each strain vs 1
res97 <- results(dds, contrast=c('Strain','97','1'))
res98 <- results(dds, contrast=c('Strain','98','1'))
res99 <- results(dds, contrast=c('Strain','99','1'))
write.csv(as.data.frame(res97), file='res97_vs1.csv')
write.csv(as.data.frame(res98), file='res98_vs1.csv')
write.csv(as.data.frame(res99), file='res99_vs1.csv')
'''
open('run_deseq2.R','w').write(r_script)
print(r_script)

# %% cell 3
import subprocess, textwrap, os, json, sys
# run R script
result = subprocess.run(['Rscript','run_deseq2.R'], capture_output=True, text=True)
print('STDOUT:', result.stdout[:1000])
print('STDERR:', result.stderr[:1000])

# %% cell 4
import pandas as pd, os
from pathlib import Path
DATA_DIR = os.environ['DATA_DIR']
res97 = pd.read_csv(Path(DATA_DIR)/'res97_vs1.csv', index_col=0)
res98 = pd.read_csv(Path(DATA_DIR)/'res98_vs1.csv', index_col=0)
res99 = pd.read_csv(Path(DATA_DIR)/'res99_vs1.csv', index_col=0)
disp = pd.read_csv(Path(DATA_DIR)/'dispersions_preshrinkage.csv', index_col=0)
print(res97.head())
print(disp.head())

# define sig sets FDR<0.05
sig97 = res97[res97['padj']<0.05]
sig98 = res98[res98['padj']<0.05]
sig99 = res99[res99['padj']<0.05]
print(len(sig97), len(sig98), len(sig99))

# q3: dispersions <1e-5
q3 = (disp.iloc[:,0] < 1e-5).sum()
print('q3', q3)

# add log2FC cutoff for q1 & others
lfc_cut = 1.5
sig97_lfc = sig97[(sig97['log2FoldChange']>lfc_cut) | (sig97['log2FoldChange']<-lfc_cut)]
print('sig97_lfc', len(sig97_lfc))

sig99_lfc = sig99[(sig99['log2FoldChange']>lfc_cut) | (sig99['log2FoldChange']<-lfc_cut)]

# genes in 97 sig_lfc that are also sig_lfc in 99 and not sig in others (98 must be non-sig FDR>=0.05)
shared_97_99 = set(sig97_lfc.index) & set(sig99_lfc.index)
filtered = [g for g in shared_97_99 if not (g in sig98.index)]
perc_q1 = 100*len(filtered)/len(sig97_lfc) if len(sig97_lfc)>0 else 0
print('q1 genes', len(filtered), 'pct', perc_q1)

# q2: uniquely sig in 98 (padj<0.05) but not sig in 97 or 99
uniq98 = [g for g in sig98.index if (g not in sig97.index and g not in sig99.index)]
print('q2 uniq98', len(uniq98))

# q4: uniquely sig in 97 or 98 (vs1), count union of genes that are sig in exactly one of 97,98 and not in 99
uniq97 = [g for g in sig97.index if (g not in sig98.index and g not in sig99.index)]
uniq98_only = [g for g in sig98.index if (g not in sig97.index and g not in sig99.index)]
uniq_97_98 = set(uniq97) | set(uniq98_only)
# percentage of all genes
q4_pct = 100*len(uniq_97_98)/res97.shape[0]
print('q4', len(uniq_97_98), q4_pct)

# q5: uniquely sig in at least one of 97 or 98 but not sig in 99
# interpret as genes sig in 97 or 98 (padj<0.05) but NOT sig in 99
q5_genes = [g for g in set(sig97.index)|set(sig98.index) if g not in sig99.index]
print('q5', len(q5_genes))

# %% cell 5
import pandas as pd
# assume DESeq2 outputs are provided as precomputed results in this capsule
# search for any csvs that look like DESeq2 outputs
import os, glob
print(glob.glob(os.path.join(os.environ['DATA_DIR'], '*.csv')))

