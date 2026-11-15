// A claims-engine run made with the scripted model (glhf_local --model mock --engine claims, the brief's own command),
// as it wrote its run folder: events.jsonl, board.json, rejections.json, the host ledger's event list (only the fields
// the lab reads; a judge's free text is left out) and a few fields of run.json. A PRACTICE run: scripted, not a
// benchmark result. Long texts are cut.
import type { LabEvent } from "../adapter"

/** events.jsonl, in order: every line has seq, ts (Unix seconds), run_id and kind. */
export const CLAIMS_EVENTS: LabEvent[] = [
 {
  "seq": 1,
  "ts": 1794711369.935725,
  "run_id": "demo-1794711368",
  "kind": "claim.added",
  "claim_id": "C1",
  "by": "planner",
  "acuity": "high",
  "text": "Every required output is derived from all listed samples."
 },
 {
  "seq": 2,
  "ts": 1794711369.9362218,
  "run_id": "demo-1794711368",
  "kind": "claim.added",
  "claim_id": "C2",
  "by": "planner",
  "acuity": "low",
  "text": "A subset of samples is enough to reproduce the outputs."
 },
 {
  "seq": 3,
  "ts": 1794711369.9365819,
  "run_id": "demo-1794711368",
  "kind": "triage.uncovered",
  "artifacts": [
   "treated_vs_control"
  ]
 },
 {
  "seq": 4,
  "ts": 1794711369.936945,
  "run_id": "demo-1794711368",
  "kind": "flags",
  "critic": true,
  "auditor": true,
  "pilot": true,
  "retriage": true,
  "max_parallel": 2,
  "review_rounds": 2,
  "budgeted": false
 },
 {
  "seq": 5,
  "ts": 1794711369.9372742,
  "run_id": "demo-1794711368",
  "kind": "budget.allocated",
  "pool_tokens": 0,
  "pool_seconds": 1357.388,
  "held_tokens": 0,
  "held_seconds": 203.608,
  "claims": {
   "C1": {
    "tokens": 0,
    "share": 0.75
   },
   "C2": {
    "tokens": 0,
    "share": 0.25
   }
  }
 },
 {
  "seq": 6,
  "ts": 1794711369.937827,
  "run_id": "demo-1794711368",
  "kind": "claim.transition",
  "claim_id": "C1",
  "by": "engine",
  "from": "triaged",
  "to": "piloting",
  "reason": "pilot granted",
  "evidence": {}
 },
 {
  "seq": 7,
  "ts": 1794711369.9390059,
  "run_id": "demo-1794711368",
  "kind": "claim.transition",
  "claim_id": "C2",
  "by": "engine",
  "from": "triaged",
  "to": "piloting",
  "reason": "pilot granted",
  "evidence": {}
 },
 {
  "seq": 8,
  "ts": 1794711370.030498,
  "run_id": "demo-1794711368",
  "kind": "budget.spent",
  "claim_id": "C2",
  "tokens": 0,
  "seconds": 0.025
 },
 {
  "seq": 9,
  "ts": 1794711370.031004,
  "run_id": "demo-1794711368",
  "kind": "agent.call",
  "claim_id": "C2",
  "role": "experimenter",
  "mode": "pilot",
  "model": "mockllm/model",
  "tokens": 0,
  "seconds": 0.025,
  "outcome": "ok",
  "attempt": 1,
  "note": "nothing written"
 },
 {
  "seq": 10,
  "ts": 1794711370.115187,
  "run_id": "demo-1794711368",
  "kind": "claim.transition",
  "claim_id": "C2",
  "by": "engine",
  "from": "piloting",
  "to": "rejected",
  "reason": "dead on arrival: pilot outputs fail the shape check (gene_counts)",
  "evidence": {
   "contract": "0/1 required artifacts pass the shape check.\n- gene_counts (/workspace/work/glhf/claims/C2/pilot/outputs/gene…"
  }
 },
 {
  "seq": 11,
  "ts": 1794711370.1804512,
  "run_id": "demo-1794711368",
  "kind": "budget.spent",
  "claim_id": "C1",
  "tokens": 0,
  "seconds": 0.178
 },
 {
  "seq": 12,
  "ts": 1794711370.180918,
  "run_id": "demo-1794711368",
  "kind": "agent.call",
  "claim_id": "C1",
  "role": "experimenter",
  "mode": "pilot",
  "model": "mockllm/model",
  "tokens": 0,
  "seconds": 0.178,
  "outcome": "ok",
  "attempt": 1,
  "note": "pilot outputs shaped on a subsample"
 },
 {
  "seq": 13,
  "ts": 1794711370.254844,
  "run_id": "demo-1794711368",
  "kind": "claim.transition",
  "claim_id": "C1",
  "by": "engine",
  "from": "piloting",
  "to": "in_workup",
  "reason": "pilot outputs pass the shape check",
  "evidence": {
   "contract": "1/1 required artifacts pass the shape check."
  }
 },
 {
  "seq": 14,
  "ts": 1794711370.473446,
  "run_id": "demo-1794711368",
  "kind": "budget.spent",
  "claim_id": "C1",
  "tokens": 0,
  "seconds": 0.158
 },
 {
  "seq": 15,
  "ts": 1794711370.473954,
  "run_id": "demo-1794711368",
  "kind": "agent.call",
  "claim_id": "C1",
  "role": "experimenter",
  "mode": "workup",
  "model": "mockllm/model",
  "tokens": 0,
  "seconds": 0.158,
  "outcome": "ok",
  "attempt": 1,
  "note": "first pass written"
 },
 {
  "seq": 16,
  "ts": 1794711370.546852,
  "run_id": "demo-1794711368",
  "kind": "claim.transition",
  "claim_id": "C1",
  "by": "engine",
  "from": "in_workup",
  "to": "under_review",
  "reason": "artifacts pass the shape check",
  "evidence": {
   "contract": "1/1 required artifacts pass the shape check.\nWarnings (not failures; check each against the brief before chan…"
  }
 },
 {
  "seq": 17,
  "ts": 1794711370.635045,
  "run_id": "demo-1794711368",
  "kind": "budget.spent",
  "claim_id": "C1",
  "tokens": 0,
  "seconds": 0.019
 },
 {
  "seq": 18,
  "ts": 1794711370.6354291,
  "run_id": "demo-1794711368",
  "kind": "agent.call",
  "claim_id": "C1",
  "role": "auditor",
  "mode": "audit 1",
  "model": "mockllm/model",
  "tokens": 0,
  "seconds": 0.019,
  "outcome": "ok",
  "attempt": 1,
  "note": ""
 },
 {
  "seq": 19,
  "ts": 1794711370.828612,
  "run_id": "demo-1794711368",
  "kind": "budget.spent",
  "claim_id": "C1",
  "tokens": 0,
  "seconds": 0.21
 },
 {
  "seq": 20,
  "ts": 1794711370.829407,
  "run_id": "demo-1794711368",
  "kind": "agent.call",
  "claim_id": "C1",
  "role": "critic",
  "mode": "critique 1",
  "model": "mockllm/model",
  "tokens": 0,
  "seconds": 0.21,
  "outcome": "ok",
  "attempt": 1,
  "note": ""
 },
 {
  "seq": 21,
  "ts": 1794711371.008194,
  "run_id": "demo-1794711368",
  "kind": "claim.transition",
  "claim_id": "C1",
  "by": "engine",
  "from": "under_review",
  "to": "sent_back",
  "reason": "open issues I1",
  "evidence": {
   "ledger_verdict": "untested",
   "e_value": 1.0,
   "threshold": 20.0,
   "open_issues": [
    "I1"
   ],
   "critic_completed": true,
   "round": 1
  }
 },
 {
  "seq": 22,
  "ts": 1794711371.0087638,
  "run_id": "demo-1794711368",
  "kind": "retriage",
  "enabled": true,
  "moved_tokens": 0,
  "kept_tokens": 0,
  "to": {
   "C1": 0
  }
 },
 {
  "seq": 23,
  "ts": 1794711371.009166,
  "run_id": "demo-1794711368",
  "kind": "claim.transition",
  "claim_id": "C1",
  "by": "engine",
  "from": "sent_back",
  "to": "in_workup",
  "reason": "revise after round 1",
  "evidence": {}
 },
 {
  "seq": 24,
  "ts": 1794711371.3515751,
  "run_id": "demo-1794711368",
  "kind": "budget.spent",
  "claim_id": "C1",
  "tokens": 0,
  "seconds": 0.282
 },
 {
  "seq": 25,
  "ts": 1794711371.3520691,
  "run_id": "demo-1794711368",
  "kind": "agent.call",
  "claim_id": "C1",
  "role": "experimenter",
  "mode": "revise",
  "model": "mockllm/model",
  "tokens": 0,
  "seconds": 0.282,
  "outcome": "ok",
  "attempt": 1,
  "note": "rows restored"
 },
 {
  "seq": 26,
  "ts": 1794711371.4253728,
  "run_id": "demo-1794711368",
  "kind": "claim.transition",
  "claim_id": "C1",
  "by": "engine",
  "from": "in_workup",
  "to": "under_review",
  "reason": "artifacts pass the shape check",
  "evidence": {
   "contract": "1/1 required artifacts pass the shape check."
  }
 },
 {
  "seq": 27,
  "ts": 1794711371.5145102,
  "run_id": "demo-1794711368",
  "kind": "budget.spent",
  "claim_id": "C1",
  "tokens": 0,
  "seconds": 0.014
 },
 {
  "seq": 28,
  "ts": 1794711371.515131,
  "run_id": "demo-1794711368",
  "kind": "agent.call",
  "claim_id": "C1",
  "role": "auditor",
  "mode": "audit 2",
  "model": "mockllm/model",
  "tokens": 0,
  "seconds": 0.014,
  "outcome": "ok",
  "attempt": 1,
  "note": ""
 },
 {
  "seq": 29,
  "ts": 1794711371.820698,
  "run_id": "demo-1794711368",
  "kind": "budget.spent",
  "claim_id": "C1",
  "tokens": 0,
  "seconds": 0.33
 },
 {
  "seq": 30,
  "ts": 1794711371.82129,
  "run_id": "demo-1794711368",
  "kind": "agent.call",
  "claim_id": "C1",
  "role": "critic",
  "mode": "critique 2",
  "model": "mockllm/model",
  "tokens": 0,
  "seconds": 0.33,
  "outcome": "ok",
  "attempt": 1,
  "note": ""
 },
 {
  "seq": 31,
  "ts": 1794711372.6533601,
  "run_id": "demo-1794711368",
  "kind": "claim.transition",
  "claim_id": "C1",
  "by": "engine",
  "from": "under_review",
  "to": "supported",
  "reason": "the ledger supports the claim and no issue is open",
  "evidence": {
   "ledger_verdict": "supported",
   "e_value": 25.0,
   "threshold": 20.0,
   "open_issues": [],
   "critic_completed": true,
   "round": 2
  }
 },
 {
  "seq": 32,
  "ts": 1794711372.661949,
  "run_id": "demo-1794711368",
  "kind": "retriage",
  "enabled": true,
  "moved_tokens": 0,
  "kept_tokens": 0,
  "reason": "no open claim"
 },
 {
  "seq": 33,
  "ts": 1794711372.6625102,
  "run_id": "demo-1794711368",
  "kind": "engine.finished",
  "states": {
   "C1": "supported",
   "C2": "rejected"
  },
  "stopped": null,
  "rounds": 2
 },
 {
  "seq": 34,
  "ts": 1794711372.788758,
  "run_id": "demo-1794711368",
  "kind": "finish.assembled",
  "artifacts": [
   {
    "artifact": "gene_counts",
    "path": "/outputs/gene_counts.csv",
    "from": "C1",
    "claim_state": "supported",
    "named_by_claim": true
   },
   {
    "artifact": "treated_vs_control",
    "path": "/outputs/treated_vs_control.csv",
    "from": "C1",
    "claim_state": "supported",
    "named_by_claim": false
   }
  ]
 }
]

/** board.json after the last event. */
export const CLAIMS_BOARD = {
 "run_id": "demo-1794711368",
 "seq": 34,
 "claims": [
  {
   "id": "C1",
   "text": "Every required output is derived from all listed samples.",
   "artifact_ids": [
    "gene_counts"
   ],
   "acuity": "high",
   "state": "supported",
   "share": 0.75,
   "budget": {
    "tokens_alloc": 0,
    "tokens_spent": 0,
    "seconds_alloc": 1.1901816260069609,
    "seconds_spent": 1.1901816260069609
   },
   "work_dir": "/workspace/work/glhf/claims/C1",
   "artifacts": [],
   "verdicts": [
    {
     "stage": "review",
     "outcome": "sent_back",
     "reason": "open issues I1",
     "evidence": {
      "ledger_verdict": "untested",
      "e_value": 1.0,
      "threshold": 20.0,
      "open_issues": [
       "I1"
      ],
      "critic_completed": true,
      "round": 1
     },
     "by": "engine",
     "at": 1794711371.008186
    },
    {
     "stage": "review",
     "outcome": "supported",
     "reason": "the ledger supports the claim and no issue is open",
     "evidence": {
      "ledger_verdict": "supported",
      "e_value": 25.0,
      "threshold": 20.0,
      "open_issues": [],
      "critic_completed": true,
      "round": 2
     },
     "by": "engine",
     "at": 1794711372.653353
    }
   ],
   "history": [
    {
     "from_state": "triaged",
     "to_state": "piloting",
     "by": "engine",
     "reason": "pilot granted",
     "at": 1794711369.937824
    },
    {
     "from_state": "piloting",
     "to_state": "in_workup",
     "by": "engine",
     "reason": "pilot outputs pass the shape check",
     "at": 1794711370.254839
    },
    {
     "from_state": "in_workup",
     "to_state": "under_review",
     "by": "engine",
     "reason": "artifacts pass the shape check",
     "at": 1794711370.5468469
    },
    {
     "from_state": "under_review",
     "to_state": "sent_back",
     "by": "engine",
     "reason": "open issues I1",
     "at": 1794711371.008186
    },
    {
     "from_state": "sent_back",
     "to_state": "in_workup",
     "by": "engine",
     "reason": "revise after round 1",
     "at": 1794711371.009165
    },
    {
     "from_state": "in_workup",
     "to_state": "under_review",
     "by": "engine",
     "reason": "artifacts pass the shape check",
     "at": 1794711371.4253702
    },
    {
     "from_state": "under_review",
     "to_state": "supported",
     "by": "engine",
     "reason": "the ledger supports the claim and no issue is open",
     "at": 1794711372.653353
    }
   ],
   "attempts": {
    "pilot": 1,
    "workup": 1,
    "revise": 1,
    "audit 1": 1,
    "critique 1": 1,
    "audit 2": 1,
    "critique 2": 1
   },
   "errors": []
  },
  {
   "id": "C2",
   "text": "A subset of samples is enough to reproduce the outputs.",
   "artifact_ids": [
    "gene_counts"
   ],
   "acuity": "low",
   "state": "rejected",
   "share": 0.25,
   "budget": {
    "tokens_alloc": 0,
    "tokens_spent": 0,
    "seconds_alloc": 0.0253128329932224,
    "seconds_spent": 0.0253128329932224
   },
   "work_dir": "/workspace/work/glhf/claims/C2",
   "artifacts": [],
   "verdicts": [
    {
     "stage": "pilot",
     "outcome": "rejected",
     "reason": "dead on arrival: pilot outputs fail the shape check (gene_counts)",
     "evidence": {
      "contract": "0/1 required artifacts pass the shape check.\n- gene_counts (/workspace/work/glhf/claims/C2/pilot/outputs/gene…"
     },
     "by": "engine",
     "at": 1794711370.1151738
    }
   ],
   "history": [
    {
     "from_state": "triaged",
     "to_state": "piloting",
     "by": "engine",
     "reason": "pilot granted",
     "at": 1794711369.939004
    },
    {
     "from_state": "piloting",
     "to_state": "rejected",
     "by": "engine",
     "reason": "dead on arrival: pilot outputs fail the shape check (gene_counts)",
     "at": 1794711370.1151738
    }
   ],
   "attempts": {
    "pilot": 1,
    "workup": 0,
    "revise": 0
   },
   "errors": []
  }
 ]
}

/** rejections.json */
export const CLAIMS_REJECTIONS = [
 {
  "claim": "C2",
  "text": "A subset of samples is enough to reproduce the outputs.",
  "stage": "pilot",
  "reason": "dead on arrival: pilot outputs fail the shape check (gene_counts)",
  "evidence": {
   "contract": "0/1 required artifacts pass the shape check.\n- gene_counts (/workspace/work/glhf/claims/C2/pilot/outputs/gene…"
  }
 }
]

/** The `events` list of the host's ledger.json (no times, no seq: told apart by position). */
export const CLAIMS_NOTES: LabEvent[] = [
 {
  "kind": "settings",
  "budget_seconds": 1746,
  "review_rounds": 3
 },
 {
  "kind": "budget.plan"
 },
 {
  "kind": "scout.code",
  "files": 2,
  "problems": 0
 },
 {
  "kind": "budget.grant",
  "phase": "propose"
 },
 {
  "kind": "phase.started",
  "phase": "propose"
 },
 {
  "kind": "claim.added",
  "claim": "C1",
  "by": "planner"
 },
 {
  "kind": "claim.added",
  "claim": "C2",
  "by": "planner"
 },
 {
  "kind": "phase.finished",
  "phase": "propose",
  "limit_hit": false,
  "limit": null,
  "left": 1744
 },
 {
  "kind": "triage.uncovered"
 },
 {
  "kind": "issue.raised",
  "issue": "I1",
  "severity": "blocking",
  "problem": "gene_counts.csv has a header and no rows.",
  "by": "critic"
 },
 {
  "kind": "issue.resolved",
  "issue": "I1",
  "status": "fixed",
  "by": "experimenter"
 },
 {
  "kind": "test.registered",
  "claim": "C1",
  "name": "label permutation",
  "by": "critic"
 },
 {
  "kind": "budget.grant",
  "phase": "relevance 2"
 },
 {
  "kind": "phase.started",
  "phase": "relevance 2"
 },
 {
  "kind": "test.relevance",
  "claim": "C1",
  "name": "label permutation",
  "relevant": true
 },
 {
  "kind": "phase.finished",
  "phase": "relevance 2",
  "limit_hit": false,
  "limit": null,
  "left": 1742
 },
 {
  "kind": "test.executed",
  "claim": "C1",
  "name": "label permutation",
  "status": "ok",
  "contradicts": false
 },
 {
  "kind": "test.recorded",
  "claim": "C1",
  "name": "label permutation",
  "contradicts": false,
  "registered": true,
  "verdict_at_the_time": "supported",
  "by": "harness"
 },
 {
  "kind": "issues.rechecked"
 },
 {
  "kind": "claims.finished",
  "states": {
   "C1": "supported",
   "C2": "rejected"
  },
  "stopped": null,
  "rounds": 2
 },
 {
  "kind": "finish.assembled"
 },
 {
  "kind": "budget.grant",
  "phase": "report"
 },
 {
  "kind": "phase.started",
  "phase": "report"
 },
 {
  "kind": "phase.finished",
  "phase": "report",
  "limit_hit": false,
  "limit": null,
  "left": 1740
 },
 {
  "kind": "finished"
 }
]

/** A few fields of run.json. */
export const CLAIMS_RUN_JSON = {
 "task": "demo",
 "solver": "glhf",
 "model": "mock",
 "started_at": 1794711366.0252612,
 "status": "done",
 "settings": {
  "engine": "claims",
  "ablations": {
   "no_critic": false,
   "no_auditor": false,
   "no_pilot": false,
   "no_retriage": false,
   "max_parallel": 2
  }
 }
}
