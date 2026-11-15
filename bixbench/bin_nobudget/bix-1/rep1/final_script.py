
# %% cell 0
import os, pandas as pd
print(os.environ['DATA_DIR'])


# %% cell 1
import os, pandas as pd
base=os.environ['DATA_DIR']
counts_path=os.path.join(base,'Issy_ASXL1_blood_featureCounts_GeneTable_final.txt')
meta_path=os.path.join(base,'Issy_ASXL1_blood_coldata_gender.xlsx')
print(counts_path, meta_path)
counts=pd.read_csv(counts_path, sep='\t')
print(counts.head())
meta=pd.read_excel(meta_path)
print(meta.head())


# %% cell 2
import pandas as pd, os
base=os.environ['DATA_DIR']
anno_path=os.path.join(base,'gencode.v31.primary_assembly.genes.csv')
anno=pd.read_csv(anno_path)
print(anno.head())
print(anno.columns)

