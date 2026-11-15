// Open Targets Platform: how strongly a target is linked to diseases, its tractability and its known safety liabilities.
// API: GraphQL, POST https://api.platform.opentargets.org/api/v4/graphql (schema browser at
// https://api.platform.opentargets.org/api/v4/graphql/browser).
// A query is a gene symbol (KRAS) or an Ensembl gene id (ENSG00000133703), optionally followed by disease words that
// narrow the associations ("KRAS lung"). The first word is the target.
// One lookup = the target's record (tractability, safety liabilities, function) and up to 7 target-disease
// associations, highest overall score first. Scores are written with every digit the service gives. They run from 0
// to 1 and summarise how much evidence links the two, not how large an effect is.
// Pages: https://platform.opentargets.org/target/<ENSG id> and https://platform.opentargets.org/evidence/<ENSG id>/<disease id>.
import type { EvidenceItem } from "../events.ts"
import { clean, type Http, join, type Json, list, MAX_ITEMS, num, rec, record, say, type SourceResult, words } from "./shared.ts"

export const GRAPHQL = "https://api.platform.opentargets.org/api/v4/graphql"
const PAGE = "https://platform.opentargets.org"
export const ENSG_ID = /^ENSG\d{11}$/
export const DISEASE_ID = /^[A-Za-z]{2,15}_[A-Za-z0-9]{1,20}$/
const ensg = (value: unknown): string => (typeof value === "string" && ENSG_ID.test(value) ? value : "")

/** What is read of a target: the same fields whether it is found by symbol or by id. */
const TARGET_FIELDS = "id approvedSymbol approvedName biotype functionDescriptions tractability{label modality value} safetyLiabilities{event datasource effects{direction dosing} biosamples{tissueLabel cellLabel}} associatedDiseases(BFilter:$filter,page:{index:0,size:$size}){count rows{score disease{id name} datatypeScores{id score}}}"
/** Find by symbol and read the target in one request: each hit carries its target's record. */
export const SEARCH_QUERY = `query($q:String!,$filter:String,$size:Int!){search(queryString:$q,entityNames:["target"],page:{index:0,size:5}){hits{id entity name description object{... on Target{${TARGET_FIELDS}}}}}}`
export const TARGET_QUERY = `query($id:String!,$filter:String,$size:Int!){target(ensemblId:$id){${TARGET_FIELDS}}}`

const MODALITY: Record<string, string> = { SM: "Small molecule", AB: "Antibody", PR: "PROTAC", OC: "Other clinical" }
const SCORE_NOTE = "Open Targets scores run from 0 to 1 and summarise how much evidence links the target and the disease, not how large an effect is."

function tractabilityText(entries: unknown): string {
  const by = new Map<string, { yes: string[]; no: string[] }>()
  for (const t of list(entries).map(rec)) {
    const modality = clean(t.modality), label = clean(t.label)
    if (!modality || !label || typeof t.value !== "boolean") continue
    const group = by.get(modality) ?? { yes: [], no: [] }
    ;(t.value ? group.yes : group.no).push(label)
    by.set(modality, group)
  }
  return [...by].map(([modality, g]) => join([`${MODALITY[modality] ? `${MODALITY[modality]} (${modality})` : modality}:`, g.yes.length ? `yes for ${g.yes.join(", ")}` : "", g.no.length ? `${g.yes.length ? "; " : ""}no for ${g.no.join(", ")}` : ""]).replace(" ; ", "; ")).join(". ")
}

function safetyText(entries: unknown): string {
  return list(entries).map(rec).map((s) => {
    const event = clean(s.event)
    if (!event) return ""
    const effects = [...new Set(list(s.effects).map(rec).map((e) => join([clean(e.direction), clean(e.dosing)], ", ")).filter(Boolean))]
    const where = [...new Set(list(s.biosamples).map(rec).map((b) => clean(b.tissueLabel) || clean(b.cellLabel)).filter(Boolean))]
    const detail = join([effects.length > 0 && `effect: ${effects.join(" / ")}`, where.length > 0 && `in ${where.slice(0, 4).join(", ")}`, clean(s.datasource) && `source: ${clean(s.datasource)}`], "; ")
    return join([event, detail && `(${detail})`])
  }).filter(Boolean).slice(0, 25).join("; ")
}

/** The target's record and its disease associations as evidence items. None when the target has no valid id. */
export function targetItems(target: Json): EvidenceItem[] {
  const id = ensg(target.id)
  if (!id) return []
  const symbol = clean(target.approvedSymbol) || id, name = clean(target.approvedName)
  const items: EvidenceItem[] = []
  const head = record(`${PAGE}/target/${id}`, `${symbol} (${id}): Open Targets target record`, join([
    `Open Targets target record ${id}: ${symbol}${name ? `, ${name}` : ""}.`,
    say("Biotype", clean(target.biotype)),
    say("Tractability", tractabilityText(target.tractability)),
    say("Safety liabilities (reported events)", safetyText(target.safetyLiabilities)),
    say("Function", [...new Set(list(target.functionDescriptions).map((x) => clean(x)).filter(Boolean))].join(" ")),
  ]))
  if (head) items.push(head)
  for (const row of list(rec(target.associatedDiseases).rows).map(rec)) {
    if (items.length >= MAX_ITEMS) break
    const disease = rec(row.disease), diseaseId = typeof disease.id === "string" && DISEASE_ID.test(disease.id) ? disease.id : "", diseaseName = clean(disease.name), score = num(row.score)
    if (!diseaseId || !diseaseName || !score) continue
    const types = list(row.datatypeScores).map(rec).map((d) => (clean(d.id) && num(d.score) ? `${clean(d.id)} ${num(d.score)}` : "")).filter(Boolean)
    const item = record(`${PAGE}/evidence/${id}/${diseaseId}`, `${symbol} and ${diseaseName}: Open Targets association`, join([
      `Open Targets association between the target ${symbol} (${id}) and the disease ${diseaseName} (${diseaseId}).`,
      say("Overall association score", score),
      say("Scores by data type", types.join("; ")),
      SCORE_NOTE,
    ]))
    if (item) items.push(item)
  }
  return items
}

/**
 * One Open Targets lookup: one request (a symbol is found and its target read in the same request; an Ensembl id is
 * read directly). A second request only when the search names a target but does not carry its record.
 */
export async function openTargetsSearch(query: string, http: Http): Promise<SourceResult> {
  const [first, ...rest] = query.trim().split(/\s+/)
  const filter = words(rest.join(" ")).join(" ")
  const variables = { filter: filter || null, size: MAX_ITEMS - 1 }
  const notices: string[] = []
  let id = ensg(first?.toUpperCase())
  let target: Json | undefined
  if (!id) {
    const token = words(first ?? "")[0]
    if (!token) return { items: [], notices: ["Write a gene symbol (for example KRAS) or an Ensembl gene id first, then disease words if you want to narrow the associations. Nothing was looked up."] }
    const found = await http.json("opentargets", GRAPHQL, { post: { query: SEARCH_QUERY, variables: { q: token, ...variables } } })
    const hits = list(rec(rec(rec(found.body).data).search).hits).map(rec).filter((h) => h.entity === "target" && ensg(h.id))
    const hit = hits.find((h) => clean(h.name).toLowerCase() === token) ?? hits[0]
    if (!hit) return { items: [], notices: [`Open Targets has no target for "${token}". Write the official gene symbol or an Ensembl gene id as the first word.`] }
    if (clean(hit.name).toLowerCase() !== token) notices.push(`Open Targets has no target with the symbol "${token}"; its closest match is ${clean(hit.name)} (${clean(hit.description)}), used here. Check that it is the target you mean.`)
    id = ensg(hit.id)
    if (ensg(rec(hit.object).id) === id) target = rec(hit.object)
  }
  if (!target) {
    const answer = await http.json("opentargets", GRAPHQL, { post: { query: TARGET_QUERY, variables: { id, ...variables } } })
    target = rec(rec(rec(answer.body).data).target)
  }
  const items = targetItems(target)
  if (!items.length) return { items: [], notices: [...notices, `Open Targets has no target ${id}.`] }
  const count = num(rec(target.associatedDiseases).count), shown = items.length - 1
  notices.push(shown
    ? `Open Targets lists ${count || "several"} diseases associated with ${clean(target.approvedSymbol) || id}${filter ? ` whose name matches "${filter}"` : ""}; these are the ${shown} with the highest overall score. ${SCORE_NOTE}`
    : `Open Targets lists no associated disease for ${clean(target.approvedSymbol) || id}${filter ? ` whose name matches "${filter}". Ask again without the disease words to see all` : ""}.`)
  if (!list(target.safetyLiabilities).length) notices.push("Open Targets holds no safety liability entry for this target. That is not evidence that it has none.")
  return { items, notices }
}
