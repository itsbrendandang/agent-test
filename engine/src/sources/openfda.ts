// openFDA: sections of a drug's FDA label, and counts of adverse-event reports (FAERS).
// API: https://open.fda.gov/apis/ (GET /drug/label.json, GET /drug/event.json). No key is sent: openFDA then allows
// 240 requests a minute and 1,000 a day per IP address.
// A query is one drug name, generic or brand: letters, digits, spaces and hyphens only (it is put inside quotes in
// openFDA's search syntax, so nothing else is accepted).
// One lookup = the most recently updated label that names the drug (its boxed warning, warnings, adverse reactions,
// contraindications and indications, each as one item), plus one item of report counts when the label names exactly
// one active substance.
// Pages: the label on DailyMed (NLM), https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=<set id>, with
// "#<section>" added so each section is its own source (DailyMed ignores it and opens the label). The report counts
// have no page for people: their address is the openFDA request itself, built from the substance's UNII.
import type { EvidenceItem } from "../events.ts"
import { clean, type Http, join, type Json, list, num, rec, record, ServiceError, type SourceResult } from "./shared.ts"

const API = "https://api.fda.gov/drug"
export const DRUG_NAME = /^[A-Za-z0-9][A-Za-z0-9 -]{1,79}$/
export const SET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const UNII = /^[A-Z0-9]{10}$/
const TOP_REACTIONS = 15

/** Label sections, in the order they are given: field(s) in openFDA's answer, the part after "#", and a plain name. */
export const SECTIONS: { fields: string[]; anchor: string; name: string }[] = [
  { fields: ["boxed_warning"], anchor: "boxed-warning", name: "boxed warning" },
  { fields: ["warnings_and_cautions", "warnings"], anchor: "warnings", name: "warnings and precautions" },
  { fields: ["adverse_reactions"], anchor: "adverse-reactions", name: "adverse reactions" },
  { fields: ["contraindications"], anchor: "contraindications", name: "contraindications" },
  { fields: ["indications_and_usage"], anchor: "indications", name: "indications and usage" },
]

const q = (expression: string) => encodeURIComponent(expression)
export const labelUrl = (name: string) =>
  `${API}/label.json?search=${q(`(openfda.generic_name:"${name}" OR openfda.brand_name:"${name}" OR openfda.substance_name:"${name}")`)}&sort=${q("effective_time:desc")}&limit=1`
const eventSearch = (unii: string) => q(`patient.drug.openfda.unii:"${unii}"`)
export const reactionCountUrl = (unii: string, limit?: number) => `${API}/event.json?search=${eventSearch(unii)}&count=patient.reaction.reactionmeddrapt.exact${limit ? `&limit=${limit}` : ""}`
export const seriousCountUrl = (unii: string) => `${API}/event.json?search=${eventSearch(unii)}&count=serious`

const firsts = (value: unknown, max = 3): string => list(value).map((x) => clean(x)).filter(Boolean).slice(0, max).join(", ")

/** The label's sections as evidence items. None when the label has no valid set id. */
export function labelItems(label: Json): EvidenceItem[] {
  const setId = typeof label.set_id === "string" && SET_ID.test(label.set_id.toLowerCase()) ? label.set_id.toLowerCase() : ""
  if (!setId) return []
  const o = rec(label.openfda)
  const brand = firsts(o.brand_name), generic = firsts(o.generic_name), effective = clean(label.effective_time)
  const what = join([brand || generic || "a drug", brand && generic && `, generic name ${generic}`]).replace(" ,", ",")
  const details = join([firsts(o.manufacturer_name, 1), firsts(o.application_number) && `application ${firsts(o.application_number)}`, firsts(o.product_type, 1), firsts(o.route) && `route ${firsts(o.route)}`, /^\d{8}$/.test(effective) && `label effective date ${effective}`], "; ")
  const items: EvidenceItem[] = []
  for (const section of SECTIONS) {
    const field = section.fields.find((f) => list(label[f]).some((x) => clean(x)))
    if (!field) continue
    const body = list(label[field]).map((x) => clean(x)).filter(Boolean).join(" ")
    const item = record(`https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${setId}#${section.anchor}`, `${brand || generic || "Drug"}: ${section.name} (FDA label)`,
      `FDA drug label for ${what}${details ? ` (${details})` : ""}, section "${section.name}": ${body}`)
    if (item) items.push(item)
  }
  return items
}

const counts = (body: unknown): { term: string; count: string }[] =>
  list(rec(body).results).map(rec).map((r) => ({ term: clean(r.term), count: num(r.count) })).filter((r) => r.term && /^\d+$/.test(r.count))

/** The adverse-event report counts for one substance as an evidence item. Undefined when there are no counts. */
export function eventItem(unii: string, substance: string, reactions: unknown, serious: unknown): EvidenceItem | undefined {
  if (!UNII.test(unii)) return undefined
  const top = counts(reactions)
  if (!top.length) return undefined
  const updated = clean(rec(rec(reactions).meta).last_updated)
  const bySerious = new Map(counts(serious).map((r) => [r.term, r.count]))
  const text = join([
    `FDA Adverse Event Reporting System (FAERS), through openFDA: reports that name a drug with the substance identifier (UNII) ${unii}${substance ? ` (${substance})` : ""}.`,
    `Reactions reported most often, as MedDRA term and number of reports: ${top.map((r) => `${r.term}: ${r.count}`).join("; ")}.`,
    bySerious.get("1") && `Reports marked serious: ${bySerious.get("1")}.`,
    bySerious.get("2") && `Reports marked not serious: ${bySerious.get("2")}.`,
    /^\d{4}-\d{2}-\d{2}$/.test(updated) && `openFDA data last updated: ${updated}.`,
    "These are spontaneous reports. A report does not show that the drug caused the reaction, the counts are not rates, and reports often name the disease that was treated.",
  ])
  return record(reactionCountUrl(unii), `${substance || unii}: FDA adverse event reports (FAERS), counts by reaction`, text)
}

/** One openFDA lookup: at most 3 requests (the label, the reaction counts, the serious / not serious counts). */
export async function openFdaSearch(query: string, http: Http): Promise<SourceResult> {
  const name = query.replace(/\s+/g, " ").trim()
  if (!DRUG_NAME.test(name)) return { items: [], notices: ["Write one drug name, generic or brand, with letters, digits, spaces and hyphens only (for example: sotorasib). Nothing was looked up."] }
  const answer = await http.json("openfda", labelUrl(name), { emptyOn: [404] }) // openFDA answers 404 when nothing matches
  const body = rec(answer.body), label = list(body.results).map(rec)[0]
  const items = label ? labelItems(label) : []
  if (!items.length) return { items: [], notices: [`openFDA has no drug label that names "${name}" as its generic name, brand name or substance. Try the other name of the drug.`] }
  const o = rec(label.openfda), total = num(rec(rec(body.meta).results).total)
  const notices = [`openFDA has ${total || "one or more"} label${total === "1" ? "" : "s"} naming "${name}". This is the most recently updated one: ${join([firsts(o.brand_name), firsts(o.generic_name) && `(${firsts(o.generic_name)})`, firsts(o.manufacturer_name, 1)], " ")}. Check that it is the product you mean; a brand name gives one product. Each section is cut to 3000 characters.`]
  const uniis = list(o.unii).filter((u): u is string => typeof u === "string" && UNII.test(u))
  if (uniis.length !== 1) return { items, notices: [...notices, uniis.length ? "The label names more than one active substance, so no adverse-event counts were fetched (they are per substance)." : "openFDA gives no substance identifier for this label, so no adverse-event counts were fetched."] }
  try {
    const reactions = await http.json("openfda", reactionCountUrl(uniis[0], TOP_REACTIONS), { emptyOn: [404] })
    const serious = reactions.status === 404 ? undefined : await http.json("openfda", seriousCountUrl(uniis[0]), { emptyOn: [404] })
    const events = reactions.status === 404 ? undefined : eventItem(uniis[0], firsts(o.substance_name), reactions.body, serious?.body)
    if (events) items.push(events)
    else notices.push("openFDA has no adverse-event report that names this substance.")
  } catch (error) {
    if (!(error instanceof ServiceError)) throw error
    notices.push(`The adverse-event counts could not be fetched (${error.message}); the label sections are complete.`)
  }
  return { items, notices }
}
