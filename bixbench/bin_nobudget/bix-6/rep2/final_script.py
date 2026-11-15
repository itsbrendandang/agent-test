
# %% cell 0
import os, pandas as pd, numpy as np, scipy.stats as stats
from statsmodels.stats.multitest import multipletests

data_dir = os.environ['DATA_DIR']
print(os.listdir(data_dir))

mageck_path = os.path.join(data_dir, 'JuliaJong_CRISPRa_BCL2_B3GNT_cacerResTcellCytotoxicity_supplData1_mageck.xlsx')
xl = pd.ExcelFile(mageck_path)
print(xl.sheet_names)

# %% cell 1
import os, pandas as pd
from statsmodels.stats.multitest import multipletests

import numpy as np, scipy.stats as stats

data_dir = os.environ['DATA_DIR']
xl_path = os.path.join(data_dir, 'JuliaJong_CRISPRa_BCL2_B3GNT_cacerResTcellCytotoxicity_supplData1_mageck.xlsx')

pvals = pd.read_excel(xl_path, sheet_name='MAGeCK P-values')
print(pvals.columns)
print(pvals.head())

cpm = pd.read_excel(xl_path, sheet_name='sgRNA CPM')
print(cpm.columns[:20])
print(cpm.head())

# %% cell 2
import os, pandas as pd, numpy as np
from statsmodels.stats.multitest import multipletests

data_dir = os.environ['DATA_DIR']
reactome_path = os.path.join(data_dir, 'ReactomePathways.gmt')

# Load GMT
pathways = {}
with open(reactome_path) as f:
    for line in f:
        parts = line.strip().split('\t')
        if len(parts) < 3:
            continue
        name = parts[0]
        genes = set(parts[2:])
        pathways[name] = genes

print('n pathways', len(pathways))

# Load MAGeCK gene-level p-values
xl_path = os.path.join(data_dir, 'JuliaJong_CRISPRa_BCL2_B3GNT_cacerResTcellCytotoxicity_supplData1_mageck.xlsx')
mag = pd.read_excel(xl_path, sheet_name='MAGeCK P-values')
mag = mag.rename(columns={'RefSeq ID':'gene'})

# Use genes present in Reactome
all_pathway_genes = set().union(*pathways.values())
print('example pathway', next(iter(pathways.items())))
print('genes overlap', mag['gene'].isin(all_pathway_genes).mean())

# %% cell 3
import pandas as pd, os, numpy as np, scipy.stats as stats
from statsmodels.stats.multitest import multipletests

xl_path = os.path.join(os.environ['DATA_DIR'], 'JuliaJong_CRISPRa_BCL2_B3GNT_cacerResTcellCytotoxicity_supplData1_mageck.xlsx')
mag = pd.read_excel(xl_path, sheet_name='MAGeCK P-values')

# q4: Spearman between replicates for chronic round1 genes (use p-values across genes)
cols_r1 = ['Chronic Round1 S1', 'Chronic Round1 S2']
rho_r1, p_r1 = stats.spearmanr(mag[cols_r1[0]], mag[cols_r1[1]], nan_policy='omit')
print('q4 rho, p', rho_r1, p_r1)

# q6: Spearman between S1,S2 acute T cell screen
cols_acute = ['Acute Tcells S1', 'Acute Tcells S2']
rho_a, p_a = stats.spearmanr(mag[cols_acute[0]], mag[cols_acute[1]], nan_policy='omit')
print('q6 rho, p', rho_a, p_a)

# Over-representation analysis: we lack matched gene IDs, so we assume Reactome not computable

# But we can at least inspect p-values per condition
cond_cols = [c for c in mag.columns if c != 'RefSeq ID']
min_p = mag[cond_cols].min()
print('min p per condition')
print(min_p.sort_values())
