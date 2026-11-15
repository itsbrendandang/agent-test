# The same fixed analysis in the official image and in the Modal image

Made by `python -m bixbench_v1.modal_image compare-equivalence` from the two result files in
this folder (`equivalence.arm64-official.json`, `equivalence.amd64-modal.json`). The script is
`tools/equivalence.py`: seeded synthetic data, no model, no network, one thread.

- Official: {'machine': 'aarch64', 'python': '3.12.2', 'numpy': '2.0.2', 'scipy': '1.14.1', 'pandas': '2.2.3', 'sklearn': '1.6.0', 'statsmodels': '0.14.4', 'cpu_count': 14}
- Modal: {'machine': 'x86_64', 'python': '3.12.2', 'numpy': '2.0.2', 'scipy': '1.14.1', 'pandas': '2.2.3', 'sklearn': '1.6.0', 'statsmodels': '0.14.4', 'cpu_count': 4}
- Errors: official none, Modal none
- Values compared: 419; identical: 238
- Numbers: 372; identical to the last bit: 191; fewest agreeing significant digits in any number: 5
- Text or integer values that differ: none

A double holds 15 to 17 significant digits. Two CPU architectures use different compiled
kernels (OpenBLAS, libm, fused multiply-add), so the last one to three digits of a direct
calculation can differ; an iterative fit stops at its tolerance and agrees to fewer.
scanpy computes in single precision (float32, about 7 significant digits), so its numbers
can agree to 7 digits at most.

| section | values | identical | fewest agreeing digits | where |
|---|---|---|---|---|
| command_line_tools | 22 | 22 | all identical |  |
| numpy_linear_algebra | 32 | 10 | 14 | numpy_linear_algebra.eigenvalues_symmetric[0] |
| pandas_sklearn | 62 | 42 | 14 | pandas_sklearn.logistic_coefficients[11] |
| pydeseq2 | 74 | 14 | 12 | pydeseq2.adjusted_p[0] |
| r.base | 41 | 32 | 13 | r.base.glm_coefficients[3] |
| r.clusterprofiler | 20 | 18 | 14 | r.clusterprofiler.adjusted_p[0] |
| r.deseq2 | 86 | 53 | 12 | r.deseq2.apeglm_log2_fold_change[2] |
| scanpy | 31 | 19 | 5 | scanpy.pca_variance_ratio[1] |
| scipy_statistics | 22 | 16 | 10 | scipy_statistics.curve_fit[0] |
| statsmodels | 29 | 12 | 13 | statsmodels.ols_pvalues[1] |

## Every value that differs

| value | official | Modal | agreeing digits |
|---|---|---|---|
| numpy_linear_algebra.eigenvalues_symmetric[0] | 210.09002705776228 | 210.090027057762 | 14 |
| numpy_linear_algebra.eigenvalues_symmetric[1] | 223.99523952950142 | 223.99523952950128 | 15 |
| numpy_linear_algebra.eigenvalues_symmetric[2] | 232.80341609977484 | 232.80341609977486 | 15 |
| numpy_linear_algebra.eigenvalues_symmetric[3] | 236.37245577909889 | 236.3724557790989 | 15 |
| numpy_linear_algebra.eigenvalues_symmetric[4] | 238.18191247459166 | 238.18191247459174 | 15 |
| numpy_linear_algebra.eigenvalues_symmetric[5] | 250.70852577005854 | 250.70852577005843 | 15 |
| numpy_linear_algebra.eigenvalues_symmetric[6] | 269.0557852515012 | 269.05578525150185 | 14 |
| numpy_linear_algebra.eigenvalues_symmetric[7] | 284.72814272936245 | 284.7281427293624 | 15 |
| numpy_linear_algebra.matmul_trace | 238.17149950550913 | 238.1714995055092 | 15 |
| numpy_linear_algebra.singular_values[0] | 14.990935352050666 | 14.990935352050661 | 15 |
| numpy_linear_algebra.singular_values[1] | 14.458761539340124 | 14.45876153934013 | 15 |
| numpy_linear_algebra.singular_values[2] | 13.80972576737346 | 13.809725767373457 | 15 |
| numpy_linear_algebra.singular_values[3] | 13.34847978140551 | 13.348479781405505 | 15 |
| numpy_linear_algebra.singular_values[5] | 13.145471315239131 | 13.14547131523913 | 15 |
| numpy_linear_algebra.singular_values[7] | 12.251123501857377 | 12.251123501857382 | 15 |
| numpy_linear_algebra.solve[0] | 0.010895871550575002 | 0.010895871550575 | 15 |
| numpy_linear_algebra.solve[1] | 0.013542462162267482 | 0.01354246216226748 | 15 |
| numpy_linear_algebra.solve[3] | 0.004398746683375022 | 0.00439874668337502 | 15 |
| numpy_linear_algebra.solve[4] | 0.022473969772285416 | 0.022473969772285402 | 15 |
| numpy_linear_algebra.solve[5] | -0.013426505458246623 | -0.013426505458246621 | 15 |
| numpy_linear_algebra.solve[6] | -0.006791832464920575 | -0.006791832464920578 | 15 |
| numpy_linear_algebra.solve[7] | -0.01563192545347683 | -0.015631925453476823 | 15 |
| pandas_sklearn.forest_importances[11] | 0.029763098641722427 | 0.02976309864172243 | 15 |
| pandas_sklearn.forest_importances[1] | 0.22806886291296458 | 0.22806886291296455 | 15 |
| pandas_sklearn.forest_importances[2] | 0.15422131857648133 | 0.15422131857648136 | 15 |
| pandas_sklearn.forest_importances[5] | 0.03430707584242317 | 0.034307075842423165 | 15 |
| pandas_sklearn.forest_importances[7] | 0.048922657192533754 | 0.04892265719253374 | 15 |
| pandas_sklearn.forest_importances[9] | 0.04227475525535246 | 0.042274755255352445 | 15 |
| pandas_sklearn.logistic_coefficients[0] | -1.5850692135889235 | -1.5850692135889228 | 15 |
| pandas_sklearn.logistic_coefficients[10] | -0.029858257508374408 | -0.029858257508374435 | 15 |
| pandas_sklearn.logistic_coefficients[11] | 0.12258622894065059 | 0.12258622894065038 | 14 |
| pandas_sklearn.logistic_coefficients[2] | -1.1604105549888712 | -1.1604105549888708 | 15 |
| pandas_sklearn.logistic_coefficients[3] | 0.21529181296771097 | 0.21529181296771113 | 15 |
| pandas_sklearn.logistic_coefficients[4] | -0.42332911789448446 | -0.42332911789448396 | 14 |
| pandas_sklearn.logistic_coefficients[5] | 0.1299561235117143 | 0.12995612351171454 | 14 |
| pandas_sklearn.logistic_coefficients[6] | 0.1609681503747061 | 0.16096815037470605 | 15 |
| pandas_sklearn.logistic_coefficients[7] | -0.3250363241915317 | -0.32503632419153183 | 15 |
| pandas_sklearn.logistic_coefficients[8] | 0.04156223918003293 | 0.04156223918003276 | 14 |
| pandas_sklearn.logistic_coefficients[9] | -0.048644634314575254 | -0.04864463431457509 | 14 |
| pandas_sklearn.pca_explained_variance[0] | 0.19044858110196103 | 0.1904485811019609 | 15 |
| pandas_sklearn.pca_explained_variance[1] | 0.10702580734023409 | 0.10702580734023404 | 15 |
| pandas_sklearn.pca_explained_variance[2] | 0.09621109621536914 | 0.09621109621536918 | 15 |
| pydeseq2.adjusted_p[0] | 1.0030000038119914e-05 | 1.0030000038115577e-05 | 12 |
| pydeseq2.adjusted_p[10] | 0.0017911345992832532 | 0.0017911345992826574 | 12 |
| pydeseq2.adjusted_p[11] | 0.022763560986111004 | 0.02276356098610818 | 12 |
| pydeseq2.adjusted_p[1] | 5.02491135225106e-06 | 5.0249113522490985e-06 | 12 |
| pydeseq2.adjusted_p[2] | 8.314095749238877e-08 | 8.314095749235493e-08 | 12 |
| pydeseq2.adjusted_p[3] | 2.252526376989395e-05 | 2.2525263769886425e-05 | 12 |
| pydeseq2.adjusted_p[4] | 5.068000852350515e-07 | 5.068000852348242e-07 | 12 |
| pydeseq2.adjusted_p[5] | 0.001795999272956973 | 0.001795999272956664 | 12 |
| pydeseq2.adjusted_p[6] | 1.9407322582305613e-05 | 1.9407322582298888e-05 | 12 |
| pydeseq2.adjusted_p[7] | 0.005452245093626604 | 0.005452245093625774 | 12 |
| pydeseq2.adjusted_p[8] | 0.007612653203128578 | 0.007612653203127203 | 12 |
| pydeseq2.adjusted_p[9] | 0.14716953089931145 | 0.1471695308993001 | 13 |
| pydeseq2.dispersions[0] | 0.10564666770171467 | 0.10564666770171144 | 13 |
| pydeseq2.dispersions[10] | 0.20645737779451423 | 0.20645737779450984 | 13 |
| pydeseq2.dispersions[11] | 0.2168112281232829 | 0.21681122812327708 | 13 |
| pydeseq2.dispersions[1] | 0.13873892609206367 | 0.1387389260920597 | 13 |
| pydeseq2.dispersions[2] | 0.1184819294288197 | 0.11848192942881638 | 13 |
| pydeseq2.dispersions[3] | 0.16233127615357568 | 0.16233127615357135 | 13 |
| pydeseq2.dispersions[4] | 0.14707905808399532 | 0.14707905808399174 | 13 |
| pydeseq2.dispersions[5] | 0.16290857200791592 | 0.16290857200791187 | 13 |
| pydeseq2.dispersions[6] | 0.11301671216800559 | 0.11301671216800298 | 13 |
| pydeseq2.dispersions[7] | 0.22990678587560348 | 0.22990678587559832 | 13 |
| pydeseq2.dispersions[8] | 0.307447064883166 | 0.3074470648831607 | 13 |
| pydeseq2.dispersions[9] | 0.254262946188302 | 0.25426294618829587 | 13 |
| pydeseq2.lfc_standard_error[0] | 0.28272892336806194 | 0.282728923368058 | 13 |
| pydeseq2.lfc_standard_error[10] | 0.3810680247434421 | 0.38106802474343804 | 13 |
| pydeseq2.lfc_standard_error[11] | 0.41505629307856673 | 0.4150562930785619 | 13 |
| pydeseq2.lfc_standard_error[1] | 0.3280992459072779 | 0.32809924590727374 | 13 |
| pydeseq2.lfc_standard_error[2] | 0.2975829295361642 | 0.2975829295361603 | 13 |
| pydeseq2.lfc_standard_error[3] | 0.3642869905573278 | 0.3642869905573236 | 13 |
| pydeseq2.lfc_standard_error[4] | 0.3244573755742467 | 0.3244573755742429 | 13 |
| pydeseq2.lfc_standard_error[5] | 0.3650272870249225 | 0.36502728702491866 | 13 |
| pydeseq2.lfc_standard_error[6] | 0.28824781600976745 | 0.2882478160097643 | 13 |
| pydeseq2.lfc_standard_error[7] | 0.41191212562610524 | 0.41191212562610086 | 13 |
| pydeseq2.lfc_standard_error[8] | 0.46487403837115865 | 0.4648740383711547 | 14 |
| pydeseq2.lfc_standard_error[9] | 0.4497868552501185 | 0.44978685525011386 | 13 |
| pydeseq2.log2_fold_change[0] | 1.469845675538671 | 1.4698456755386733 | 14 |
| pydeseq2.log2_fold_change[10] | 1.502401024890454 | 1.502401024890468 | 14 |
| pydeseq2.log2_fold_change[1] | -1.7712865073379964 | -1.7712865073379955 | 15 |
| pydeseq2.log2_fold_change[2] | 1.8912657147470957 | 1.891265714747089 | 14 |
| pydeseq2.log2_fold_change[3] | -1.822691889585115 | -1.8226918895851172 | 14 |
| pydeseq2.log2_fold_change[4] | 1.933522228164917 | 1.9335222281649178 | 15 |
| pydeseq2.log2_fold_change[5] | -1.4341817897990508 | -1.4341817897990505 | 15 |
| pydeseq2.log2_fold_change[6] | 1.4562963616151865 | 1.4562963616151894 | 14 |
| pydeseq2.log2_fold_change[7] | -1.479431111953082 | -1.4794311119530834 | 15 |
| pydeseq2.log2_fold_change[8] | 1.6194089957956326 | 1.619408995795641 | 14 |
| pydeseq2.log2_fold_change[9] | -1.0971517443643237 | -1.097151744364325 | 14 |
| pydeseq2.p_values[0] | 2.0060000076239827e-07 | 2.0060000076231153e-07 | 12 |
| pydeseq2.p_values[10] | 8.06010569677464e-05 | 8.060105696771959e-05 | 12 |
| pydeseq2.p_values[11] | 0.0017072670739583253 | 0.0017072670739581134 | 12 |
| pydeseq2.p_values[1] | 6.715161508386333e-08 | 6.715161508383894e-08 | 12 |
| pydeseq2.p_values[2] | 2.0785239373097192e-10 | 2.0785239373088732e-10 | 12 |
| pydeseq2.p_values[3] | 5.631315942473488e-07 | 5.631315942471606e-07 | 12 |
| pydeseq2.p_values[4] | 2.5340004261752573e-09 | 2.5340004261741207e-09 | 12 |
| pydeseq2.p_values[5] | 8.53099654654562e-05 | 8.530996546544153e-05 | 12 |
| pydeseq2.p_values[6] | 4.366647581018763e-07 | 4.36664758101725e-07 | 12 |
| pydeseq2.p_values[7] | 0.0003286309893414192 | 0.0003286309893413668 | 12 |
| pydeseq2.p_values[8] | 0.0004948224582033575 | 0.0004948224582032682 | 12 |
| pydeseq2.p_values[9] | 0.014716953089931145 | 0.01471695308993001 | 13 |
| pydeseq2.size_factors[5] | 1.0178944637578624 | 1.0178944637578622 | 15 |
| r.base.glm_coefficients[2] | 0.112475139795311 | 0.112475139795312 | 14 |
| r.base.glm_coefficients[3] | 0.00822161107618978 | 0.00822161107618989 | 13 |
| r.base.lm_coefficients[0] | 0.0614433486312815 | 0.0614433486312814 | 14 |
| r.base.lm_coefficients[2] | -0.644193293624049 | -0.644193293624048 | 14 |
| r.base.lm_p[0] | 0.597988761000065 | 0.597988761000066 | 14 |
| r.base.lm_p[1] | 3.20365035405524e-37 | 3.2036503540551e-37 | 13 |
| r.base.lm_p[2] | 2.67771603661567e-14 | 2.67771603661569e-14 | 14 |
| r.base.lm_p[3] | 0.0588372829653141 | 0.058837282965314 | 14 |
| r.base.prcomp_sdev[5] | 0.990715150456322 | 0.990715150456321 | 14 |
| r.clusterprofiler.adjusted_p[0] | 2.03398353459981e-59 | 2.03398353459982e-59 | 14 |
| r.clusterprofiler.p_values[0] | 4.06796706919962e-60 | 4.06796706919965e-60 | 14 |
| r.deseq2.adjusted_p[0] | 3.41446398553427e-06 | 3.41446398553424e-06 | 14 |
| r.deseq2.adjusted_p[10] | 0.287459348181339 | 0.287459348181335 | 13 |
| r.deseq2.adjusted_p[11] | 0.175259922744426 | 0.175259922744428 | 13 |
| r.deseq2.adjusted_p[1] | 0.162487771577684 | 0.162487771577685 | 14 |
| r.deseq2.adjusted_p[3] | 0.166682139316215 | 0.166682139316214 | 14 |
| r.deseq2.adjusted_p[4] | 0.354135505518962 | 0.354135505518961 | 14 |
| r.deseq2.adjusted_p[5] | 0.577783064716191 | 0.577783064716189 | 14 |
| r.deseq2.adjusted_p[8] | 4.09151347849197e-07 | 4.09151347849182e-07 | 13 |
| r.deseq2.adjusted_p[9] | 0.0319124305300328 | 0.0319124305300327 | 14 |
| r.deseq2.apeglm_log2_fold_change[11] | -0.508732946915548 | -0.508732946915553 | 14 |
| r.deseq2.apeglm_log2_fold_change[1] | -0.926220144350264 | -0.926220144350265 | 14 |
| r.deseq2.apeglm_log2_fold_change[2] | 0.00810356914915968 | 0.0081035691491585 | 12 |
| r.deseq2.apeglm_log2_fold_change[6] | -0.128303791979648 | -0.128303791979649 | 14 |
| r.deseq2.apeglm_log2_fold_change[7] | 0.119131745299334 | 0.119131745299335 | 14 |
| r.deseq2.dispersions[4] | 0.274268356064374 | 0.274268356064373 | 14 |
| r.deseq2.dispersions[5] | 0.496025046952723 | 0.496025046952722 | 14 |
| r.deseq2.dispersions[8] | 0.118258551476317 | 0.118258551476316 | 14 |
| r.deseq2.lfc_standard_error[11] | 0.325364169178744 | 0.325364169178743 | 14 |
| r.deseq2.lfc_standard_error[4] | 0.46862778099675 | 0.468627780996749 | 14 |
| r.deseq2.lfc_standard_error[6] | 0.32093940844653 | 0.320939408446531 | 14 |
| r.deseq2.log2_fold_change[10] | -0.445079493604297 | -0.445079493604299 | 14 |
| r.deseq2.log2_fold_change[11] | -0.590796014329491 | -0.590796014329488 | 14 |
| r.deseq2.log2_fold_change[2] | 0.00968857696704585 | 0.00968857696704582 | 14 |
| r.deseq2.log2_fold_change[3] | 0.653016212287875 | 0.653016212287876 | 14 |
| r.deseq2.log2_fold_change[6] | -0.153389978833874 | -0.153389978833873 | 14 |
| r.deseq2.p_values[0] | 1.54035969272223e-07 | 1.54035969272221e-07 | 13 |
| r.deseq2.p_values[10] | 0.139046752378442 | 0.13904675237844 | 13 |
| r.deseq2.p_values[11] | 0.0694011724150859 | 0.0694011724150867 | 13 |
| r.deseq2.p_values[3] | 0.0634979578347484 | 0.0634979578347482 | 14 |
| r.deseq2.p_values[5] | 0.385729891358479 | 0.385729891358478 | 14 |
| r.deseq2.p_values[6] | 0.632692471415994 | 0.632692471415997 | 14 |
| r.deseq2.p_values[8] | 1.17495902394263e-08 | 1.17495902394255e-08 | 13 |
| r.deseq2.p_values[9] | 0.00711831157186195 | 0.00711831157186193 | 14 |
| scanpy.dispersions_norm[0] | 2.525252342224121 | 2.5252525806427 | 7 |
| scanpy.dispersions_norm[1] | 2.5028719902038574 | 2.5028717517852783 | 7 |
| scanpy.dispersions_norm[2] | 1.9287981986999512 | 1.9287985563278198 | 6 |
| scanpy.dispersions_norm[3] | 2.9402449131011963 | 2.940244674682617 | 7 |
| scanpy.dispersions_norm[4] | 1.3041568994522095 | 1.304157018661499 | 7 |
| scanpy.dispersions_norm[6] | 1.576897382736206 | 1.5768972635269165 | 7 |
| scanpy.pca_variance_ratio[0] | 0.23493540287017822 | 0.23493541777133942 | 7 |
| scanpy.pca_variance_ratio[1] | 0.03839696943759918 | 0.0383969284594059 | 5 |
| scanpy.pca_variance_ratio[2] | 0.035959504544734955 | 0.03595951199531555 | 6 |
| scanpy.pca_variance_ratio[3] | 0.03463519737124443 | 0.03463520482182503 | 6 |
| scanpy.pca_variance_ratio[4] | 0.03319496288895607 | 0.03319495916366577 | 6 |
| scanpy.pca_variance_ratio[5] | 0.032481465488672256 | 0.032481446862220764 | 6 |
| scipy_statistics.chi2_contingency[1] | 0.005724360155979677 | 0.005724360155979683 | 14 |
| scipy_statistics.curve_fit[0] | 0.40039964366401526 | 0.40039964367263053 | 10 |
| scipy_statistics.curve_fit[1] | 3.0035217483465586 | 3.00352174838874 | 10 |
| scipy_statistics.gammaln_betainc[0] | 469.60554712992945 | 469.6055471299295 | 15 |
| scipy_statistics.mann_whitney[1] | 0.00018146779548886878 | 0.00018146779548886872 | 15 |
| scipy_statistics.tiny_p_value | 3.7325642988777124e-36 | 3.732564298877714e-36 | 15 |
| statsmodels.logit_params[0] | 0.14714153971338378 | 0.14714153971338392 | 15 |
| statsmodels.logit_params[1] | 3.524387356939361 | 3.5243873569393616 | 15 |
| statsmodels.logit_params[3] | -0.09902944755462616 | -0.09902944755462625 | 15 |
| statsmodels.ols_params[0] | 0.1466960744364619 | 0.1466960744364625 | 14 |
| statsmodels.ols_params[1] | 1.468679907290487 | 1.4686799072904877 | 15 |
| statsmodels.ols_params[2] | -0.6328258517258927 | -0.6328258517258921 | 15 |
| statsmodels.ols_params[3] | 0.2315716324171356 | 0.23157163241713613 | 14 |
| statsmodels.ols_pvalues[0] | 0.22775236479946293 | 0.22775236479946084 | 14 |
| statsmodels.ols_pvalues[1] | 2.556908491513285e-35 | 2.556908491513358e-35 | 13 |
| statsmodels.ols_pvalues[2] | 4.984875403239233e-11 | 4.9848754032391416e-11 | 13 |
| statsmodels.ols_pvalues[3] | 0.01681984734741663 | 0.016819847347416306 | 13 |
| statsmodels.ols_r2 | 0.7534712200043444 | 0.7534712200043445 | 15 |
| statsmodels.poisson_deviance | 141.26909730202712 | 141.2690973020271 | 15 |
| statsmodels.poisson_params[0] | 1.0562614727151876 | 1.0562614727151873 | 15 |
| statsmodels.poisson_params[1] | 0.385258610925975 | 0.38525861092597524 | 15 |
| statsmodels.poisson_params[2] | 0.0325232245166823 | 0.032523224516682214 | 14 |
| statsmodels.poisson_params[3] | -0.08281673897061571 | -0.08281673897061623 | 14 |
