
# %% cell 0
import os, pandas as pd
print(os.environ['DATA_DIR'])

meta_path = os.path.join(os.environ['DATA_DIR'], 'Issy_ASXL1_blood_coldata_gender.xlsx')
counts_path = os.path.join(os.environ['DATA_DIR'], 'Issy_ASXL1_blood_featureCounts_GeneTable_final.txt')

meta = pd.read_excel(meta_path)
print(meta.head())
print(meta.columns)

counts = pd.read_csv(counts_path, sep='\t')
print(counts.head())
print(counts.columns)


# %% cell 1
import subprocess, textwrap, os, json, sys, pathlib, tempfile, shutil

r_script = r'''\
library(DESeq2)
library(clusterProfiler)
library(org.Hs.eg.db)
library(openxlsx)

DATA_DIR <- Sys.getenv('DATA_DIR')
meta_path <- file.path(DATA_DIR, 'Issy_ASXL1_blood_coldata_gender.xlsx')
counts_path <- file.path(DATA_DIR, 'Issy_ASXL1_blood_featureCounts_GeneTable_final.txt')

meta <- read.xlsx(meta_path)
meta$condition <- factor(meta$condition)

raw <- read.table(counts_path, header=TRUE, sep='\t', check.names=FALSE)

# fix formatting: first column plus counts matrix
mat <- as.matrix(raw[,-1])
rownames(mat) <- raw[[1]]
colnames(mat) <- gsub(' +',' ',colnames(mat))
colnames(mat) <- trimws(colnames(mat))

# match samples
meta <- meta[match(colnames(mat), meta$sample),]
all(meta$sample == colnames(mat))

dds <- DESeqDataSetFromMatrix(countData = round(mat),
                              colData = meta,
                              design = ~ condition)

keep <- rowSums(counts(dds)) >= 10
dds <- dds[keep,]

dds <- DESeq(dds)
res <- results(dds, contrast=c('condition','ASXL1','Control'))
res_df <- as.data.frame(res)
res_df$gene <- rownames(res_df)

sig <- subset(res_df, padj < 0.05 & !is.na(padj))

# map Ensembl to ENTREZ
sig$ensembl <- sub('\\.\d+$','', sig$gene)
allgenes <- rownames(res_df)
all_ensembl <- sub('\\.\d+$','', allgenes)

ens2ent <- bitr(unique(c(sig$ensembl, all_ensembl)), fromType='ENSEMBL', toType='ENTREZID', OrgDb=org.Hs.eg.db)

sig_ent <- unique(ens2ent$ENTREZID[match(sig$ensembl, ens2ent$ENSEMBL)])
all_ent <- unique(ens2ent$ENTREZID[match(all_ensembl, ens2ent$ENSEMBL)])

sig_ent <- sig_ent[!is.na(sig_ent)]
all_ent <- all_ent[!is.na(all_ent)]

ego <- enrichGO(gene = sig_ent,
                universe = all_ent,
                OrgDb = org.Hs.eg.db,
                ont = 'BP',
                pAdjustMethod = 'BH',
                pvalueCutoff = 0.05,
                qvalueCutoff = 0.2,
                readable = TRUE)

simp <- simplify(ego, cutoff=0.7, by='p.adjust', select_fun=min)

res_go <- as.data.frame(simp)

# find regulation of T cell activation
term <- res_go[grep('regulation of T cell activation', res_go$Description, ignore.case=TRUE),]
print(term)

saveRDS(list(de_res=res_df, sig_res=sig, ego=ego, simp=simp), file='deseq_go_results.rds')
'''

open('analysis.R','w').write(r_script)

result = subprocess.run(['Rscript','analysis.R'], capture_output=True, text=True)
print(result.stdout)
print('STDERR:', result.stderr)


# %% cell 2
import pickle, os, pandas as pd
print(os.listdir())

