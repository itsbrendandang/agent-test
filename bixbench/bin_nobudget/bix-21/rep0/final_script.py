
# %% cell 0
import os, zipfile, pandas as pd
from statistics import median

data_dir = os.environ['DATA_DIR']

zf = zipfile.ZipFile(os.path.join(data_dir, 'scogs_fungi.zip'))
print(zf.namelist())

with zf.open('scogs_fungi.tsv') as f:
    df = pd.read_csv(f, sep='\t')

print(df.head())
print(df.columns)

fungal = df[df['kingdom'] == 'Fungi']
print('n fungal genes', len(fungal))
print('saturation col unique', fungal['saturation'].head())

med = fungal['saturation'].median()
print('median', med)

# %% cell 1
import os, zipfile, pandas as pd

data_dir = os.environ['DATA_DIR']

zf = zipfile.ZipFile(os.path.join(data_dir, 'scogs_fungi.zip'))
print([n for n in zf.namelist() if n.endswith('.tsv')][:20])


# %% cell 2
import os, zipfile, pandas as pd

data_dir = os.environ['DATA_DIR']

zf = zipfile.ZipFile(os.path.join(data_dir, 'scogs_fungi.zip'))

meta = [n for n in zf.namelist() if n.endswith('.metadata.tsv')]
print(meta)
with zf.open(meta[0]) as f:
    df = pd.read_csv(f, sep='\t')
print(df.head())
print(df.columns)

fungal = df[df['kingdom'] == 'Fungi']
print('n fungal genes', len(fungal))
med = fungal['saturation'].median()
print('median', med)

# %% cell 3
import os, zipfile

data_dir = os.environ['DATA_DIR']

zf = zipfile.ZipFile(os.path.join(data_dir, 'scogs_fungi.zip'))

names = zf.namelist()
print(len(names))
print(names[:50])

# %% cell 4
import os, zipfile, pandas as pd

data_dir = os.environ['DATA_DIR']

zf = zipfile.ZipFile(os.path.join(data_dir, 'scogs_animals.zip'))
print([n for n in zf.namelist() if n.endswith('.tsv')][:50])

# %% cell 5
import os, tarfile

data_dir = os.environ['DATA_DIR']

with tarfile.open(os.path.join(data_dir, 'eukaryota_odb10.2024-01-08.tar.gz')) as tf:
    names = tf.getnames()
print(len(names))
print(names[:50])


# %% cell 6
import os, tarfile, pandas as pd

data_dir = os.environ['DATA_DIR']

with tarfile.open(os.path.join(data_dir, 'eukaryota_odb10.2024-01-08.tar.gz')) as tf:
    stats_name = [n for n in tf.getnames() if n.endswith('ancestral_info.tsv')][0]
    print(stats_name)
    f = tf.extractfile(stats_name)
    df = pd.read_csv(f, sep='\t')

print(df.head())
print(df.columns)
fungal = df[df['kingdom']=='Fungi']
print('n fungal', len(fungal))
print('median saturation', fungal['saturation'].median())

# %% cell 7
import os, tarfile

data_dir = os.environ['DATA_DIR']

with tarfile.open(os.path.join(data_dir, 'eukaryota_odb10.2024-01-08.tar.gz')) as tf:
    names = tf.getnames()

print([n for n in names if n.endswith('.tsv')])
