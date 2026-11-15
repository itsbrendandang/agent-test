"""A fixed small analysis, run without a model in the official arm64 image (local Docker) and
in the amd64 Modal image, to compare the two environments by what they compute.

It uses the tools a BixBench analysis uses: numpy/scipy linear algebra and tests, statsmodels,
scikit-learn, pandas, PyDESeq2 and scanpy in Python; lm/glm/tests, DESeq2 with apeglm and
clusterProfiler in R; mafft, IQ-TREE, BLAST, ClipKIT and PhyKIT on the command line. All data
is generated here from fixed seeds; nothing is downloaded and no benchmark data is used.
Prints one JSON object: {section: {name: number | [numbers] | text}}. One thread everywhere,
so that thread scheduling cannot change a sum.

    python equivalence.py > result.json
"""
import hashlib, json, os, subprocess, sys, tempfile, time, warnings

for name in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS", "NUMBA_NUM_THREADS"):
    os.environ[name] = "1"
warnings.filterwarnings("ignore")
out, errors, timing = {}, {}, {}


def section(name):
    def wrap(function):
        started = time.time()
        try:
            out[name] = function()
        except Exception as error:  # noqa: BLE001
            errors[name] = f"{type(error).__name__}: {error}"[:500]
        timing[name] = round(time.time() - started, 1)
        return function
    return wrap


def numbers(values):
    import numpy as np
    return [float(v) for v in np.asarray(values, dtype=float).ravel()]


def sh(command, cwd=None, timeout=600):
    done = subprocess.run(["bash", "-c", command], capture_output=True, text=True, cwd=cwd, timeout=timeout)
    if done.returncode != 0:
        raise RuntimeError(f"{command[:80]}: exit {done.returncode}: {done.stderr[-300:]}")
    return done.stdout


@section("numpy_linear_algebra")
def _():
    import numpy as np
    rng = np.random.default_rng(20240101)
    a = rng.standard_normal((60, 60)); b = rng.standard_normal(60)
    spd = a @ a.T + 60 * np.eye(60)
    return {
        "random_stream_head": numbers(rng.standard_normal(5)),
        "solve": numbers(np.linalg.solve(spd, b)[:8]),
        "singular_values": numbers(np.linalg.svd(a, compute_uv=False)[:8]),
        "eigenvalues_symmetric": numbers(np.linalg.eigvalsh(spd)[-8:]),
        "determinant_log": float(np.linalg.slogdet(spd)[1]),
        "matmul_trace": float(np.trace(a @ a.T @ a)),
        "sum_exp_log": float(np.sum(np.exp(a) * np.log1p(np.abs(a)))),
    }


@section("scipy_statistics")
def _():
    import numpy as np
    from scipy import stats, optimize, special
    rng = np.random.default_rng(7)
    x = rng.normal(0, 1, 40); y = rng.normal(0.6, 1.3, 35)
    table = [[12, 5], [3, 14]]
    fit = optimize.curve_fit(lambda t, k, c: c * np.exp(-k * t), np.arange(10.0), 3 * np.exp(-0.4 * np.arange(10.0)) + 0.01 * rng.normal(size=10), p0=(0.1, 1.0))[0]
    return {
        "welch_t": numbers(stats.ttest_ind(x, y, equal_var=False)),
        "mann_whitney": numbers(stats.mannwhitneyu(x, y, alternative="two-sided")),
        "fisher_exact": numbers(stats.fisher_exact(table)),
        "chi2_contingency": numbers(stats.chi2_contingency(table)[:2]),
        "pearson": numbers(stats.pearsonr(x[:35], y)),
        "spearman": numbers(stats.spearmanr(x[:35], y)),
        "kruskal": numbers(stats.kruskal(x, y, x[:20] * 2)),
        "shapiro": numbers(stats.shapiro(x)),
        "hypergeom_sf": float(stats.hypergeom.sf(7, 20000, 150, 300)),
        "tiny_p_value": float(stats.norm.sf(12.5)),
        "gammaln_betainc": [float(special.gammaln(123.456)), float(special.betainc(2.5, 7.5, 0.3))],
        "curve_fit": numbers(fit),
    }


@section("statsmodels")
def _():
    import numpy as np, pandas as pd, statsmodels.api as sm
    from statsmodels.stats.multitest import multipletests
    rng = np.random.default_rng(11)
    frame = pd.DataFrame({"x1": rng.normal(size=120), "x2": rng.normal(size=120), "g": rng.integers(0, 3, 120)})
    frame["y"] = 1.5 * frame.x1 - 0.7 * frame.x2 + 0.3 * frame.g + rng.normal(scale=0.8, size=120)
    frame["count"] = rng.poisson(np.exp(0.4 * frame.x1 + 1.0))
    X = sm.add_constant(frame[["x1", "x2", "g"]])
    ols = sm.OLS(frame.y, X).fit()
    poisson = sm.GLM(frame["count"], X, family=sm.families.Poisson()).fit()
    logit = sm.Logit((frame.y > frame.y.median()).astype(int), X).fit(disp=0)
    p = np.sort(rng.uniform(size=50) ** 3)
    return {
        "ols_params": numbers(ols.params), "ols_pvalues": numbers(ols.pvalues), "ols_r2": float(ols.rsquared),
        "poisson_params": numbers(poisson.params), "poisson_deviance": float(poisson.deviance),
        "logit_params": numbers(logit.params), "logit_llf": float(logit.llf),
        "bh_adjusted": numbers(multipletests(p, method="fdr_bh")[1][:10]),
    }


@section("pandas_sklearn")
def _():
    import numpy as np, pandas as pd
    from sklearn.cluster import KMeans
    from sklearn.decomposition import PCA
    from sklearn.linear_model import LogisticRegression
    from sklearn.ensemble import RandomForestClassifier
    rng = np.random.default_rng(3)
    X = rng.normal(size=(200, 12)); X[:100, :3] += 1.5
    y = np.r_[np.zeros(100), np.ones(100)]
    frame = pd.DataFrame(X).assign(group=np.repeat(list("abcd"), 50))
    agg = frame.groupby("group").agg(["mean", "std", "median"]).iloc[:, :6]
    pca = PCA(n_components=4, svd_solver="full").fit(X)
    logistic = LogisticRegression(max_iter=1000, tol=1e-10).fit(X, y)
    forest = RandomForestClassifier(n_estimators=25, random_state=0).fit(X, y)
    kmeans = KMeans(n_clusters=3, n_init=5, random_state=0).fit(X)
    return {
        "groupby": numbers(agg.to_numpy()),
        "quantiles": numbers(frame[0].quantile([0.05, 0.25, 0.5, 0.75, 0.95])),
        "pca_explained_variance": numbers(pca.explained_variance_ratio_),
        "logistic_coefficients": numbers(logistic.coef_),
        "forest_importances": numbers(forest.feature_importances_),
        "forest_predictions": "".join(str(int(v)) for v in forest.predict(X[::10])),
        "kmeans_inertia": float(kmeans.inertia_),
        "kmeans_sizes": sorted(int(v) for v in np.bincount(kmeans.labels_)),
    }


def synthetic_counts(genes=400, samples=12):
    import numpy as np, pandas as pd
    rng = np.random.default_rng(42)
    base = rng.gamma(shape=1.2, scale=80, size=genes)
    effect = np.where(np.arange(genes) < 40, np.where(np.arange(genes) % 2 == 0, 3.0, 1 / 3), 1.0)
    mean = np.outer(np.ones(samples), base)
    mean[samples // 2:] *= effect
    counts = rng.negative_binomial(n=5, p=5 / (5 + mean))
    frame = pd.DataFrame(counts, index=[f"s{i}" for i in range(samples)], columns=[f"gene{i}" for i in range(genes)])
    meta = pd.DataFrame({"condition": ["A"] * (samples // 2) + ["B"] * (samples // 2)}, index=frame.index)
    return frame, meta


@section("pydeseq2")
def _():
    from pydeseq2.dds import DeseqDataSet
    from pydeseq2.ds import DeseqStats
    counts, meta = synthetic_counts()
    dds = DeseqDataSet(counts=counts, metadata=meta, design_factors="condition", quiet=True)
    dds.deseq2()
    stats = DeseqStats(dds, contrast=["condition", "B", "A"], quiet=True)
    stats.summary()
    table = stats.results_df
    return {
        "counts_md5": hashlib.md5(counts.to_csv().encode()).hexdigest(),
        "size_factors": numbers(dds.obsm["size_factors"]),
        "log2_fold_change": numbers(table.log2FoldChange.iloc[:12]),
        "lfc_standard_error": numbers(table.lfcSE.iloc[:12]),
        "dispersions": numbers(dds.varm["dispersions"][:12]),
        "p_values": numbers(table.pvalue.iloc[:12]),
        "adjusted_p": numbers(table.padj.iloc[:12]),
        "significant_at_0.05": int((table.padj < 0.05).sum()),
    }


@section("scanpy")
def _():
    import anndata as ad, numpy as np, scanpy as sc
    counts, meta = synthetic_counts(genes=300, samples=60)
    adata = ad.AnnData(counts.to_numpy().astype(np.float32), obs=meta)
    sc.pp.normalize_total(adata, target_sum=1e4); sc.pp.log1p(adata)
    sc.pp.highly_variable_genes(adata, n_top_genes=100)
    sc.pp.scale(adata, max_value=10)
    sc.tl.pca(adata, n_comps=10, svd_solver="full")
    sc.tl.rank_genes_groups(adata, "condition", method="wilcoxon")
    return {
        "highly_variable": int(adata.var.highly_variable.sum()),
        "dispersions_norm": numbers(adata.var.dispersions_norm.iloc[:8]),
        "pca_variance_ratio": numbers(adata.uns["pca"]["variance_ratio"][:6]),
        "wilcoxon_top_genes": list(adata.uns["rank_genes_groups"]["names"]["B"][:8]),
        "wilcoxon_scores": numbers(adata.uns["rank_genes_groups"]["scores"]["B"][:8]),
    }


R_SCRIPT = r'''
suppressMessages({library(DESeq2); library(apeglm); library(clusterProfiler); library(jsonlite)})
options(digits = 17)
RNGkind("Mersenne-Twister", "Inversion", "Rejection"); set.seed(42)
x <- rnorm(40); y <- rnorm(35, 0.6, 1.3)
d <- data.frame(x1 = rnorm(120), x2 = rnorm(120), g = sample(0:2, 120, TRUE))
d$y <- 1.5 * d$x1 - 0.7 * d$x2 + 0.3 * d$g + rnorm(120, sd = 0.8)
d$count <- rpois(120, exp(0.4 * d$x1 + 1))
fit <- lm(y ~ x1 + x2 + g, d); pois <- glm(count ~ x1 + x2 + g, poisson, d)
res <- list(base = list(
  random_stream_head = rnorm(5),
  lm_coefficients = unname(coef(fit)), lm_p = unname(summary(fit)$coefficients[, 4]),
  glm_coefficients = unname(coef(pois)), glm_deviance = deviance(pois),
  t_test = unname(c(t.test(x, y)$statistic, t.test(x, y)$p.value)),
  wilcox = unname(c(wilcox.test(x, y)$statistic, wilcox.test(x, y)$p.value)),
  fisher = unname(c(fisher.test(matrix(c(12, 3, 5, 14), 2))$estimate, fisher.test(matrix(c(12, 3, 5, 14), 2))$p.value)),
  phyper = phyper(7, 150, 19850, 300, lower.tail = FALSE),
  p_adjust = p.adjust(sort(runif(50)^3), "BH")[1:10],
  prcomp_sdev = prcomp(matrix(rnorm(600), 50), scale. = TRUE)$sdev[1:6]))
set.seed(42)
dds <- makeExampleDESeqDataSet(n = 400, m = 12, betaSD = 1)
dds <- DESeq(dds, quiet = TRUE)
r <- results(dds, contrast = c("condition", "B", "A"))
shrunk <- lfcShrink(dds, coef = "condition_B_vs_A", type = "apeglm", quiet = TRUE)
res$deseq2 <- list(
  counts_md5 = digest::digest(counts(dds), "md5"),
  size_factors = unname(sizeFactors(dds)), dispersions = unname(dispersions(dds)[1:12]),
  log2_fold_change = r$log2FoldChange[1:12], lfc_standard_error = r$lfcSE[1:12],
  p_values = r$pvalue[1:12], adjusted_p = r$padj[1:12],
  significant_at_0.05 = sum(r$padj < 0.05, na.rm = TRUE),
  apeglm_log2_fold_change = shrunk$log2FoldChange[1:12])
genes <- paste0("g", 1:2000)
term2gene <- data.frame(term = rep(paste0("set", 1:20), each = 60), gene = paste0("g", unlist(lapply(1:20, function(i) ((i * 37):(i * 37 + 59)) %% 2000 + 1))))
enriched <- enricher(paste0("g", c(40:110, 500:520)), TERM2GENE = term2gene, universe = genes, pvalueCutoff = 1, qvalueCutoff = 1, minGSSize = 5)
e <- as.data.frame(enriched)
res$clusterprofiler <- list(terms = e$ID[1:5], p_values = e$pvalue[1:5], adjusted_p = e$p.adjust[1:5], counts = e$Count[1:5])
cat(toJSON(res, digits = NA, auto_unbox = TRUE))
'''


@section("r")
def _():
    with tempfile.TemporaryDirectory() as folder:
        path = os.path.join(folder, "check.R")
        open(path, "w").write(R_SCRIPT)
        text = sh(f"OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 Rscript --vanilla {path} 2>/dev/null")
    return json.loads(text[text.index("{"):])


@section("command_line_tools")
def _():
    import numpy as np
    rng = np.random.default_rng(5)
    root = "".join(rng.choice(list("ACGT"), 600))
    def mutate(sequence, rate):
        letters = list(sequence)
        for i in range(len(letters)):
            if rng.random() < rate:
                letters[i] = rng.choice(list("ACGT"))
        cut = int(rng.integers(5, 40))
        return "".join(letters[:300] + letters[300 + cut:]) if rng.random() < 0.5 else "".join(letters)
    taxa = {}
    for clade in range(4):
        ancestor = mutate(root, 0.08)
        for leaf in range(3):
            taxa[f"t{clade}{leaf}"] = mutate(ancestor, 0.03)
    result = {}
    with tempfile.TemporaryDirectory() as folder:
        open(f"{folder}/seqs.fa", "w").write("".join(f">{k}\n{v}\n" for k, v in taxa.items()))
        sh("mafft --auto --thread 1 seqs.fa > aln.fa 2>/dev/null", cwd=folder)
        result["mafft_alignment_md5"] = hashlib.md5(open(f"{folder}/aln.fa", "rb").read()).hexdigest()
        sh("clipkit aln.fa -m gappy -o trimmed.fa > /dev/null", cwd=folder)
        result["clipkit_md5"] = hashlib.md5(open(f"{folder}/trimmed.fa", "rb").read()).hexdigest()
        sh("iqtree2 -s aln.fa -m GTR+G -seed 1 -nt 1 -quiet -redo", cwd=folder)
        report = open(f"{folder}/aln.fa.iqtree").read()
        result["iqtree_log_likelihood"] = float(report.split("Log-likelihood of the tree:")[1].split()[0])
        result["iqtree_tree_length"] = float(report.split("Total tree length (sum of branch lengths):")[1].split()[0])
        tree = open(f"{folder}/aln.fa.treefile").read().strip()
        result["iqtree_topology"] = sh("phykit tip_labels aln.fa.treefile | sort | tr '\\n' ' '", cwd=folder).strip()
        import re
        result["iqtree_topology_only"] = re.sub(r":[0-9.eE+-]+", "", tree)
        result["phykit_total_tree_length"] = float(sh("phykit total_tree_length aln.fa.treefile", cwd=folder).split()[0])
        result["phykit_alignment_length"] = int(sh("phykit alignment_length aln.fa", cwd=folder).split()[0])
        result["phykit_pairwise_identity"] = sh("phykit pairwise_identity aln.fa | head -4", cwd=folder).split()
        sh("makeblastdb -in seqs.fa -dbtype nucl -out db > /dev/null", cwd=folder)
        open(f"{folder}/query.fa", "w").write(f">q\n{root[100:400]}\n")
        hits = sh("blastn -query query.fa -db db -outfmt '6 sseqid pident length mismatch gapopen evalue bitscore' -num_threads 1", cwd=folder)
        result["blastn_hits_md5"] = hashlib.md5(hits.encode()).hexdigest()
        result["blastn_top_hits"] = hits.splitlines()[:3]
    return result


@section("versions")
def _():
    import numpy, scipy, pandas, sklearn, statsmodels, platform
    return {"machine": platform.machine(), "python": platform.python_version(), "numpy": numpy.__version__,
            "scipy": scipy.__version__, "pandas": pandas.__version__, "sklearn": sklearn.__version__,
            "statsmodels": statsmodels.__version__, "cpu_count": os.cpu_count()}


json.dump({"results": out, "errors": errors, "seconds": timing}, sys.stdout, indent=1)
