"""Demo helper: the ledger computes verdicts in code. No model, no key, no network.

Run from glhf/bixbench:
    uv run python ../../docs/submission/demo/ledger_refusal.py

It shows three rules of swarm/ledger.py:
  1. a favourable result that was not registered first is refused;
  2. a registered test with no result blocks support;
  3. support needs every registered test and a mean e-value of at least m / alpha.
"""

from bixbench3.inspect_harness.swarm.ledger import ALPHA, Ledger

ledger = Ledger()
claim = ledger.add_claim(
    "Treated differs from control", ["treated_vs_control"], "There is no difference", "proposer"
)
print(f"1 claim, alpha = {ALPHA}, so support needs a mean e-value of {claim.threshold:g}\n")

print("Step 1. The critic reports a good result for a test it never registered:")
try:
    ledger.record_test(claim.id, "my best test", 0.0001, False, "", "critic")
except ValueError as error:
    print(f"  REFUSED by code: {error}\n")

print("Step 2. The critic registers two tests, then reports only the one that came out well:")
ledger.register_test(claim.id, "permutation", "permute the sample labels", "critic")
ledger.register_test(claim.id, "held-out", "repeat on held-out samples", "critic")
ledger.record_test(claim.id, "permutation", 0.0001, False, "", "critic")
print(f"  verdict: {claim.verdict}  (waiting for: {', '.join(claim.pending)})\n")

print("Step 3. The second registered test gets its result:")
ledger.record_test(claim.id, "held-out", 0.0001, False, "", "critic")
print(f"  verdict: {claim.verdict}  (mean e-value {claim.e_value:g}, needed {claim.threshold:g})")
