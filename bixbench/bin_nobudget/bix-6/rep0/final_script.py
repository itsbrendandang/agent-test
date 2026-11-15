
# %% cell 0
import os, pandas as pd, numpy as np, scipy.stats as stats
from statsmodels.stats.multitest import multipletests

data_path = os.environ['DATA_DIR']
print(os.listdir(data_path))
file_path = os.path.join(data_path, 'JuliaJong_CRISPRa_BCL2_B3GNT_cacerResTcellCytotoxicity_supplData1_mageck.xlsx')
xl = pd.ExcelFile(file_path)
print(xl.sheet_names)


# %% cell 1
import os, pandas as pd
from pprint import pprint

file_path = os.path.join(os.environ['DATA_DIR'], 'JuliaJong_CRISPRa_BCL2_B3GNT_cacerResTcellCytotoxicity_supplData1_mageck.xlsx')

cpm = pd.read_excel(file_path, sheet_name='sgRNA CPM')
enr = pd.read_excel(file_path, sheet_name='sgRNA enrichment')
mag = pd.read_excel(file_path, sheet_name='MAGeCK P-values')

print(cpm.head())
print('\nColumns:', cpm.columns.tolist())
print('\nMAGeCK head')
print(mag.head())
print('\nMAG cols', mag.columns.tolist())


# %% cell 2
import os, pandas as pd

gmt_path = os.path.join(os.environ['DATA_DIR'], 'ReactomePathways.gmt')
with open(gmt_path) as f:
    for i in range(5):
        print(f.readline().strip()[:200])


# %% cell 3
import pandas as pd, os, numpy as np
from statsmodels.stats.multitest import multipletests
from collections import defaultdict
import scipy.stats as stats

data_path = os.environ['DATA_DIR']
mag = pd.read_excel(os.path.join(data_path, 'JuliaJong_CRISPRa_BCL2_B3GNT_cacerResTcellCytotoxicity_supplData1_mageck.xlsx'), sheet_name='MAGeCK P-values')

# map RefSeq to gene symbol via sgRNA sheet
cpm = pd.read_excel(os.path.join(data_path, 'JuliaJong_CRISPRa_BCL2_B3GNT_cacerResTcellCytotoxicity_supplData1_mageck.xlsx'), sheet_name='sgRNA CPM')
ref_to_gene = dict(zip(cpm['RefSeq ID'], cpm['Plasmid library']))
mag['gene'] = mag['RefSeq ID'].map(ref_to_gene)
mag = mag.dropna(subset=['gene'])

# load pathways
gmt_path = os.path.join(data_path, 'ReactomePathways.gmt')
pathways = {}
with open(gmt_path) as f:
    for line in f:
        parts = line.strip().split('\t')
        if len(parts) < 3: continue
        pathways[parts[0]] = set(parts[2:])

# background gene set
bg_genes = set(mag['gene'].unique())

conditions = ['Acute Tcells', 'Acute ESOTcells', 'Chronic Round1', 'Chronic Round2', 'Chronic Round3']
round_cols = {
    'Acute Tcells': ['Acute Tcells S1', 'Acute Tcells S2'],
    'Acute ESOTcells': ['Acute ESOTcells S1', 'Acute ESOTcells S2'],
    'Chronic Round1': ['Chronic Round1 S1', 'Chronic Round1 S2'],
    'Chronic Round2': ['Chronic Round2 S1', 'Chronic Round2 S2'],
    'Chronic Round3': ['Chronic Round3 S1', 'Chronic Round3 S2'],
}

sig_gene_sets = {}
for cond, cols in round_cols.items():
    # genes significant in either replicate at 0.05 FDR
    pvals = mag[cols]
    for col in cols:
        mag[f'{col}_fdr'] = multipletests(mag[col], method='fdr_bh')[1]
    sig = set(mag.loc[(mag[f'{cols[0]}_fdr']<0.05) | (mag[f'{cols[1]}_fdr']<0.05), 'gene'])
    sig_gene_sets[cond] = sig

# over-representation using Fisher's exact; compute p for each replicate separately, then combine across replicates via min p
results = defaultdict(list)
for cond, cols in round_cols.items():
    for rep in cols:
        pvals_path = []
        for pname, genes in pathways.items():
            overlap = sig_gene_sets[cond] & genes
            a = len(overlap)
            b = len(genes - overlap)
            c = len(sig_gene_sets[cond] - overlap)
            d = len(bg_genes - genes - sig_gene_sets[cond])
            table = [[a,b],[c,d]]
            _, p = stats.fisher_exact(table, alternative='greater')
            pvals_path.append(p)
        # multiple testing per replicate
        pvals_adj = multipletests(pvals_path, method='fdr_bh')[1]
        for (pname,_genes), p, padj in zip(pathways.items(), pvals_path, pvals_adj):
            results[(cond,pname)].append((rep,p,padj))

# for each condition+pathway, get min p across reps, then FDR overall per condition
cond_min_p = {cond: [] for cond in conditions}
for (cond,pname), reps in results.items():
    min_p = min(r[1] for r in reps)
    cond_min_p[cond].append((pname, min_p))

strongest = None
for cond in conditions:
    ps = [p for _,p in cond_min_p[cond]]
    padj = multipletests(ps, method='fdr_bh')[1]
    min_padj = padj.min()
    print(cond, 'min adj p', min_padj)
    if strongest is None or min_padj < strongest[1]:
        strongest = (cond, min_padj)

print('strongest condition:', strongest)


# %% cell 4
import os, pandas as pd, numpy as np, scipy.stats as stats
from statsmodels.stats.multitest import multipletests

data_path = os.environ['DATA_DIR']
mag = pd.read_excel(os.path.join(data_path, 'JuliaJong_CRISPRa_BCL2_B3GNT_cacerResTcellCytotoxicity_supplData1_mageck.xlsx'), sheet_name='MAGeCK P-values')
print(mag.columns)


# %% cell 5
import os, pandas as pd, numpy as np, scipy.stats as stats
from statsmodels.stats.multitest import multipletests

file_path = os.path.join(os.environ['DATA_DIR'], 'JuliaJong_CRISPRa_BCL2_B3GNT_cacerResTcellCytotoxicity_supplData1_mageck.xlsx')
mag = pd.read_excel(file_path, sheet_name='MAGeCK P-values')
cpm = pd.read_excel(file_path, sheet_name='sgRNA CPM')

# Map RefSeq to gene symbol
ref_to_gene = dict(zip(cpm['RefSeq ID'], cpm['Plasmid library']))
mag['gene'] = mag['RefSeq ID'].map(ref_to_gene)
mag = mag.dropna(subset=['gene'])

# Load pathways
gmt_path = os.path.join(os.environ['DATA_DIR'], 'ReactomePathways.gmt')
pathways = {}
with open(gmt_path) as f:
    for line in f:
        parts = line.strip().split('\t')
        if len(parts) < 3: continue
        pathways[parts[0]] = set(parts[2:])

bg_genes = set(mag['gene'].unique())

round_cols = {
    'Acute Tcells': ['Acute Tcells S1', 'Acute Tcells S2'],
    'Chronic Round1': ['Chronic Round1 S1', 'Chronic Round1 S2'],
    'Chronic Round2': ['Chronic Round2 S1', 'Chronic Round2 S2'],
    'Chronic Round3': ['Chronic Round3 S1', 'Chronic Round3 S2'],
}

# define immune-relevant pathways as those containing terms like TCR, interferon, cytokine, etc.
immune_keywords = ['TCR', 'INTERFERON', 'CYTOKINE', 'INTERLEUKIN', 'IMMUNE', 'ANTIGEN', 'MHC', 'TLR', 'INFLAM']
immune_paths = {name: genes for name, genes in pathways.items() if any(k in name.upper() for k in immune_keywords)}

from collections import defaultdict

# ORA and min-p across replicates
cond_path_pmin = {cond: {} for cond in round_cols}
cond_immune_sig = {cond: False for cond in round_cols}

for cond, cols in round_cols.items():
    # call genes "hits" if either replicate FDR <0.05
    for col in cols:
        mag[col + '_fdr'] = multipletests(mag[col], method='fdr_bh')[1]
    sig_genes = set(mag.loc[(mag[cols[0] + '_fdr']<0.05) | (mag[cols[1] + '_fdr']<0.05), 'gene'])

    pvals_min = []
    names = []
    for pname, genes in pathways.items():
        min_p = 1.0
        for col in cols:
            a = len(sig_genes & genes)
            b = len(genes - sig_genes)
            c = len(sig_genes - genes)
            d = len(bg_genes - genes - sig_genes)
            _, p = stats.fisher_exact([[a,b],[c,d]], alternative='greater')
            if p < min_p:
                min_p = p
        pvals_min.append(min_p)
        names.append(pname)
    padj = multipletests(pvals_min, method='fdr_bh')[1]
    for n, p, q in zip(names, pvals_min, padj):
        cond_path_pmin[cond][n] = q
    # immune relevant significance
    cond_immune_sig[cond] = any(cond_path_pmin[cond][n] < 0.05 for n in immune_paths)

print('Min adj p per condition (best pathway):')
for cond in round_cols:
    best = min(cond_path_pmin[cond].items(), key=lambda x: x[1])
    print(cond, best)

print('\nImmune-relevant pathways significant per condition:')
for cond, sig in cond_immune_sig.items():
    print(cond, sig)

# chronic rounds shared sig pathways (q<0.05 in all three)
chronic_rounds = ['Chronic Round1','Chronic Round2','Chronic Round3']

shared = set(pathways.keys())
for cond in chronic_rounds:
    sig_paths = {n for n,q in cond_path_pmin[cond].items() if q<0.05}
    shared &= sig_paths
print('\nShared significant pathways in all 3 chronic rounds:', len(shared))

# chronic round2 most significant pathway
best_r2 = min(cond_path_pmin['Chronic Round2'].items(), key=lambda x: x[1])
print('\nChronic Round2 top pathway:', best_r2)

# Spearman correlations for chronic round1 genes between S1 and S2
from scipy.stats import spearmanr

rho_ch1, p_ch1 = spearmanr(mag['Chronic Round1 S1'], mag['Chronic Round1 S2'])
print('\nSpearman chronic round1 S1 vs S2:', rho_ch1, p_ch1)

# Spearman for acute screen MAGeCK p-values S1 vs S2 (acute Tcells)
rho_acute, p_acute = spearmanr(mag['Acute Tcells S1'], mag['Acute Tcells S2'])
print('Spearman acute Tcells S1 vs S2:', rho_acute, p_acute)

