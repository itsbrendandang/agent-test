# Brief: KRAS G12C hit-to-lead (illustrative data)

## Question
Should we advance CMP-0423 and CMP-0517 from hit-to-lead into lead optimization for KRAS G12C non-small
cell lung cancer, and if only one, which?

## Candidates
| ID | SMILES | Notes |
|---|---|---|
| CMP-0423 | C=CC(=O)N1CCN(CC1)c1ncnc2ccc(Cl)cc12 | Acrylamide covalent warhead, quinazoline core |
| CMP-0517 | C=CC(=O)N1CCN(CC1)c1nc(N)nc2cc(F)c(Cl)cc12 | Same warhead, aminoquinazoline, extra F |

## Target and Indication
KRAS G12C, covalent binding to the switch-II pocket of GDP-bound KRAS. Second-line NSCLC with a KRAS G12C
mutation (about 13% of lung adenocarcinoma).

## Available Data
All values are illustrative placeholders for the skeleton.
| Assay | CMP-0423 | CMP-0517 |
|---|---|---|
| KRAS G12C pERK IC50 (H358) | 180 nM | 95 nM |
| Wild-type KRAS selectivity | >50x | >100x |
| Kinetic solubility (pH 7.4) | 12 uM | 4 uM |
| Human liver microsome CLint | 22 uL/min/mg | 48 uL/min/mg |
| hERG IC50 | 18 uM | 6 uM |
| GSH reactivity t1/2 | 95 min | 140 min |

## Stakes
A wrong Go spends about 18 months and two chemists on a series that dies in safety. A wrong No-Go walks
away from the program while two approved drugs set the bar.

## Constraints
Two medicinal chemists for 12 months. No in vivo budget until month 6.

## Key Questions
1. Is either candidate differentiated from the approved KRAS G12C inhibitors, or is the bar already too high?
2. Is the hERG margin of CMP-0517 acceptable at the projected efficacious dose?
3. Which liability is more fixable in lead optimization: CMP-0423's potency or CMP-0517's solubility and clearance?
4. Do resistance mechanisms in the literature change which scaffold is worth backing?

## Decision Criteria
Go needs: pERK IC50 under 100 nM or a clear route there, solubility at least 10 uM, hERG IC50 at least
30x the projected free Cmax, and a stated differentiation hypothesis against approved drugs.
