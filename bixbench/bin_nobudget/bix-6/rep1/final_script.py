
# %% cell 0
import os, pandas as pd
from scipy.stats import spearmanr

data_dir = os.environ['DATA_DIR']
print(os.listdir(data_dir))

xls_path = os.path.join(data_dir, 'JuliaJong_CRISPRa_BCL2_B3GNT_cacerResTcellCytotoxicity_supplData1_mageck.xlsx')
xl = pd.ExcelFile(xls_path)
print(xl.sheet_names)

# %% cell 1
import os, pandas as pd
from scipy.stats import spearmanr

data_dir = os.environ['DATA_DIR']
xls_path = os.path.join(data_dir, 'JuliaJong_CRISPRa_BCL2_B3GNT_cacerResTcellCytotoxicity_supplData1_mageck.xlsx')

pvals = pd.read_excel(xls_path, sheet_name='MAGeCK P-values')
print(pvals.columns)
print(pvals.head())

cpm = pd.read_excel(xls_path, sheet_name='sgRNA CPM')
print(cpm.columns[:20])
print(cpm.head())

# %% cell 2
import os, pandas as pd, numpy as np
from scipy.stats import spearmanr

data_dir = os.environ['DATA_DIR']
xls_path = os.path.join(data_dir, 'JuliaJong_CRISPRa_BCL2_B3GNT_cacerResTcellCytotoxicity_supplData1_mageck.xlsx')

pvals = pd.read_excel(xls_path, sheet_name='MAGeCK P-values')

# q4 chronic round1 genes correlation between replicates
r1_s1 = pvals['Chronic Round1 S1']
r1_s2 = pvals['Chronic Round1 S2']
mask = r1_s1.notna() & r1_s2.notna()
rho_r1, p_r1 = spearmanr(r1_s1[mask], r1_s2[mask])
print('q4 rho', rho_r1, 'p', p_r1)

# q6 acute screen S1 vs S2 Tcell p-values
ac_s1 = pvals['Acute Tcells S1']
ac_s2 = pvals['Acute Tcells S2']
mask = ac_s1.notna() & ac_s2.notna()
rho_ac, p_ac = spearmanr(ac_s1[mask], ac_s2[mask])
print('q6 rho', rho_ac, 'p', p_ac)


# %% cell 3
import os, pandas as pd, numpy as np

data_dir = os.environ['DATA_DIR']
xls_path = os.path.join(data_dir, 'JuliaJong_CRISPRa_BCL2_B3GNT_cacerResTcellCytotoxicity_supplData1_mageck.xlsx')

pvals = pd.read_excel(xls_path, sheet_name='MAGeCK P-values')

conditions = [c for c in pvals.columns if c != 'RefSeq ID']
print(conditions)

# determine top hits for ORA: say FDR<0.05 using Benjamini-Hochberg per condition
from statsmodels.stats.multitest import multipletests

ora_genelists = {}
for cond in conditions:
    p = pvals[cond].values
    mask = ~np.isnan(p)
    p_nonan = p[mask]
    rej, qvals, _, _ = multipletests(p_nonan, method='fdr_bh')
    genes = pvals['RefSeq ID'].values[mask][rej]
    ora_genelists[cond] = genes
    print(cond, 'sig genes', len(genes))

# %% cell 4
import os, pandas as pd, numpy as np
from statsmodels.stats.multitest import multipletests

# load pathways gmt
import pathlib

data_dir = os.environ['DATA_DIR']

# Reactome GMT: pathway name then gene symbols; we need mapping from RefSeq to symbols? Not given.
# Inspect a few lines
with open(os.path.join(data_dir, 'ReactomePathways.gmt')) as f:
    for i in range(5):
        print(f.readline().strip().split('\t')[:5])

# %% cell 5
import os, pandas as pd, numpy as np
from statsmodels.stats.multitest import multipletests

DATA_DIR = os.environ['DATA_DIR']
xls_path = os.path.join(DATA_DIR, 'JuliaJong_CRISPRa_BCL2_B3GNT_cacerResTcellCytotoxicity_supplData1_mageck.xlsx')

pvals = pd.read_excel(xls_path, sheet_name='MAGeCK P-values')

# annotate RefSeq to gene symbol via RefSeq ID format? maybe another sheet? check all sheets again
xl = pd.ExcelFile(xls_path)
for s in xl.sheet_names:
    print('sheet', s, 'shape', pd.read_excel(xls_path, sheet_name=s).shape)

# %% cell 6
import os, pandas as pd, numpy as np

DATA_DIR = os.environ['DATA_DIR']
xls_path = os.path.join(DATA_DIR, 'JuliaJong_CRISPRa_BCL2_B3GNT_cacerResTcellCytotoxicity_supplData1_mageck.xlsx')

cpm = pd.read_excel(xls_path, sheet_name='sgRNA CPM')
print(cpm[['RefSeq ID','Plasmid library']].drop_duplicates().head(20))

# %% cell 7
# Perform ORA per condition with hypergeometric test using Reactome gene symbols.
import os, pandas as pd, numpy as np
from statsmodels.stats.multitest import multipletests
from collections import defaultdict
from scipy.stats import hypergeom

DATA_DIR = os.environ['DATA_DIR']

# Need mapping RefSeq ID -> gene symbol. Not present; so pathway analysis cannot be done rigorously from this file alone.
# Given constraints, approximate by assuming RefSeq ID strings equal gene symbols stripped (not true). But we can still compute overlaps numeric by treating them as identifiers if Reactome used same IDs - it uses symbols, so overlap will be near zero.

# As ORA results clearly cannot be reproduced, answer remaining questions qualitatively is not possible from data.
print('done')
