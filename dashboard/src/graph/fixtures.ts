// Run data in the shapes the engine really sends (copied from live runs, shortened). Used by the tests only.
import type { BoardEvent, RosterMember } from "@/board/api"
import type { LedgerIssue, RunDetail } from "@/swarm/api"

export const EVIL = `<img src=x onerror="window.__pwned=1">`

export const ROSTER: RosterMember[] = [
  { name: "lead-scientist", title: "Lead Scientist", role: "lead", model: "lead", modelId: "x/lead", tools: [] },
  { name: "scout", title: "Scout (Data Inspector)", role: "member", model: "cheap", modelId: "x/scout", tools: [] },
  { name: "proposer", title: "Proposer (Research Planner)", role: "member", model: "strong", modelId: "x/proposer", tools: [] },
  { name: "critic", title: "Critic", role: "member", model: "strong", modelId: "x/critic", tools: [] },
]

const T = 1_700_000_000_000
const SRC = "https://example.org/a"
export const BOARD_EVENTS: BoardEvent[] = [
  { type: "run.started", runId: "r1", brief: "kras", title: "KRAS G12C hit-to-lead", mock: true, key: "run", at: T },
  { type: "lead.framed", text: "Decide between two compounds. Then more.", key: "lead", at: T + 10 } as BoardEvent,
  { type: "round.started", round: 1, message: "Round 1. Scout: inspect the data. Critic: give your first check.", final: false, key: "round:1", at: T + 20 },
  { type: "evidence.triaged", member: "scout", query: "hERG liability", kept: 2, dropped: 1, key: "ev:1", at: T + 30,
    items: [
      { url: SRC, title: "hERG of acrylamides", studyType: "in vitro", text: "t" },
      { url: `javascript:alert(1)`, title: EVIL, studyType: "clinical", text: "t" },
    ] } as unknown as BoardEvent,
  { type: "evidence.triaged", member: "critic", query: "resistance", kept: 1, dropped: 0, key: "ev:2", at: T + 31,
    items: [{ url: SRC, title: "hERG of acrylamides", text: "t" }] } as unknown as BoardEvent,
  { type: "member.replied", round: 1, member: "scout", text: `The brief has one assay table. ${EVIL} More words follow here.`, key: "reply:1:scout", at: T + 40 },
  { type: "member.replied", round: 1, member: "critic", text: "Rejected: no resistance data. Supported: the hERG margin fails.", key: "reply:1:critic", at: T + 41 },
  { type: "claim.checked", round: 1, member: "scout", claim: `Piperazine quinazolines show no hERG ${EVIL}`, kind: "literature", verdict: "contradicted", checker: "jev", p: 0.9, source: SRC, key: "claim:1:scout:a", at: T + 50 } as BoardEvent,
  { type: "claim.checked", round: 1, member: "scout", claim: "CMP-0517 hERG IC50 is 6 uM", kind: "brief", verdict: "verified", checker: "first-pass", source: "brief", checkedBy: "scripted", key: "claim:1:scout:b", at: T + 51 } as BoardEvent,
  { type: "claim.checked", round: 1, member: "critic", claim: "Neither candidate has resistance data", kind: "brief", verdict: "unsupported", checker: "first-pass", key: "claim:1:critic:a", at: T + 52 },
  { type: "claim.checked", round: 1, member: "proposer", claim: "CMP-0423 TPSA is about 49", kind: "computed", verdict: "verified", checker: "claude-code", note: "mock: RDKit recomputation matches", source: "TPSA from the SMILES with RDKit", key: "claim:1:proposer:a", at: T + 53 } as BoardEvent,
  { type: "claim.checked", round: 1, member: "critic", claim: "MET amplification drives resistance", kind: "literature", verdict: "unchecked", checker: "openai", note: "escalation budget used up", source: "https://not-in-the-pool.example/x", key: "claim:1:critic:b", at: T + 54 } as BoardEvent,
  { type: "round.started", round: 2, message: "Round 2. Reply to the others.", final: true, key: "round:2", at: T + 60 },
  { type: "member.replied", round: 2, member: "scout", text: "Still 6 uM.", key: "reply:2:scout", at: T + 70 },
  { type: "claim.checked", round: 2, member: "scout", claim: "CMP-0517 hERG IC50 is 6 uM", kind: "brief", verdict: "verified", checker: "first-pass", note: "[ruling carried over from round 1; not checked again]", source: "brief", key: "claim:2:scout:b", at: T + 71 } as BoardEvent,
  { type: "constraint", reason: "rounds", detail: "Out of rounds.", key: "constraint", at: T + 80 },
  { type: "memo.written", path: "/Users/someone/board/runs/r1/memo.md", decision: "Go with conditions", key: "memo", at: T + 90 },
  { type: "run.finished", usd: 0, minutes: 0.14, key: "finished", at: T + 100 },
]

export const SWARM_DETAIL: RunDetail = {
  run: {
    id: "s1", mode: "local", task: "demo", solver: "glhf", model: "mock", roleModels: {}, phase: "done", startedAt: T, finishedAt: T + 1000, score: 1,
    artifacts: [{ artifact_id: "gene_counts", score: 1 }, { artifact_id: "treated_vs_control", score: 1 }],
  },
  findings: null, methods: null,
  ledger: {
    alpha: 0.1, kappa: 0, claims_in_family: 3, support_threshold: 30,
    claims: [
      { id: "C1", text: "Every required output is derived from all listed samples.", artifact_ids: ["gene_counts"], proposed_by: "planner", null_hypothesis: "A sample is missing.",
        tests: [{ name: "label permutation", p_value: 0.0004, contradicts: false, note: "scripts/perm.py", by: "critic", e_value: 25, registered: true }],
        replication_failed: false, e_value: 25, verdict: "supported", threshold: 20,
        registered: [{ name: "label permutation", method: "Permute sample labels 10000 times.", by: "critic" }], pending_tests: [] },
      { id: "C2", text: `gene_counts has rows ${EVIL}`, artifact_ids: ["gene_counts", "treated_vs_control"], proposed_by: "planner", null_hypothesis: "Empty.",
        tests: [{ name: "row count", p_value: 0.01, contradicts: true, note: "wc -l gave 1", by: "critic", e_value: 0.5, registered: true }],
        replication_failed: false, e_value: 0.5, verdict: "refuted", threshold: 20,
        registered: [{ name: "Row Count", method: "Count rows.", by: "critic" }], pending_tests: [] },
      { id: "C3", text: "Replicates cluster by condition.", artifact_ids: [], proposed_by: "planner", null_hypothesis: "They do not.",
        tests: [], replication_failed: false, e_value: 0, verdict: "insufficient", threshold: 20,
        registered: [{ name: "pca", method: "PCA of replicates.", by: "critic" }], pending_tests: ["pca"] },
    ],
    issues: [
      { id: "I1", severity: "blocking", artifact_ids: ["gene_counts"], problem: "gene_counts.csv has a header and no rows.", evidence: "wc -l -> 1", raised_by: "critic", status: "fixed", resolution: "Reran.", rechecked: true } as unknown as LedgerIssue,
      { id: "I2", severity: "major", artifact_ids: [], problem: "Methods text is thin.", evidence: "", raised_by: "critic", status: "open", resolution: "" },
    ],
    events: [
      { kind: "settings", budget_seconds: 1746 },
      { kind: "phase.started", phase: "propose", seconds: 87 },
      { kind: "claim.added", claim: "C1", by: "planner", text: "Every required output is derived from all listed samples." },
      { kind: "claim.added", claim: "C2", by: "planner", text: "gene_counts has rows" },
      { kind: "claim.added", claim: "C3", by: "planner", text: "Replicates cluster by condition." },
      { kind: "phase.finished", phase: "propose", limit_hit: false, tokens: 500 },
      { kind: "phase.skipped", phase: "pilot", reason: "plan" },
      { kind: "phase.started", phase: "critique 1", seconds: 60 },
      { kind: "test.registered", claim: "C1", name: "label permutation", method: "Permute.", by: "critic" },
      { kind: "test.registered", claim: "C2", name: "Row Count", method: "Count rows.", by: "critic" },
      { kind: "test.registered", claim: "C3", name: "pca", method: "PCA.", by: "critic" },
      { kind: "issue.raised", issue: "I1", severity: "blocking", problem: "gene_counts.csv has a header and no rows.", by: "critic" },
      { kind: "issue.raised", issue: "I2", severity: "major", problem: "Methods text is thin.", by: "critic" },
      { kind: "test.recorded", claim: "C1", name: "label permutation", p: 0.0004, contradicts: false, registered: true, e: 25, by: "critic" },
      { kind: "test.recorded", claim: "C2", name: "row count", p: 0.01, contradicts: true, registered: true, e: 0.5, by: "critic" },
      { kind: "phase.finished", phase: "critique 1", limit_hit: true, tokens: 900 },
      { kind: "phase.started", phase: "revise 1", seconds: 60 },
      { kind: "issue.resolved", issue: "I1", status: "fixed", by: "experimenter" },
      { kind: "phase.finished", phase: "revise 1", limit_hit: false },
      { kind: "finished", contract: "2/2 required artifacts pass the shape check." },
    ],
  },
}

/** A single agent keeps no ledger. */
export const SINGLE_DETAIL: RunDetail = {
  run: { id: "s2", mode: "local", task: "demo", solver: "single", model: "mock", roleModels: {}, phase: "done", startedAt: T, score: 1, artifacts: [{ artifact_id: "gene_counts", score: 1 }] },
  ledger: null, findings: null, methods: null,
}

/** A practice (scripted) board run from the current engine, as recorded: two members spoke and four rulings were made. */
export const PRACTICE_EVENTS = [
 {
  "type": "run.started",
  "runId": "practice",
  "brief": "chat-should-we-advance-a-kras-g12c-hit-that-h-1060e203",
  "title": "Should we advance a KRAS G12C hit that has a hERG liability?",
  "mock": true,
  "key": "run",
  "at": 1700000000000
 },
 {
  "type": "round.started",
  "round": 1,
  "message": "Round 1. Scout: inspect the data. Proposer: plan the analysis and name the claims to test. Pilot and Experimenter: say what you would run. Everyone else: give your first check. Work independently.",
  "final": false,
  "key": "round:1",
  "at": 1700000000258
 },
 {
  "type": "member.replied",
  "round": 1,
  "member": "scout",
  "text": "The brief has one assay table for two candidates. No raw data files came with it, so no file could be checked for damage.",
  "usd": 0,
  "key": "reply:1:scout",
  "at": 1700000000433
 },
 {
  "type": "claim.checked",
  "round": 1,
  "member": "scout",
  "claim": "The brief gives six assays for each of CMP-0423 and CMP-0517",
  "kind": "brief",
  "verdict": "unsupported",
  "checker": "first-pass",
  "checkedBy": "scripted",
  "key": "claim:1:scout:bbbff6d4a4e86888",
  "at": 1700000000435
 },
 {
  "type": "member.replied",
  "round": 1,
  "member": "critic",
  "text": "Supported: CMP-0517 fails the hERG margin. Rejected: the claim that CMP-0423 has no resistance liability; the brief has no resistance data. Not yet established: any advantage over the approved drugs.",
  "usd": 0,
  "key": "reply:1:critic",
  "at": 1700000000435
 },
 {
  "type": "claim.checked",
  "round": 1,
  "member": "critic",
  "claim": "CMP-0423 hERG IC50 is 18 uM",
  "kind": "brief",
  "verdict": "unsupported",
  "checker": "first-pass",
  "checkedBy": "scripted",
  "key": "claim:1:critic:ec6ee27908fef7ea",
  "at": 1700000000435
 },
 {
  "type": "round.started",
  "round": 2,
  "message": "Round 2. Methods Auditor and Critic: the hERG margin and solubility of CMP-0517 both miss the criteria. Reviser: fix what they flagged. Finisher: list the outputs that are still missing. Reporter: draft the supported findings and the rejected claims.",
  "final": false,
  "key": "round:2",
  "at": 1700000000647
 },
 {
  "type": "member.replied",
  "round": 2,
  "member": "scout",
  "text": "The brief has one assay table for two candidates. No raw data files came with it, so no file could be checked for damage.",
  "usd": 0,
  "key": "reply:2:scout",
  "at": 1700000000824
 },
 {
  "type": "claim.checked",
  "round": 2,
  "member": "scout",
  "claim": "The brief gives six assays for each of CMP-0423 and CMP-0517",
  "kind": "brief",
  "verdict": "unsupported",
  "checker": "first-pass",
  "note": "[ruling carried over from round 1; not checked again]",
  "checkedBy": "scripted",
  "key": "claim:2:scout:bbbff6d4a4e86888",
  "at": 1700000000824
 },
 {
  "type": "member.replied",
  "round": 2,
  "member": "critic",
  "text": "Supported: CMP-0517 fails the hERG margin. Rejected: the claim that CMP-0423 has no resistance liability; the brief has no resistance data. Not yet established: any advantage over the approved drugs.",
  "usd": 0,
  "key": "reply:2:critic",
  "at": 1700000000824
 },
 {
  "type": "claim.checked",
  "round": 2,
  "member": "critic",
  "claim": "CMP-0423 hERG IC50 is 18 uM",
  "kind": "brief",
  "verdict": "unsupported",
  "checker": "first-pass",
  "note": "[ruling carried over from round 1; not checked again]",
  "checkedBy": "scripted",
  "key": "claim:2:critic:ec6ee27908fef7ea",
  "at": 1700000000824
 },
 {
  "type": "memo.written",
  "path": "/runs/practice/memo.md",
  "decision": "Go with conditions",
  "key": "memo",
  "at": 1700000001819
 },
 {
  "type": "run.finished",
  "usd": 0,
  "minutes": 0.030366666666666667,
  "key": "finished",
  "at": 1700000001822
 }
] as unknown as BoardEvent[]
