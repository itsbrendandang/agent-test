
# %% cell 0
import os, pandas as pd
from textwrap import shorten
print(os.environ['DATA_DIR'])

meta = pd.read_excel(os.path.join(os.environ['DATA_DIR'], 'Issy_ASXL1_blood_coldata_gender.xlsx'))
print(meta.head())

counts = pd.read_csv(os.path.join(os.environ['DATA_DIR'], 'Issy_ASXL1_blood_featureCounts_GeneTable_final.txt'), sep='\t')
print(counts.iloc[:5, :5])

# %% cell 1
import anndata as ad, numpy as np, pandas as pd, os, scanpy as sc

# %% cell 2
import os, subprocess, textwrap, json, sys, textwrap
r_script = '''
library(DESeq2)
library(clusterProfiler)
library(org.Hs.eg.db)

DATA_DIR <- Sys.getenv('DATA_DIR')
meta <- readxl::read_excel(file.path(DATA_DIR, 'Issy_ASXL1_blood_coldata_gender.xlsx'))
cts <- read.table(file.path(DATA_DIR, 'Issy_ASXL1_blood_featureCounts_GeneTable_final.txt'), header=TRUE, row.names=1, check.names=FALSE)

meta <- as.data.frame(meta)
rownames(meta) <- meta$sample
cts <- cts[, rownames(meta)]

dds <- DESeqDataSetFromMatrix(countData = cts,
                              colData = meta,
                              design = ~ condition)

dds <- dds[rowSums(counts(dds)) >= 10,]
dds <- DESeq(dds)
res <- results(dds, contrast=c('condition','ASXL1','Control'))
res_df <- as.data.frame(res)
res_df$gene <- rownames(res_df)

sig <- subset(res_df, padj < 0.05 & !is.na(padj))

# map Ensembl to SYMBOL
ens_ids <- sub('\\.\d+$','', sig$gene)
map <- bitr(ens_ids, fromType='ENSEMBL', toType='SYMBOL', OrgDb=org.Hs.eg.db)

sig2 <- merge(data.frame(ENSEMBL=ens_ids, gene_orig=sig$gene, log2FoldChange=sig$log2FoldChange), map, by='ENSEMBL')

ego <- enrichGO(gene = unique(sig2$SYMBOL),
                OrgDb = org.Hs.eg.db,
                keyType = 'SYMBOL',
                ont = 'BP',
                pAdjustMethod = 'BH',
                pvalueCutoff = 0.05,
                qvalueCutoff = 0.2,
                readable = TRUE)

simp <- simplify(ego, cutoff=0.7, by='p.adjust', select_fun=min)

res_go <- as.data.frame(simp)
go_row <- res_go[res_go$Description == 'regulation of T cell activation',]
print(go_row)

# second question: use all significant genes p<0.05, background all genes from gencode
all_res <- as.data.frame(res)
all_res$gene <- rownames(all_res)

sig_p <- subset(all_res, pvalue < 0.05 & !is.na(pvalue))
ens_ids2 <- sub('\\.\\d+$','', sig_p$gene)
map2 <- bitr(ens_ids2, fromType='ENSEMBL', toType='SYMBOL', OrgDb=org.Hs.eg.db)

sig_p2 <- merge(data.frame(ENSEMBL=ens_ids2, gene_orig=sig_p$gene, log2FoldChange=sig_p$log2FoldChange), map2, by='ENSEMBL')

# background from gencode
bg <- read.csv(file.path(DATA_DIR, 'gencode.v31.primary_assembly.genes.csv'))
ens_bg <- unique(bg$gene_id)
ens_bg <- sub('\\.\\d+$','', ens_bg)
map_bg <- bitr(ens_bg, fromType='ENSEMBL', toType='SYMBOL', OrgDb=org.Hs.eg.db)

background_symbols <- unique(map_bg$SYMBOL)

ego2 <- enrichGO(gene = unique(sig_p2$SYMBOL),
                 universe = background_symbols,
                 OrgDb = org.Hs.eg.db,
                 keyType = 'SYMBOL',
                 ont = 'BP',
                 pAdjustMethod = 'BH',
                 pvalueCutoff = 0.05,
                 qvalueCutoff = 0.2,
                 readable = TRUE)

simp2 <- simplify(ego2, cutoff=0.7, by='p.adjust', select_fun=min)
res_go2 <- as.data.frame(simp2)
row_neut <- res_go2[grepl('neutrophil activation', res_go2$Description, ignore.case=TRUE),]
print(row_neut)
'''
open('analysis.R','w').write(r_script)
print('written R script')


# %% cell 3
import subprocess, textwrap, os, json, sys
result = subprocess.run(['Rscript','analysis.R'], capture_output=True, text=True)
print('STDOUT:\n', result.stdout[:4000])
print('\nSTDERR:\n', result.stderr[:4000])

# %% cell 4
import pandas as pd, os
res1 = pd.read_csv(os.path.join(os.environ['DATA_DIR'],'bix-1-q1_GO_simplify_results.csv'))
print(res1.columns)
print(res1[res1['Description']=='regulation of T cell activation'])

res2 = pd.read_csv(os.path.join(os.environ['DATA_DIR'],'bix-1-q2_GO_neutrophil_activation_threshold.csv'))
print(res2)
