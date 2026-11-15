// ClinicalTrials.gov: registered trials for a condition or an intervention.
// API v2: https://clinicaltrials.gov/data-api/api (GET /api/v2/studies, GET /api/v2/studies/{nctId}).
// A query is free text (the site's own search syntax, as in its search box), or one NCT number for that trial.
// Each trial is one item. Codes (RECRUITING, PHASE3, ESTIMATED ...) are written as the registry gives them.
// A registry record says what a trial plans or did; it holds results only when "Results posted" says yes, and the
// results themselves are not fetched here.
// Page: https://clinicaltrials.gov/study/<NCT number>.
import type { EvidenceItem } from "../events.ts"
import { clean, type Http, join, type Json, list, MAX_ITEMS, num, rec, record, say, type SourceResult } from "./shared.ts"

const API = "https://clinicaltrials.gov/api/v2/studies"
export const NCT_ID = /^NCT\d{8}$/
const nctId = (value: unknown): string => (typeof value === "string" && NCT_ID.test(value) ? value : "")

/** Only what the text below uses; a full record is about 20 KB. */
export const FIELDS = [
  "NCTId", "BriefTitle", "OfficialTitle", "OverallStatus", "WhyStopped", "StartDateStruct", "PrimaryCompletionDateStruct", "CompletionDateStruct", "LastUpdatePostDateStruct",
  "LeadSponsor", "BriefSummary", "Condition", "StudyType", "Phase", "EnrollmentInfo", "InterventionType", "InterventionName", "PrimaryOutcome", "HasResults",
].join(",")

export const searchUrl = (query: string) => `${API}?${new URLSearchParams({ "query.term": query, pageSize: String(MAX_ITEMS), countTotal: "true", format: "json", fields: FIELDS })}`
export const studyUrl = (id: string) => `${API}/${id}?${new URLSearchParams({ format: "json", fields: FIELDS })}`

const dated = (struct: unknown): string => {
  const date = clean(rec(struct).date)
  return /^\d{4}(-\d{2}){0,2}$/.test(date) ? join([date, clean(rec(struct).type) && `(${clean(rec(struct).type)})`]) : ""
}

/** One trial record as an evidence item. Undefined when the record has no valid NCT number or no title. */
export function studyItem(study: unknown): EvidenceItem | undefined {
  const p = rec(rec(study).protocolSection)
  const ident = rec(p.identificationModule), status = rec(p.statusModule), design = rec(p.designModule), arms = rec(p.armsInterventionsModule)
  const id = nctId(ident.nctId), title = clean(ident.briefTitle)
  if (!id || !title) return undefined
  const sponsor = rec(rec(p.sponsorCollaboratorsModule).leadSponsor), enrollment = rec(design.enrollmentInfo)
  const interventions = list(arms.interventions).map(rec).map((i) => join([clean(i.type) && `${clean(i.type)}:`, clean(i.name)])).filter(Boolean)
  const outcomes = list(rec(p.outcomesModule).primaryOutcomes).map(rec).map((o) => join([clean(o.measure, 300), clean(o.timeFrame) && `(time frame: ${clean(o.timeFrame, 200)})`])).filter(Boolean)
  const hasResults = rec(study).hasResults
  const text = join([
    `ClinicalTrials.gov record ${id}.`,
    say("Official title", clean(ident.officialTitle, 400)),
    say("Overall status", clean(status.overallStatus)),
    say("Why stopped", clean(status.whyStopped, 300)),
    say("Phase", list(design.phases).map((x) => clean(x)).filter(Boolean).join(", ")),
    say("Study type", clean(design.studyType)),
    say("Enrollment", join([num(enrollment.count), num(enrollment.count) && clean(enrollment.type) && `(${clean(enrollment.type)})`])),
    say("Conditions", list(rec(p.conditionsModule).conditions).map((x) => clean(x)).filter(Boolean).slice(0, 10).join("; ")),
    say("Interventions", interventions.slice(0, 10).join("; ")),
    say(outcomes.length > 1 ? "Primary outcomes" : "Primary outcome", outcomes.slice(0, 4).join("; ")),
    say("Lead sponsor", join([clean(sponsor.name), clean(sponsor.name) && clean(sponsor.class) && `(${clean(sponsor.class)})`])),
    say("Start date", dated(status.startDateStruct)),
    say("Primary completion date", dated(status.primaryCompletionDateStruct)),
    say("Completion date", dated(status.completionDateStruct)),
    typeof hasResults === "boolean" && `Results posted on ClinicalTrials.gov: ${hasResults ? "yes" : "no"}.`,
    say("Record last updated", dated(status.lastUpdatePostDateStruct)),
    say("Brief summary", clean(rec(p.descriptionModule).briefSummary)),
  ])
  return record(`https://clinicaltrials.gov/study/${id}`, `${title} (${id}, ClinicalTrials.gov)`, text)
}

/** One ClinicalTrials.gov lookup: one request. */
export async function clinicalTrialsSearch(query: string, http: Http): Promise<SourceResult> {
  const one = query.toUpperCase()
  if (NCT_ID.test(one)) {
    const answer = await http.json("clinicaltrials", studyUrl(one), { emptyOn: [400, 404] }) // 400 is its answer for a number it does not hold
    const item = answer.body === undefined ? undefined : studyItem(answer.body)
    return item ? { items: [item], notices: [] } : { items: [], notices: [`ClinicalTrials.gov has no record ${one}.`] }
  }
  const body = rec((await http.json("clinicaltrials", searchUrl(query))).body)
  const items = list(body.studies).map(studyItem).filter((i): i is EvidenceItem => Boolean(i)).slice(0, MAX_ITEMS)
  const total = num((body as Json).totalCount)
  if (!items.length) return { items, notices: ["ClinicalTrials.gov found no trial for this query. Try fewer or other words (a condition, a drug name), or an NCT number."] }
  return { items, notices: [`ClinicalTrials.gov ${total ? `lists ${total} trials for this query` : "lists more trials than shown"}; these are the first ${items.length} by its relevance order. A registry record describes a trial; it is not a result.`] }
}
