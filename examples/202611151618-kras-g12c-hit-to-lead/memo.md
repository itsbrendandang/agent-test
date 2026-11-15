# Memo: KRAS G12C hit-to-lead (mock run)

## Decision
**Go with conditions: advance CMP-0423; park CMP-0517.**

## Rationale
CMP-0423 meets solubility, clearance and hERG criteria and misses only potency (180 nM vs 100 nM), which the
Methods Auditor and Critic rate as the more fixable liability. CMP-0517's hERG IC50 of 6 uM fails the safety margin.

## Board Positions
- Proposer: three claims; resistance coverage ranked low.
- Experimenter: pilot script prepared, not run; dropped one claim on revise.
- Methods Auditor: resistance testing is missing from the plan.
- Critic: No-Go until an advantage over the approved drugs is shown. (dissent)
- Reporter: one supported finding, one rejected claim.

## Evidence Ledger Summary
See verification_ledger.json. One claim did not match the brief and was dropped.

## Rejected Claims
- CMP-0423 shows no resistance liability. Contradicted by the checker: the brief has no resistance data.

## Unresolved Tensions
Differentiation against approved drugs is a hypothesis, not data.

## Experiments That Would Change the Call
1. Y96D / R68S resistance-mutant panel for CMP-0423 (No-Go if inactive).
2. hERG on the first three polar analogs of CMP-0517 (revive it if IC50 > 30 uM).

## Next Actions
Resistance panel by month 3; potency SAR sprint on the quinazoline 6-position.
