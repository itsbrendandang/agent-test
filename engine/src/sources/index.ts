// database_search: free, structured evidence from six public biomedical databases, for the board member that searches.
//
//   chembl          ChEMBL (EMBL-EBI): bioactivity, mechanism, highest clinical phase          chembl.ts
//   clinicaltrials  ClinicalTrials.gov: registered trials                                      clinicaltrials.ts
//   openfda         openFDA: drug label sections, adverse-event report counts                  openfda.ts
//   opentargets     Open Targets Platform: target-disease association, tractability, safety    opentargets.ts
//   uniprot         UniProt: protein function, disease involvement, variants, location         uniprot.ts
//   pubchem         PubChem: compound identity and properties                                  pubchem.ts
//
// None needs a key and none costs money. Every record becomes an EvidenceItem { url, title, text }: the url is the
// record's page for people, built only from an id that passed a strict pattern; the text is plain prose that holds the
// values as the service gave them, so a checker's quote can be found in it. The limits and the request rules are in
// shared.ts. What a lookup found goes through the same screening and the same evidence pool as every other search
// (board.ts intoPool); a statement is "verified" only when the quoted passage and its numbers are in the record's text.
//
// A scripted (practice) run never reaches the network: databaseOnce returns the example sources and calls no client.
import type { EvidenceItem } from "../events.ts"
import { MOCK_EVIDENCE } from "../mock.ts"
import { chemblSearch } from "./chembl.ts"
import { clinicalTrialsSearch } from "./clinicaltrials.ts"
import { openFdaSearch } from "./openfda.ts"
import { openTargetsSearch } from "./opentargets.ts"
import { pubchemSearch } from "./pubchem.ts"
import { type DatabaseSource, type Http, isSource, limited, liveHttp, MAX_ITEMS, MAX_QUERY_CHARS, plainQuery, serviceName, ServiceError, SOURCES, type SourceResult } from "./shared.ts"
import { uniprotSearch } from "./uniprot.ts"

export { createHttp, isSource, MAX_ITEMS, MAX_QUERY_CHARS, MAX_TEXT_CHARS, MIN_GAP_MS, serviceName, ServiceError, SOURCES, TIMEOUT_MS, USER_AGENT } from "./shared.ts"
export type { DatabaseSource, Http, SourceResult } from "./shared.ts"

export const DEFAULT_MAX_DATABASE_SEARCHES = 20

const CLIENTS: Record<DatabaseSource, (query: string, http: Http) => Promise<SourceResult>> = {
  chembl: chemblSearch, clinicaltrials: clinicalTrialsSearch, openfda: openFdaSearch, opentargets: openTargetsSearch, uniprot: uniprotSearch, pubchem: pubchemSearch,
}

/** What the tool's `source` parameter says. */
export const SOURCE_DESCRIPTION = `Which database: ${SOURCES.join(", ")}`
/** What the tool's `query` parameter says: each database reads a query its own way. */
export const QUERY_DESCRIPTION = [
  "What to look up. Each database reads it its own way:",
  'chembl: a compound name or ChEMBL id; or "target: <gene symbol>"; or both ("sotorasib target: KRAS").',
  "clinicaltrials: a condition and/or an intervention in a few words, or one NCT number.",
  "openfda: one drug name, generic or brand (letters, digits, spaces, hyphens).",
  'opentargets: a gene symbol or Ensembl gene id, then optional disease words ("KRAS lung").',
  "uniprot: a gene symbol, a protein name or a UniProt accession.",
  "pubchem: a compound name or a PubChem CID.",
].join(" ")

/** What a member that holds the tool is told about using it. */
export const DATABASE_GUIDANCE = `# Looking up database records
\`database_search\` reads one public database and returns its records. It is free. Use it after the web search and the
literature search, for facts that live in a registry or a curated database, not in a paper.
- Choose \`source\` by what you need:
  - \`clinicaltrials\`: which trials exist for a condition or a drug: phase, status, enrollment, primary outcome, sponsor, dates.
  - \`chembl\`: measured potency of a compound or against a target (IC50, Ki ...), a drug's mechanism and highest clinical phase.
  - \`openfda\`: what a marketed drug's FDA label says (boxed warning, warnings, adverse reactions) and how often reactions were reported.
  - \`opentargets\`: how strong the evidence is that a target is linked to a disease, the target's tractability and known safety liabilities.
  - \`uniprot\`: what a protein does, the diseases and natural variants linked to it, where it is in the cell.
  - \`pubchem\`: a compound's identity (formula, weight, SMILES) and properties.
- Write \`query\` the way that database reads it (the tool says how). A candidate that has only an internal code is not in
  these databases: look up the approved drugs, the target and the disease instead.
- What comes back are records, not papers. A trial record says what was planned or done, not that the drug works. One
  bioactivity value is one experiment, and \`chembl\` gives the most potent values first: that end also holds the
  outliers and data errors, so do not present one as typical. Adverse-event counts are reports, not rates. An Open
  Targets score measures how much evidence there is, not the size of an effect.
- State a value only as the record gives it, with its unit. Do not convert or round it.
- Cite a record by its exact URL. The notes that come with the results are for you: do not cite them.`

/**
 * One live lookup in one database. Returns the records as evidence items (no more than MAX_ITEMS, with no provider
 * set: the caller labels them) and notes for the reader. An empty result is not an error. Throws ServiceError when
 * the service does not answer or its answer cannot be used. `http` is replaced in tests; the default reaches the network.
 */
export async function databaseLive(source: DatabaseSource, query: string, http: Http = liveHttp): Promise<SourceResult> {
  if (!isSource(source)) throw new ServiceError(`Unknown database "${String(source).slice(0, 40)}"`)
  const q = plainQuery(query)
  if (!q) return { items: [], notices: [`Write a query of 1 to ${MAX_QUERY_CHARS} characters. Nothing was looked up.`] }
  let result: SourceResult
  try { result = await CLIENTS[source](q, limited(http)) } catch (error) {
    if (error instanceof ServiceError) throw error
    // A client that trips over an answer it did not expect must not stop a run: it is reported as the service's failure.
    throw new ServiceError(`${serviceName(source)} sent an answer this lookup could not read`)
  }
  return { items: result.items.slice(0, MAX_ITEMS), notices: result.notices }
}

/** What a practice run is given in place of a lookup: the example sources. No client is called. */
export const fixtureRecords = (): SourceResult => ({ items: MOCK_EVIDENCE.slice(0, 5).map((item) => ({ ...item })), notices: [] })

export interface DatabaseDeps {
  /** `databases`: the lookups this run made, by tool call id. A replayed call (after a crash) reads its result here. */
  state: { databases?: Record<string, { source: DatabaseSource; query: string; items: EvidenceItem[]; notices: string[] }> }
  /** Scripted run: the example sources, no network, nothing counted or stored. */
  mock: boolean
  maxSearches: number
  search: (source: DatabaseSource, query: string) => Promise<SourceResult>
  /** True once the run has spent max_usd: the lookup is free, but screening its results is not. */
  capReached: () => Promise<boolean>
  /** True when paid calls were switched off during a real run: its results could not be screened. */
  paidOff?: () => boolean
}

// Lookups that were let through and have not answered yet, per run state: counted against the cap, so several calls
// made at the same moment cannot all pass a cap that has room for one.
const inFlight = new WeakMap<object, Set<string>>()

/**
 * One database lookup for a tool call. A call id that already has a stored result (a crash replay) returns it without
 * a second request. Refused past the per-run count, at the spend cap, or with paid calls switched off; a refusal never
 * falls back to example sources. A service that fails does not stop the run: the member is told, and the call is
 * neither stored nor counted.
 */
export async function databaseOnce(deps: DatabaseDeps, callId: string, source: unknown, query: unknown): Promise<{ result?: SourceResult; refused?: string; failed?: boolean }> {
  const { state } = deps
  if (deps.mock) return { result: fixtureRecords() }
  const stored = state.databases?.[callId]
  if (stored) return { result: { items: stored.items, notices: stored.notices } }
  if (!isSource(source)) return { refused: `Unknown database "${String(source).slice(0, 40)}". Use one of: ${SOURCES.join(", ")}. Nothing was looked up, and this call was not counted.`, failed: true }
  const q = plainQuery(query)
  if (!q) return { refused: `Write a query of 1 to ${MAX_QUERY_CHARS} characters. Nothing was looked up, and this call was not counted.`, failed: true }
  const flying = inFlight.get(state) ?? new Set<string>()
  inFlight.set(state, flying)
  const used = Object.keys(state.databases ?? {}).length + flying.size
  if (deps.paidOff?.()) return { refused: "Paid calls were switched off: database records can no longer be screened. Work from what you have and say so." }
  if (used >= deps.maxSearches) return { refused: `Database lookup budget used up: ${used} of ${deps.maxSearches} for this run. Work from what you have and say so.` }
  if (await deps.capReached()) return { refused: "Spend cap reached: database records can no longer be screened. Work from what you have and say so." }
  if (Object.keys(state.databases ?? {}).length + flying.size >= deps.maxSearches) return { refused: `Database lookup budget used up: ${deps.maxSearches} of ${deps.maxSearches} for this run. Work from what you have and say so.` }
  flying.add(callId)
  try {
    let result: SourceResult
    try { result = await deps.search(source, q) } catch (error) {
      return { refused: `${serviceName(source)} could not be read (${error instanceof ServiceError ? error.message : "the lookup failed"}). Try another database or search, or work from what you have and say so. This call was not counted.`, failed: true }
    }
    const kept = { items: result.items.slice(0, MAX_ITEMS), notices: result.notices }
    state.databases = { ...state.databases, [callId]: { source, query: q, ...kept } }
    return { result: kept }
  } finally { flying.delete(callId) }
}
