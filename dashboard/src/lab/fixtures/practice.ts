// Recorded on a throwaway engine with paid calls off (scripted models, fixed example text): what a PRACTICE run really
// emits. Long texts are cut. These are practice-run events, never research results.
import type { LabEvent } from "../adapter"

/** A practice team review: GET /api/runs/:id/events, in order. */
export const PRACTICE_REVIEW: LabEvent[] = [
 {
  "type": "run.started",
  "runId": "202611150232-kras-g12c-hit-to-lead",
  "brief": "kras-g12c-hit-to-lead",
  "title": "KRAS G12C hit-to-lead (illustrative data)",
  "mock": true,
  "key": "run",
  "at": 1794709957624
 },
 {
  "type": "run.roster",
  "members": [
   {
    "name": "lead-scientist",
    "title": "Lead Scientist",
    "role": "lead",
    "source": "board"
   },
   {
    "name": "scout",
    "title": "Scout (Data and Evidence)",
    "role": "member",
    "source": "board"
   },
   {
    "name": "proposer",
    "title": "Proposer (Triage)",
    "role": "member",
    "source": "board"
   },
   {
    "name": "experimenter",
    "title": "Experimenter (Data Scientist)",
    "role": "member",
    "source": "board"
   },
   {
    "name": "methods-auditor",
    "title": "Methods Auditor (Quality Checker)",
    "role": "member",
    "source": "board"
   },
   {
    "name": "critic",
    "title": "Critic (Scientific Reviewer)",
    "role": "member",
    "source": "board"
   },
   {
    "name": "reporter",
    "title": "Reporter (Research Writer)",
    "role": "member",
    "source": "board"
   }
  ],
  "key": "roster",
  "at": 1794709957633
 },
 {
  "type": "round.started",
  "round": 1,
  "message": "Round 1. Scout: search for published evidence on the main question, then report the data and the so…",
  "final": false,
  "key": "round:1",
  "at": 1794709957981
 },
 {
  "type": "evidence.triaged",
  "member": "scout",
  "query": "KRAS G12C Scout (Data and Evidence) evidence",
  "kept": 3,
  "dropped": 1,
  "items": [
   {
    "url": "https://example.org/mock/kras-g12c-clinical-review",
    "title": "KRAS G12C inhibitors in NSCLC: clinical review (mock)",
    "provider": "fixture",
    "studyType": "clinical",
    "relevance": 1
   },
   {
    "url": "https://example.org/mock/herg-acrylamide",
    "title": "hERG liability of piperazine acrylamides (mock)",
    "provider": "fixture",
    "studyType": "in_vitro",
    "relevance": 1
   },
   {
    "url": "https://example.org/mock/resistance-mechanisms",
    "title": "Resistance mechanisms to KRAS G12C inhibition (mock)",
    "provider": "fixture",
    "studyType": "clinical",
    "relevance": 1
   }
  ],
  "provider": "fixture",
  "key": "evidence:tool:1794709957985:wtyvibx0ogb",
  "at": 1794709958171
 },
 {
  "type": "member.replied",
  "round": 1,
  "member": "scout",
  "text": "In short: The search gave three example sources on KRAS G12C inhibitors, hERG and resistance.\n\nThe search gave three ex…",
  "usd": 0,
  "summary": "The search gave three example sources on KRAS G12C inhibitors, hERG and resistance.",
  "key": "reply:1:scout",
  "at": 1794709958922
 },
 {
  "type": "member.replied",
  "round": 1,
  "member": "proposer",
  "text": "In short: Triage: (1) CMP-0517 fails the hERG margin, high, 40%.\n\nTriage: (1) CMP-0517 fails the hERG margin, high, 40%…",
  "usd": 0,
  "summary": "Triage: (1) CMP-0517 fails the hERG margin, high, 40%.",
  "key": "reply:1:proposer",
  "at": 1794709958923
 },
 {
  "type": "member.replied",
  "round": 1,
  "member": "experimenter",
  "mode": "pilot",
  "text": "In short: Pilot: a script for the assay table and the SMILES descriptors, not run (no code tool yet).\n\nPilot: a script …",
  "usd": 0,
  "summary": "Pilot: a script for the assay table and the SMILES descriptors, not run (no code tool yet).",
  "key": "reply:1:experimenter",
  "at": 1794709958923
 },
 {
  "type": "member.replied",
  "round": 1,
  "member": "methods-auditor",
  "text": "In short: No task.\n\nNo task.",
  "usd": 0,
  "summary": "No task.",
  "key": "reply:1:methods-auditor",
  "at": 1794709958923
 },
 {
  "type": "member.replied",
  "round": 1,
  "member": "critic",
  "text": "In short: No task.\n\nNo task.",
  "usd": 0,
  "summary": "No task.",
  "key": "reply:1:critic",
  "at": 1794709958924
 },
 {
  "type": "member.replied",
  "round": 1,
  "member": "reporter",
  "text": "In short: No task.\n\nNo task.",
  "usd": 0,
  "summary": "No task.",
  "key": "reply:1:reporter",
  "at": 1794709958924
 },
 {
  "type": "claim.checked",
  "round": 1,
  "member": "proposer",
  "claim": "CMP-0517 pERK IC50 is 95 nM in H358",
  "kind": "brief",
  "verdict": "verified",
  "checker": "first-pass",
  "note": "quoted: \"| KRAS G12C pERK IC50 (H358) | 180 nM | 95 nM |\"",
  "checkedBy": "scripted",
  "quoteFound": true,
  "source": "brief",
  "key": "claim:1:proposer:49eb6c24a91a4a62",
  "at": 1794709958928
 },
 {
  "type": "claim.checked",
  "round": 1,
  "member": "proposer",
  "claim": "CMP-0423 pERK IC50 is 180 nM in H358",
  "kind": "brief",
  "verdict": "verified",
  "checker": "first-pass",
  "note": "quoted: \"| KRAS G12C pERK IC50 (H358) | 180 nM | 95 nM |\"",
  "checkedBy": "scripted",
  "quoteFound": true,
  "source": "brief",
  "key": "claim:1:proposer:a2138af6827fe555",
  "at": 1794709958928
 },
 {
  "type": "claim.checked",
  "round": 1,
  "member": "experimenter",
  "claim": "CMP-0423 TPSA is about 49 and cLogP about 2.4",
  "kind": "computed",
  "verdict": "verified",
  "checker": "claude-code",
  "note": "mock: RDKit recomputation matches within tolerance",
  "source": "RDKit on CMP-0423 SMILES",
  "key": "claim:1:experimenter:c5b8cd628c817c58",
  "at": 1794709958929
 },
 {
  "type": "claim.checked",
  "round": 1,
  "member": "scout",
  "claim": "The brief gives six assays for each of CMP-0423 and CMP-0517",
  "kind": "brief",
  "verdict": "unsupported",
  "checker": "openai",
  "note": "mock: evidence mentions the topic but not the number [first pass escalated: the…",
  "source": "brief",
  "key": "claim:1:scout:bbbff6d4a4e86888",
  "at": 1794709958930
 },
 {
  "type": "claim.checked",
  "round": 1,
  "member": "experimenter",
  "claim": "CMP-0517 kinetic solubility is 4 uM",
  "kind": "brief",
  "verdict": "verified",
  "checker": "first-pass",
  "note": "quoted: \"| Kinetic solubility (pH 7.4) | 12 uM | 4 uM |\"",
  "checkedBy": "scripted",
  "quoteFound": true,
  "source": "brief",
  "key": "claim:1:experimenter:d16bd103ee24978c",
  "at": 1794709958930
 },
 {
  "type": "claim.checked",
  "round": 1,
  "member": "experimenter",
  "claim": "CMP-0423 shows no resistance liability",
  "kind": "brief",
  "verdict": "contradicted",
  "checker": "first-pass",
  "note": "quoted: \"| CMP-0423 | C=CC(=O)N1CCN(CC1)c1ncnc2ccc(Cl)cc12 | Acrylamide covalen…",
  "checkedBy": "scripted",
  "quoteFound": true,
  "source": "brief",
  "key": "claim:1:experimenter:87043bb28b6572e0",
  "at": 1794709958930
 },
 {
  "type": "claim.checked",
  "round": 1,
  "member": "scout",
  "claim": "Approved covalent KRAS G12C inhibitors give objective response rates near 37 to 41 percent in previously treated patients",
  "kind": "literature",
  "verdict": "verified",
  "checker": "first-pass",
  "note": "quoted: \"Approved covalent KRAS G12C inhibitors give objective response rates n…",
  "checkedBy": "scripted",
  "quoteFound": true,
  "source": "https://example.org/mock/kras-g12c-clinical-review",
  "key": "claim:1:scout:7e113c698ce5aee7",
  "at": 1794709958931
 },
 {
  "type": "round.started",
  "round": 2,
  "message": "Round 2. Experimenter (revise): fix what the checkers flagged. Methods Auditor and Critic: review t…",
  "final": false,
  "key": "round:2",
  "at": 1794709959187
 },
 {
  "type": "member.replied",
  "round": 2,
  "member": "scout",
  "text": "In short: No task.\n\nNo task.",
  "usd": 0,
  "summary": "No task.",
  "key": "reply:2:scout",
  "at": 1794709959503
 },
 {
  "type": "member.replied",
  "round": 2,
  "member": "proposer",
  "text": "In short: No task.\n\nNo task.",
  "usd": 0,
  "summary": "No task.",
  "key": "reply:2:proposer",
  "at": 1794709959503
 },
 {
  "type": "member.replied",
  "round": 2,
  "member": "experimenter",
  "mode": "revise",
  "text": "In short: Revise: dropped my claim that CMP-0423 has no resistance liability; the checker contradicted it and the brief…",
  "usd": 0,
  "summary": "Revise: dropped my claim that CMP-0423 has no resistance liability; the checker contradicted it and the brief has no resistance data.",
  "key": "reply:2:experimenter",
  "at": 1794709959503
 },
 {
  "type": "member.replied",
  "round": 2,
  "member": "methods-auditor",
  "text": "In short: Each claim is compared with its criterion.\n\nEach claim is compared with its criterion. The hERG margin step i…",
  "usd": 0,
  "summary": "Each claim is compared with its criterion.",
  "key": "reply:2:methods-auditor",
  "at": 1794709959503
 },
 {
  "type": "member.replied",
  "round": 2,
  "member": "critic",
  "text": "In short: Supported: CMP-0517 fails the hERG margin.\n\nSupported: CMP-0517 fails the hERG margin. Rejected: CMP-0423 has…",
  "usd": 0,
  "summary": "Supported: CMP-0517 fails the hERG margin.",
  "key": "reply:2:critic",
  "at": 1794709959504
 },
 {
  "type": "member.replied",
  "round": 2,
  "member": "reporter",
  "text": "In short: Draft: one supported finding (CMP-0517 fails the hERG margin), one rejected claim (no resistance liability fo…",
  "usd": 0,
  "summary": "Draft: one supported finding (CMP-0517 fails the hERG margin), one rejected claim (no resistance liability for CMP-0423), and no resistance data.",
  "key": "reply:2:reporter",
  "at": 1794709959504
 },
 {
  "type": "claim.checked",
  "round": 2,
  "member": "experimenter",
  "claim": "CMP-0423 kinetic solubility is 12 uM",
  "kind": "brief",
  "verdict": "verified",
  "checker": "first-pass",
  "note": "quoted: \"| Kinetic solubility (pH 7.4) | 12 uM | 4 uM |\"",
  "checkedBy": "scripted",
  "quoteFound": true,
  "source": "brief",
  "key": "claim:2:experimenter:50497332af397815",
  "at": 1794709959504
 },
 {
  "type": "claim.checked",
  "round": 2,
  "member": "methods-auditor",
  "claim": "CMP-0517 hERG IC50 is 6 uM",
  "kind": "brief",
  "verdict": "verified",
  "checker": "first-pass",
  "note": "quoted: \"| hERG IC50 | 18 uM | 6 uM |\"",
  "checkedBy": "scripted",
  "quoteFound": true,
  "source": "brief",
  "key": "claim:2:methods-auditor:e8785805f5628d52",
  "at": 1794709959504
 },
 {
  "type": "claim.checked",
  "round": 2,
  "member": "critic",
  "claim": "CMP-0423 hERG IC50 is 18 uM",
  "kind": "brief",
  "verdict": "verified",
  "checker": "first-pass",
  "note": "quoted: \"| hERG IC50 | 18 uM | 6 uM |\"",
  "checkedBy": "scripted",
  "quoteFound": true,
  "source": "brief",
  "key": "claim:2:critic:ec6ee27908fef7ea",
  "at": 1794709959505
 },
 {
  "type": "claim.checked",
  "round": 2,
  "member": "reporter",
  "claim": "Neither candidate has resistance-mutant data",
  "kind": "brief",
  "verdict": "unsupported",
  "checker": "first-pass",
  "checkedBy": "scripted",
  "source": "brief",
  "key": "claim:2:reporter:3b0d1fd6a14a66e6",
  "at": 1794709959505
 },
 {
  "type": "claim.checked",
  "round": 2,
  "member": "methods-auditor",
  "claim": "Adding polarity reduced hERG binding in most matched pairs",
  "kind": "literature",
  "verdict": "verified",
  "checker": "first-pass",
  "note": "quoted: \"In vitro patch-clamp data show piperazine-linked quinazolines often in…",
  "checkedBy": "scripted",
  "quoteFound": true,
  "source": "https://example.org/mock/herg-acrylamide",
  "key": "claim:2:methods-auditor:1eb382bed1a60283",
  "at": 1794709959505
 },
 {
  "type": "claim.checked",
  "round": 2,
  "member": "critic",
  "claim": "Piperazine-linked quinazolines show no resistance liability",
  "kind": "literature",
  "verdict": "contradicted",
  "checker": "first-pass",
  "note": "quoted: \"Sequencing of patients progressing on KRAS G12C inhibitors found Y96D …",
  "checkedBy": "scripted",
  "quoteFound": true,
  "source": "https://example.org/mock/resistance-mechanisms",
  "key": "claim:2:critic:790bfa9653f68617",
  "at": 1794709959505
 },
 {
  "type": "round.started",
  "round": 3,
  "message": "We are at our limit. Final positions: one statement each, Go or No-Go, and the one condition you wo…",
  "final": true,
  "key": "round:3",
  "at": 1794709959613
 },
 {
  "type": "member.replied",
  "round": 3,
  "member": "scout",
  "text": "In short: Go with CMP-0423, conditional on a resistance-mutant panel by month 3.\n\nGo with CMP-0423, conditional on a re…",
  "usd": 0,
  "summary": "Go with CMP-0423, conditional on a resistance-mutant panel by month 3.",
  "key": "reply:3:scout",
  "at": 1794709959828
 },
 {
  "type": "member.replied",
  "round": 3,
  "member": "proposer",
  "text": "In short: Go with CMP-0423, conditional on a resistance-mutant panel by month 3.\n\nGo with CMP-0423, conditional on a re…",
  "usd": 0,
  "summary": "Go with CMP-0423, conditional on a resistance-mutant panel by month 3.",
  "key": "reply:3:proposer",
  "at": 1794709959828
 },
 {
  "type": "member.replied",
  "round": 3,
  "member": "experimenter",
  "text": "In short: Go with CMP-0423, conditional on a resistance-mutant panel by month 3.\n\nGo with CMP-0423, conditional on a re…",
  "usd": 0,
  "summary": "Go with CMP-0423, conditional on a resistance-mutant panel by month 3.",
  "key": "reply:3:experimenter",
  "at": 1794709959828
 },
 {
  "type": "member.replied",
  "round": 3,
  "member": "methods-auditor",
  "text": "In short: Go with CMP-0423, conditional on a resistance-mutant panel by month 3.\n\nGo with CMP-0423, conditional on a re…",
  "usd": 0,
  "summary": "Go with CMP-0423, conditional on a resistance-mutant panel by month 3.",
  "key": "reply:3:methods-auditor",
  "at": 1794709959828
 },
 {
  "type": "member.replied",
  "round": 3,
  "member": "critic",
  "text": "In short: No-Go: no advantage over the approved drugs is established yet.\n\nNo-Go: no advantage over the approved drugs …",
  "usd": 0,
  "summary": "No-Go: no advantage over the approved drugs is established yet.",
  "key": "reply:3:critic",
  "at": 1794709959828
 },
 {
  "type": "member.replied",
  "round": 3,
  "member": "reporter",
  "text": "In short: Go with CMP-0423, conditional on a resistance-mutant panel by month 3.\n\nGo with CMP-0423, conditional on a re…",
  "usd": 0,
  "summary": "Go with CMP-0423, conditional on a resistance-mutant panel by month 3.",
  "key": "reply:3:reporter",
  "at": 1794709959828
 },
 {
  "type": "memo.written",
  "path": "board/runs/practice/memo.md",
  "decision": "Go with conditions",
  "key": "memo",
  "at": 1794709960767
 },
 {
  "type": "run.finished",
  "usd": 0,
  "minutes": 0.0524,
  "key": "finished",
  "at": 1794709960768
 }
]

/** A practice research answer: GET /api/research/:id/events, in order. */
export const PRACTICE_ANSWER: LabEvent[] = [
 {
  "seq": 1,
  "at": 1794710087307,
  "run": "a-20261114213447-6bdc966c",
  "type": "research.started",
  "id": "a-20261114213447-6bdc966c",
  "thread": "t-2d807a2feb",
  "question": "Do KRAS G12C inhibitors cause hERG problems?",
  "effort": "standard",
  "mode": "demo",
  "caps": {
   "maxUsd": 0,
   "maxSeconds": 120
  },
  "models": {
   "planner": "scripted",
   "writer": "scripted",
   "checker": "scripted",
   "critic": "scripted"
  }
 },
 {
  "seq": 2,
  "at": 1794710087309,
  "run": "a-20261114213447-6bdc966c",
  "type": "step.started",
  "step": "prepare",
  "kind": "prepare",
  "label": "Preparing the searches"
 },
 {
  "seq": 3,
  "at": 1794710087309,
  "run": "a-20261114213447-6bdc966c",
  "type": "step.finished",
  "step": "prepare",
  "status": "completed",
  "ms": 1,
  "summary": "Example sources only."
 },
 {
  "seq": 4,
  "at": 1794710087309,
  "run": "a-20261114213447-6bdc966c",
  "type": "opening",
  "text": "This is a demo: I'll go through the same steps with example sources and fixed text, so nothing is searched an…"
 },
 {
  "seq": 5,
  "at": 1794710087310,
  "run": "a-20261114213447-6bdc966c",
  "type": "step.started",
  "step": "search:fixture:1",
  "kind": "search",
  "label": "Loading example sources",
  "provider": "fixture",
  "query": "Do KRAS G12C inhibitors cause hERG problems?"
 },
 {
  "seq": 6,
  "at": 1794710087310,
  "run": "a-20261114213447-6bdc966c",
  "type": "step.finished",
  "step": "search:fixture:1",
  "status": "completed",
  "ms": 0,
  "found": 4,
  "summary": "4 results."
 },
 {
  "seq": 7,
  "at": 1794710087310,
  "run": "a-20261114213447-6bdc966c",
  "type": "step.started",
  "step": "evaluate:fixture:1",
  "kind": "evaluate",
  "label": "Screening 4 results",
  "provider": "fixture"
 },
 {
  "seq": 8,
  "at": 1794710087311,
  "run": "a-20261114213447-6bdc966c",
  "type": "step.finished",
  "step": "evaluate:fixture:1",
  "status": "completed",
  "ms": 0,
  "found": 4,
  "kept": 3,
  "summary": "3 of 4 kept."
 },
 {
  "seq": 9,
  "at": 1794710087311,
  "run": "a-20261114213447-6bdc966c",
  "type": "sources",
  "items": [
   {
    "n": 1,
    "url": "https://example.org/mock/kras-g12c-clinical-review",
    "title": "KRAS G12C inhibitors in NSCLC: clinical review (mock)",
    "provider": "fixture",
    "note": "example source, clinical"
   },
   {
    "n": 2,
    "url": "https://example.org/mock/herg-acrylamide",
    "title": "hERG liability of piperazine acrylamides (mock)",
    "provider": "fixture",
    "note": "example source, in vitro"
   },
   {
    "n": 3,
    "url": "https://example.org/mock/resistance-mechanisms",
    "title": "Resistance mechanisms to KRAS G12C inhibition (mock)",
    "provider": "fixture",
    "note": "example source, clinical"
   }
  ]
 },
 {
  "seq": 10,
  "at": 1794710087311,
  "run": "a-20261114213447-6bdc966c",
  "type": "selection",
  "criteria": "Kept: results that the screening model judged to help answer the question and that report findings of their o…",
  "selected": [
   {
    "n": 1,
    "why": "Screened as answering the question; study type: clinical.",
    "limitation": "An example source, not a real one."
   },
   {
    "n": 2,
    "why": "Screened as answering the question; study type: in vitro.",
    "limitation": "An example source, not a real one."
   },
   {
    "n": 3,
    "why": "Screened as answering the question; study type: clinical.",
    "limitation": "An example source, not a real one."
   }
  ],
  "notSelected": [
   {
    "title": "Top 10 biotech stocks to watch (mock)",
    "url": "https://example.org/mock/marketing-blog",
    "provider": "fixture",
    "reason": "Screened as not about the question."
   }
  ]
 },
 {
  "seq": 11,
  "at": 1794710087312,
  "run": "a-20261114213447-6bdc966c",
  "type": "step.started",
  "step": "write",
  "kind": "write",
  "label": "Writing the answer from 3 sources"
 },
 {
  "seq": 12,
  "at": 1794710087312,
  "run": "a-20261114213447-6bdc966c",
  "type": "answer.delta",
  "text": "**Demo answer. This is fixed example text, not research. Nothing was searched and no model was asked.**\n\nAppr…"
 },
 {
  "seq": 13,
  "at": 1794710087314,
  "run": "a-20261114213447-6bdc966c",
  "type": "step.finished",
  "step": "write",
  "status": "completed",
  "ms": 2,
  "summary": "68 words, 3 cited sentences."
 },
 {
  "seq": 14,
  "at": 1794710087314,
  "run": "a-20261114213447-6bdc966c",
  "type": "answer.written",
  "markdown": "**Demo answer. This is fixed example text, not research. Nothing was searched and no model was asked.**\n\nAppr…"
 },
 {
  "seq": 15,
  "at": 1794710087314,
  "run": "a-20261114213447-6bdc966c",
  "type": "step.started",
  "step": "check",
  "kind": "check",
  "label": "Checking 3 statements against their sources"
 },
 {
  "seq": 16,
  "at": 1794710087314,
  "run": "a-20261114213447-6bdc966c",
  "type": "review.started",
  "reviewer": "checker",
  "model": "scripted",
  "step": "check"
 },
 {
  "seq": 17,
  "at": 1794710087315,
  "run": "a-20261114213447-6bdc966c",
  "type": "step.started",
  "step": "review",
  "kind": "review",
  "label": "Reviewing the whole draft"
 },
 {
  "seq": 18,
  "at": 1794710087315,
  "run": "a-20261114213447-6bdc966c",
  "type": "review.started",
  "reviewer": "critic",
  "model": "scripted",
  "step": "review"
 },
 {
  "seq": 19,
  "at": 1794710087316,
  "run": "a-20261114213447-6bdc966c",
  "type": "step.finished",
  "step": "review",
  "status": "completed",
  "ms": 2,
  "found": 1,
  "summary": "1 note: 1 blocking."
 },
 {
  "seq": 20,
  "at": 1794710087316,
  "run": "a-20261114213447-6bdc966c",
  "type": "statement.checked",
  "stage": "draft",
  "index": 0,
  "text": "Approved covalent KRAS G12C inhibitors give objective response rates near 37 to 41 percent in previously trea…",
  "sources": [
   1
  ],
  "verdict": "verified",
  "quote": "Approved covalent KRAS G12C inhibitors give objective response rates near 37 to 41 percent in previously trea…",
  "quoteSource": 1,
  "quoteFound": true,
  "checker": "scripted"
 },
 {
  "seq": 21,
  "at": 1794710087317,
  "run": "a-20261114213447-6bdc966c",
  "type": "step.progress",
  "step": "check",
  "done": 1,
  "total": 3
 },
 {
  "seq": 22,
  "at": 1794710087317,
  "run": "a-20261114213447-6bdc966c",
  "type": "statement.checked",
  "stage": "draft",
  "index": 1,
  "text": "Piperazine-linked quinazolines often inhibit hERG at low micromolar concentrations.",
  "sources": [
   2
  ],
  "verdict": "verified",
  "quote": "In vitro patch-clamp data show piperazine-linked quinazolines often inhibit hERG at low micromolar concentrat…",
  "quoteSource": 2,
  "quoteFound": true,
  "checker": "scripted"
 },
 {
  "seq": 23,
  "at": 1794710087317,
  "run": "a-20261114213447-6bdc966c",
  "type": "step.progress",
  "step": "check",
  "done": 2,
  "total": 3
 },
 {
  "seq": 24,
  "at": 1794710087317,
  "run": "a-20261114213447-6bdc966c",
  "type": "statement.checked",
  "stage": "draft",
  "index": 2,
  "text": "No resistance mutations were found in patients progressing on KRAS G12C inhibitors.",
  "sources": [
   3
  ],
  "verdict": "contradicted",
  "quote": "Sequencing of patients progressing on KRAS G12C inhibitors found Y96D and R68S switch-II pocket mutations and…",
  "quoteSource": 3,
  "quoteFound": true,
  "checker": "scripted",
  "note": "source [3] says otherwise"
 },
 {
  "seq": 25,
  "at": 1794710087317,
  "run": "a-20261114213447-6bdc966c",
  "type": "step.progress",
  "step": "check",
  "done": 3,
  "total": 3
 },
 {
  "seq": 26,
  "at": 1794710087317,
  "run": "a-20261114213447-6bdc966c",
  "type": "step.finished",
  "step": "check",
  "status": "completed",
  "ms": 2,
  "summary": "2 hold up, 1 contradicted."
 },
 {
  "seq": 27,
  "at": 1794710087317,
  "run": "a-20261114213447-6bdc966c",
  "type": "review.note",
  "index": 0,
  "reviewer": "critic",
  "severity": "blocking",
  "text": "Demo note (fixed text): the third cited sentence says the opposite of its example source, which reports resis…",
  "statement": 2
 },
 {
  "seq": 28,
  "at": 1794710087317,
  "run": "a-20261114213447-6bdc966c",
  "type": "step.started",
  "step": "revise",
  "kind": "revise",
  "label": "Revising the answer once"
 },
 {
  "seq": 29,
  "at": 1794710087318,
  "run": "a-20261114213447-6bdc966c",
  "type": "step.finished",
  "step": "revise",
  "status": "completed",
  "ms": 1,
  "summary": "2 cited sentences kept, 0 new or changed, 1 removed or rewritten."
 },
 {
  "seq": 30,
  "at": 1794710087318,
  "run": "a-20261114213447-6bdc966c",
  "type": "answer.revised",
  "markdown": "**Demo answer. This is fixed example text, not research. Nothing was searched and no model was asked.**\n\nAppr…",
  "notes": [
   {
    "index": 0,
    "resolved": true,
    "how": "the sentence was removed or rewritten"
   }
  ]
 },
 {
  "seq": 31,
  "at": 1794710087318,
  "run": "a-20261114213447-6bdc966c",
  "type": "statement.checked",
  "stage": "final",
  "index": 0,
  "text": "Approved covalent KRAS G12C inhibitors give objective response rates near 37 to 41 percent in previously trea…",
  "sources": [
   1
  ],
  "verdict": "verified",
  "quote": "Approved covalent KRAS G12C inhibitors give objective response rates near 37 to 41 percent in previously trea…",
  "quoteSource": 1,
  "quoteFound": true,
  "checker": "scripted",
  "carried": true
 },
 {
  "seq": 32,
  "at": 1794710087318,
  "run": "a-20261114213447-6bdc966c",
  "type": "statement.checked",
  "stage": "final",
  "index": 1,
  "text": "Piperazine-linked quinazolines often inhibit hERG at low micromolar concentrations.",
  "sources": [
   2
  ],
  "verdict": "verified",
  "quote": "In vitro patch-clamp data show piperazine-linked quinazolines often inhibit hERG at low micromolar concentrat…",
  "quoteSource": 2,
  "quoteFound": true,
  "checker": "scripted",
  "carried": true
 },
 {
  "seq": 33,
  "at": 1794710087318,
  "run": "a-20261114213447-6bdc966c",
  "type": "sources.cited",
  "n": [
   1,
   2
  ]
 },
 {
  "seq": 34,
  "at": 1794710087319,
  "run": "a-20261114213447-6bdc966c",
  "type": "recommendations",
  "items": [
   {
    "label": "Recommended next step",
    "text": "Demo: look at how the example source on hERG is quoted.",
    "why": "Demo text: the example sentence that cites it passed its ch…",
    "basis": [
     2
    ],
    "does": "It shows what a checked sentence looks like. Nothing is sea…"
   }
  ]
 },
 {
  "seq": 35,
  "at": 1794710087319,
  "run": "a-20261114213447-6bdc966c",
  "type": "step.started",
  "step": "save",
  "kind": "save",
  "label": "Saving the answer and its files"
 },
 {
  "seq": 36,
  "at": 1794710087320,
  "run": "a-20261114213447-6bdc966c",
  "type": "artifact.created",
  "artifact": {
   "id": "a-20261114213447-6bdc966c/answer.md",
   "name": "answer.md",
   "type": "text/markdown",
   "bytes": 1345,
   "at": 1794710087319
  }
 },
 {
  "seq": 37,
  "at": 1794710087320,
  "run": "a-20261114213447-6bdc966c",
  "type": "artifact.created",
  "artifact": {
   "id": "a-20261114213447-6bdc966c/sources.json",
   "name": "sources.json",
   "type": "application/json",
   "bytes": 1481,
   "at": 1794710087319
  }
 },
 {
  "seq": 38,
  "at": 1794710087320,
  "run": "a-20261114213447-6bdc966c",
  "type": "artifact.created",
  "artifact": {
   "id": "a-20261114213447-6bdc966c/sources.csv",
   "name": "sources.csv",
   "type": "text/csv",
   "bytes": 490,
   "at": 1794710087319
  }
 },
 {
  "seq": 39,
  "at": 1794710087320,
  "run": "a-20261114213447-6bdc966c",
  "type": "artifact.created",
  "artifact": {
   "id": "a-20261114213447-6bdc966c/record.json",
   "name": "record.json",
   "type": "application/json",
   "bytes": 8860,
   "at": 1794710087319
  }
 },
 {
  "seq": 40,
  "at": 1794710087320,
  "run": "a-20261114213447-6bdc966c",
  "type": "step.finished",
  "step": "save",
  "status": "completed",
  "ms": 0,
  "summary": "The record and three result files."
 },
 {
  "seq": 41,
  "at": 1794710087320,
  "run": "a-20261114213447-6bdc966c",
  "type": "research.finished",
  "usd": 0,
  "seconds": 0,
  "counts": {
   "sources": 3,
   "statements": 2,
   "verified": 2,
   "contradicted": 0,
   "unsupported": 0,
   "unchecked": 0
  },
  "searches": {
   "fixture": 1
  },
  "review": {
   "checker": "scripted",
   "critic": "scripted",
   "revised": true,
   "notes": {
    "raised": 1,
    "resolved": 1
   }
  }
 }
]
