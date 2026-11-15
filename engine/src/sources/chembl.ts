// ChEMBL (EMBL-EBI): bioactivity records, mechanism of action and the highest clinical phase of a compound.
// API: https://www.ebi.ac.uk/chembl/api/data (documented at https://chembl.gitbook.io/chembl-interface-documentation/web-services).
// Only the filter endpoints are used (molecule.json, target.json, mechanism.json, activity.json): the free-text
// "/search" endpoints did not answer within 20 seconds when this was written.
//
// A query is: a compound name or ChEMBL id; or "target: <gene symbol, name or ChEMBL target id>"; or both
// ("sotorasib target: KRAS"), which gives that compound's measurements against that target.
// Activity records are the ones with a pChEMBL value (a potency: IC50, Ki, Kd, EC50 ... with "=" and molar units),
// highest pChEMBL first. Values are ChEMBL's "standard" value and units, with the value as published beside it when
// the two differ. Nothing is recomputed here.
// Pages: https://www.ebi.ac.uk/chembl/explore/{compound|target|assay}/<ChEMBL id> (what the old report-card
// addresses redirect to).
import type { EvidenceItem } from "../events.ts"
import { clean, type Http, join, type Json, list, MAX_ITEMS, num, rec, record, say, type SourceResult } from "./shared.ts"

const API = "https://www.ebi.ac.uk/chembl/api/data"
const PAGE = "https://www.ebi.ac.uk/chembl/explore"
export const CHEMBL_ID = /^CHEMBL[1-9]\d{0,9}$/
const chemblId = (value: unknown): string => (typeof value === "string" && CHEMBL_ID.test(value) ? value : "")

const MOLECULE_FIELDS = "molecule_chembl_id,pref_name,molecule_type,max_phase,first_approval,black_box_warning,withdrawn_flag,molecule_hierarchy,molecule_properties,molecule_structures"
const TARGET_FIELDS = "target_chembl_id,pref_name,organism,target_type"
const MECHANISM_FIELDS = "mechanism_of_action,action_type,target_chembl_id,mechanism_comment,variant_sequence"
const ACTIVITY_FIELDS = "molecule_chembl_id,molecule_pref_name,canonical_smiles,target_chembl_id,target_pref_name,target_organism,assay_chembl_id,assay_description,assay_type,assay_variant_mutation,standard_type,standard_relation,standard_value,standard_units,type,relation,value,units,pchembl_value,document_chembl_id,document_journal,document_year,data_validity_comment,activity_comment"

/** ChEMBL's own scale for max_phase (schema documentation of molecule_dictionary.max_phase). */
const PHASE: Record<string, string> = { "4": "approved", "3": "phase 3 clinical trials", "2": "phase 2 clinical trials", "1": "phase 1 clinical trials", "0.5": "early phase 1 clinical trials", "-1": "clinical phase unknown" }
const ASSAY_TYPE: Record<string, string> = { B: "binding", F: "functional", A: "ADME", T: "toxicity", P: "physicochemical", U: "unclassified" }

export interface ChemblQuery { compound: string; target: string }
/** "sotorasib target: KRAS" -> { compound: "sotorasib", target: "KRAS" }. Either part may be empty. */
export function parseChemblQuery(query: string): ChemblQuery {
  const m = /^(.*?)\btarget\s*:\s*(.*)$/i.exec(query)
  const compound = (m ? m[1] : query).replace(/^\s*compound\s*:\s*/i, "").trim()
  return { compound, target: m ? m[2].trim() : "" }
}

const url = (resource: string, params: Record<string, string>) => `${API}/${resource}.json?${new URLSearchParams(params)}`

export const moleculeUrl = (name: string, by: "id" | "synonym" | "name") =>
  url("molecule", { ...(by === "id" ? { molecule_chembl_id: name } : by === "synonym" ? { molecule_synonyms__molecule_synonym__iexact: name } : { pref_name__iexact: name }), limit: "5", only: MOLECULE_FIELDS })
export const targetUrl = (name: string, by: "id" | "synonym" | "name") =>
  url("target", { ...(by === "id" ? { target_chembl_id: name } : by === "synonym" ? { target_components__target_component_synonyms__component_synonym__iexact: name } : { pref_name__iexact: name }), limit: "20", only: TARGET_FIELDS })
export const mechanismUrl = (moleculeId: string) => url("mechanism", { molecule_chembl_id: moleculeId, limit: "5", only: MECHANISM_FIELDS })
export const activityUrl = (moleculeId: string, targetId: string) =>
  url("activity", { ...(moleculeId ? { molecule_chembl_id: moleculeId } : {}), ...(targetId ? { target_chembl_id: targetId } : {}), pchembl_value__isnull: "false", order_by: "-pchembl_value", limit: String(MAX_ITEMS), only: ACTIVITY_FIELDS })

const labelled = (value: string, table: Record<string, string>, key = value) => (table[key] ? `${value} (${table[key]})` : value)

/** The compound's own record: name, type, highest phase, approval, mechanisms and ChEMBL's calculated properties. */
export function compoundItem(molecule: Json, mechanisms: unknown[]): EvidenceItem | undefined {
  const id = chemblId(molecule.molecule_chembl_id)
  if (!id) return undefined
  const name = clean(molecule.pref_name), phase = num(molecule.max_phase), p = rec(molecule.molecule_properties)
  const mechanismText = mechanisms.map(rec).map((m) => join([
    clean(m.mechanism_of_action), clean(m.action_type) && `action type ${clean(m.action_type)}`, chemblId(m.target_chembl_id) && `target ${chemblId(m.target_chembl_id)}`,
    clean(rec(m.variant_sequence).mutation) && `mutation ${clean(rec(m.variant_sequence).mutation)}`, clean(m.mechanism_comment) && `comment: ${clean(m.mechanism_comment)}`,
  ], "; ")).filter(Boolean).join(". Also: ")
  const properties = join([
    clean(p.full_molformula) && `molecular formula ${clean(p.full_molformula)}`, num(p.full_mwt) && `molecular weight ${num(p.full_mwt)}`, num(p.alogp) && `AlogP ${num(p.alogp)}`,
    num(p.psa) && `polar surface area ${num(p.psa)}`, num(p.hba) && `hydrogen bond acceptors ${num(p.hba)}`, num(p.hbd) && `hydrogen bond donors ${num(p.hbd)}`,
    num(p.rtb) && `rotatable bonds ${num(p.rtb)}`, num(p.num_ro5_violations) && `rule-of-five violations ${num(p.num_ro5_violations)}`, num(p.qed_weighted) && `QED (weighted) ${num(p.qed_weighted)}`,
  ], "; ")
  const text = join([
    `ChEMBL compound record ${id}${name ? `: ${name}` : ""}.`,
    say("Molecule type", clean(molecule.molecule_type)),
    say("Max phase", phase && labelled(phase, PHASE, String(Number(phase)))),
    say("First approval", num(molecule.first_approval)),
    num(molecule.black_box_warning) === "1" && "ChEMBL flags a black box warning.",
    molecule.withdrawn_flag === true && "ChEMBL marks this drug as withdrawn.",
    say("Mechanism of action", mechanismText),
    say("Calculated properties (ChEMBL)", properties),
    say("SMILES", clean(rec(molecule.molecule_structures).canonical_smiles, 300)),
  ])
  return record(`${PAGE}/compound/${id}`, `${name || id} (${id}): ChEMBL compound record`, text)
}

/** The target's own record, for a lookup by target. `total` is how many activity records with a pChEMBL value ChEMBL holds for it. */
export function targetItem(target: Json, total: string): EvidenceItem | undefined {
  const id = chemblId(target.target_chembl_id)
  if (!id) return undefined
  const name = clean(target.pref_name)
  const text = join([
    `ChEMBL target record ${id}${name ? `: ${name}` : ""}.`, say("Target type", clean(target.target_type)), say("Organism", clean(target.organism)),
    total && `ChEMBL holds ${total} activity records with a pChEMBL value for this target.`,
  ])
  return record(`${PAGE}/target/${id}`, `${name || id} (${id}): ChEMBL target record`, text)
}

function resultSentence(a: Json): string {
  const id = chemblId(a.molecule_chembl_id), value = num(a.standard_value)
  if (!id || !value || !clean(a.standard_type)) return ""
  const standard = join([clean(a.standard_type), clean(a.standard_relation), value, clean(a.standard_units)])
  const published = num(a.value) && clean(a.type) ? join([clean(a.type), clean(a.relation), num(a.value), clean(a.units)]) : ""
  const name = clean(a.molecule_pref_name)
  return join([
    `${name ? `${name} (${id})` : `Compound ${id}`}: ${standard}`,
    published && published !== standard && `(as published: ${published})`,
    num(a.pchembl_value) && `, pChEMBL value ${num(a.pchembl_value)}`,
    clean(a.assay_variant_mutation) && `, assay variant ${clean(a.assay_variant_mutation)}`,
    clean(a.data_validity_comment) && `; ChEMBL data validity comment: ${clean(a.data_validity_comment)}`,
    clean(a.activity_comment) && `; activity comment: ${clean(a.activity_comment, 200)}`,
    !name && clean(a.canonical_smiles) && clean(a.canonical_smiles).length <= 250 && `; SMILES ${clean(a.canonical_smiles)}`,
  ]).replace(/ ([,;])/g, "$1") + "."
}

/** Activity records as evidence items, one per assay (several compounds measured in one assay share its page). */
export const activityItems = (activities: unknown[], max = MAX_ITEMS): EvidenceItem[] => activityRecords(activities, max).items

/** The same, with `shown`: how many activity records the items hold (an item can hold several). */
export function activityRecords(activities: unknown[], max = MAX_ITEMS): { items: EvidenceItem[]; shown: number } {
  const byAssay = new Map<string, Json[]>()
  for (const a of activities.map(rec)) {
    const assay = chemblId(a.assay_chembl_id)
    if (assay && resultSentence(a)) byAssay.set(assay, [...(byAssay.get(assay) ?? []), a])
  }
  const items: EvidenceItem[] = []
  let shown = 0
  for (const [assay, rows] of byAssay) {
    if (items.length >= max) break
    const first = rows[0], type = clean(first.assay_type), target = clean(first.target_pref_name), targetId = chemblId(first.target_chembl_id)
    const names = [...new Set(rows.map((a) => clean(a.molecule_pref_name) || chemblId(a.molecule_chembl_id)))]
    const text = join([
      "ChEMBL bioactivity record.",
      ...rows.map(resultSentence),
      say("Target", join([target, join([targetId, clean(first.target_organism)], ", ") && `(${join([targetId, clean(first.target_organism)], ", ")})`])),
      say(`Assay ${assay}${type ? `, type ${labelled(type, ASSAY_TYPE)}` : ""}`, clean(first.assay_description, 700)),
      say("Document", join([chemblId(first.document_chembl_id), clean(first.document_journal), num(first.document_year)], ", ")),
    ])
    const item = record(`${PAGE}/assay/${assay}`, `ChEMBL assay ${assay}: ${join([clean(first.standard_type), names.slice(0, 3).join(", ") && `of ${names.slice(0, 3).join(", ")}${names.length > 3 ? " and others" : ""}`, target && `against ${target}`])}`, text)
    if (item) { items.push(item); shown += rows.length }
  }
  return { items, shown }
}

const rows = (body: unknown, key: string): Json[] => list(rec(body)[key]).map(rec)
const total = (body: unknown): string => num(rec(rec(body).page_meta).total_count)

async function findMolecule(http: Http, name: string, notices: string[]): Promise<Json | undefined> {
  const asId = name.toUpperCase()
  const tries: ["id" | "synonym" | "name", string][] = CHEMBL_ID.test(asId) ? [["id", asId]] : [["synonym", name], ["name", name]]
  for (const [by, value] of tries) {
    const found = rows((await http.json("chembl", moleculeUrl(value, by))).body, "molecules").filter((m) => chemblId(m.molecule_chembl_id))
    if (!found.length) continue
    const pick = found.find((m) => clean(m.pref_name).toLowerCase() === name.toLowerCase()) ?? found[0]
    const others = found.filter((m) => m !== pick).map((m) => `${clean(m.pref_name) || "unnamed"} (${chemblId(m.molecule_chembl_id)})`)
    if (others.length) notices.push(`ChEMBL has ${found.length} compounds with the name "${name}". This lookup used ${clean(pick.pref_name) || "the first"} (${chemblId(pick.molecule_chembl_id)}); the others: ${others.join(", ")}. Ask again with a ChEMBL id to choose another.`)
    const parent = chemblId(rec(pick.molecule_hierarchy).parent_chembl_id)
    if (parent && parent !== chemblId(pick.molecule_chembl_id)) notices.push(`${chemblId(pick.molecule_chembl_id)} is a salt or another form of ${parent}. Most measurements are recorded for the parent: ask again with ${parent}.`)
    return pick
  }
  return undefined
}

async function findTarget(http: Http, name: string, notices: string[]): Promise<Json | undefined> {
  const asId = name.toUpperCase()
  const tries: ["id" | "synonym" | "name", string][] = CHEMBL_ID.test(asId) ? [["id", asId]] : [["synonym", name], ["name", name]]
  for (const [by, value] of tries) {
    const found = rows((await http.json("chembl", targetUrl(value, by))).body, "targets").filter((t) => chemblId(t.target_chembl_id))
    if (!found.length) continue
    const single = found.filter((t) => clean(t.target_type) === "SINGLE PROTEIN")
    const pick = single.find((t) => clean(t.organism) === "Homo sapiens") ?? single[0] ?? found[0]
    const others = found.filter((t) => t !== pick).slice(0, 5).map((t) => `${clean(t.pref_name) || "unnamed"} (${chemblId(t.target_chembl_id)}, ${join([clean(t.target_type), clean(t.organism)], ", ")})`)
    if (others.length) notices.push(`ChEMBL has ${found.length} targets for "${name}". This lookup used ${clean(pick.pref_name)} (${chemblId(pick.target_chembl_id)}, ${join([clean(pick.target_type), clean(pick.organism)], ", ")}); others: ${others.join("; ")}. Ask again with "target: <ChEMBL id>" to choose another.`)
    return pick
  }
  return undefined
}

/** One ChEMBL lookup: at most 4 requests (compound, target, mechanism, activity). */
export async function chemblSearch(query: string, http: Http): Promise<SourceResult> {
  const { compound, target } = parseChemblQuery(query)
  const notices: string[] = []
  if (!compound && !target) return { items: [], notices: ['Write a compound name or ChEMBL id, or "target: <gene symbol>", or both.'] }
  const molecule = compound ? await findMolecule(http, compound, notices) : undefined
  if (compound && !molecule) return { items: [], notices: [...notices, `ChEMBL has no compound named "${compound}" (names and synonyms are matched whole, not by part). Try another name, a ChEMBL id, or "target: <gene symbol>".`] }
  const targetRow = target ? await findTarget(http, target, notices) : undefined
  if (target && !targetRow) return { items: [], notices: [...notices, `ChEMBL has no target with the gene symbol, synonym or name "${target}". Try the official gene symbol or a ChEMBL target id.`] }
  const moleculeId = chemblId(molecule?.molecule_chembl_id), targetId = chemblId(targetRow?.target_chembl_id)
  // With both a compound and a target the lookup spends its requests on the two records and the measurements; the mechanism is asked for a compound alone.
  const mechanisms = molecule && !targetRow ? rows((await http.json("chembl", mechanismUrl(moleculeId))).body, "mechanisms") : []
  const activity = (await http.json("chembl", activityUrl(moleculeId, targetId))).body
  const count = total(activity)
  const head = molecule ? compoundItem(molecule, mechanisms) : targetRow ? targetItem(targetRow, count) : undefined
  const { items: measured, shown } = activityRecords(rows(activity, "activities"), MAX_ITEMS - (head ? 1 : 0))
  const scope = join([molecule && (clean(molecule.pref_name) || moleculeId), targetRow && `${molecule ? "against " : ""}${clean(targetRow.pref_name) || targetId}`])
  if (measured.length) notices.push(`ChEMBL holds ${count || "several"} activity records with a pChEMBL value for ${scope}. Given here: the ${shown} with the highest pChEMBL value (the most potent), grouped by assay. They are not a summary of every measurement, and one value is one experiment.`)
  else notices.push(`ChEMBL has no activity record with a pChEMBL value for ${scope}.`)
  return { items: [...(head ? [head] : []), ...measured], notices }
}
