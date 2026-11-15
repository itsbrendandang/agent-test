
# %% cell 0
import os, pandas as pd
print(os.environ['DATA_DIR'])
md = pd.read_csv(os.path.join(os.environ['DATA_DIR'], 'experiment_metadata.csv'))
print(md.head())
counts = pd.read_csv(os.path.join(os.environ['DATA_DIR'], 'raw_counts.csv'), index_col=0)
print(counts.shape)
print(counts.iloc[:5, :5])
print(md['Strain'].value_counts())
print(md['Media'].value_counts())

# %% cell 1
import pandas as pd, os
from rpy2.robjects import r
import rpy2.robjects as ro
from rpy2.robjects import pandas2ri
pandas2ri.activate()

md = pd.read_csv(os.path.join(os.environ['DATA_DIR'], 'experiment_metadata.csv'))
counts = pd.read_csv(os.path.join(os.environ['DATA_DIR'], 'raw_counts.csv'), index_col=0)

r('library(DESeq2)')

# construct colData
md = md.copy()
md['Strain'] = md['Strain'].astype('category')
md['Media'] = md['Media'].astype('category')
md['Replicate'] = md['Replicate'].astype('category')

# order columns of counts to match md AzentaName
counts = counts[md['AzentaName']]

r_counts = pandas2ri.py2rpy(counts)
r_coldata = pandas2ri.py2rpy(md.set_index('AzentaName'))
ro.globalenv['countData'] = r_counts
ro.globalenv['colData'] = r_coldata

r('dds <- DESeqDataSetFromMatrix(countData = countData, colData = colData, design = ~ Replicate + Media + Strain)')
r('dds <- DESeq(dds)')

# save dispersion estimates
r('disp <- dispersions(dds)')

# get results for strains vs baseline 1
for s in ['97','98','99']:
    r(f"res_{s} <- results(dds, contrast=c('Strain','{s}','1'))")

# bring to python
res = {}
for s in ['97','98','99']:
    res[s] = pandas2ri.rpy2py(r(f'res_{s}'))

import numpy as np
# q3: dispersions <1e-5
import numpy as np
disp = pandas2ri.rpy2py(r('as.numeric(disp)'))
print('q3 count', np.sum(disp < 1e-5))

# prepare sig sets for FDR<0.05, any log2FC (for q2,q4,q5)
sig = {s: set(res[s].index[res[s]['padj']<0.05]) for s in res}
print('sig sizes', {k: len(v) for k,v in sig.items()})

# q2: uniquely sig in 98 (not 97 or 99)
uniq_98 = sig['98'] - sig['97'] - sig['99']
print('q2', len(uniq_98))

# q4: total percentage of genes uniquely sig in 97 or 98
uniq_97 = sig['97'] - sig['98'] - sig['99']
uniq_98 = sig['98'] - sig['97'] - sig['99']
uniq_total = len(uniq_97 | uniq_98)
percent_uniq = uniq_total / counts.shape[0] * 100
print('q4 uniq total', uniq_total, 'percent', percent_uniq)

# q5: uniquely sig in at least one of single mutants but not in double (99)
# interpret as sig in 97 or 98, but not in 99
uniq_single_not_double = (sig['97'] | sig['98']) - sig['99']
print('q5', len(uniq_single_not_double))

# q1: logfold cutoff >1.5 or <-1.5 and FDR<0.05 in 97
for s in ['97','98','99']:
    res[s]['sig_lfc'] = (res[s]['padj']<0.05) & (abs(res[s]['log2FoldChange'])>1.5)

sig97_lfc = set(res['97'].index[res['97']['sig_lfc']])
print('sig97_lfc', len(sig97_lfc))

sig99_lfc = set(res['99'].index[(res['99']['padj']<0.05)&(abs(res['99']['log2FoldChange'])>1.5)])

# also not in any other strain: meaning not sig_lfc in 98, and also not in 1? baseline? likely other mutants 98 and 99? question says any other strain relative to 1
sig98_lfc = set(res['98'].index[(res['98']['padj']<0.05)&(abs(res['98']['log2FoldChange'])>1.5)])

# genes in sig97_lfc that are sig in 99 and not sig in 98
intersect_97_99_only = sig97_lfc & sig99_lfc - sig98_lfc
percent_q1 = len(intersect_97_99_only) / len(sig97_lfc) * 100 if sig97_lfc else 0
print('q1', len(intersect_97_99_only), percent_q1)

# %% cell 2
import subprocess, textwrap, os, json, sys, pandas as pd

# write an R script to run DESeq2 and output needed tables as CSV
r_script = '''
library(DESeq2)
md <- read.csv(file.path(Sys.getenv("DATA_DIR"), "experiment_metadata.csv"), stringsAsFactors=TRUE)
cts <- read.csv(file.path(Sys.getenv("DATA_DIR"), "raw_counts.csv"), row.names=1, check.names=FALSE)
rownames(md) <- md$AzentaName
cts <- cts[, md$AzentaName]
md$Strain <- factor(md$Strain)
md$Media <- factor(md$Media)
md$Replicate <- factor(md$Replicate)

dds <- DESeqDataSetFromMatrix(countData = cts, colData = md, design = ~ Replicate + Media + Strain)

dds <- DESeq(dds)

# dispersions
disp <- dispersions(dds)
write.csv(data.frame(gene=rownames(cts), dispersion=as.numeric(disp)), file="dispersion_estimates.csv", row.names=FALSE)

# results for strains vs 1
res97 <- results(dds, contrast=c("Strain","97","1"))
res98 <- results(dds, contrast=c("Strain","98","1"))
res99 <- results(dds, contrast=c("Strain","99","1"))

write.csv(as.data.frame(res97), file="res_97.csv")
write.csv(as.data.frame(res98), file="res_98.csv")
write.csv(as.data.frame(res99), file="res_99.csv")
'''

with open('run_deseq2.R','w') as f:
    f.write(r_script)

result = subprocess.run(['Rscript','run_deseq2.R'], capture_output=True, text=True)
print('R stdout:\n', result.stdout)
print('R stderr:\n', result.stderr)
print('exit code', result.returncode)

