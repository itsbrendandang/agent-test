// What the Research answer needs beside the shared marks ("@/lib/words": Mark, markOf, MARK_WORD, MARK_GLYPH, markCount).
export { markOf, MARK_GLYPH, MARK_WORD, markCount, type Mark } from "@/lib/words"

/** A source's own identifier, read from its address: "PMID 37952131", "DOI 10.1056/…", "NCT01234567", "ChEMBL CHEMBL25". */
export function identifierOf(url: string): string | undefined {
  let u: URL
  try { u = new URL(url) } catch { return undefined }
  const path = decodeURIComponent(u.pathname)
  const pmid = /pubmed\.ncbi\.nlm\.nih\.gov$/.test(u.hostname) ? /^\/(\d{4,9})\/?$/.exec(path) : /europepmc\.org$/.test(u.hostname) ? /\/(?:article\/)?MED\/(\d{4,9})/i.exec(path) : null
  if (pmid) return `PMID ${pmid[1]}`
  const pmc = /(PMC\d{4,9})/i.exec(path); if (pmc && /ncbi\.nlm\.nih\.gov$|europepmc\.org$/.test(u.hostname)) return pmc[1].toUpperCase()
  const ppr = /europepmc\.org$/.test(u.hostname) ? /\/(PPR\d+)/i.exec(path) : null; if (ppr) return ppr[1].toUpperCase()
  if (/(^|\.)doi\.org$/.test(u.hostname) && /^\/10\.\d{4,9}\/\S+/.test(path)) return `DOI ${path.slice(1)}`
  const nct = /(NCT\d{8})/i.exec(path); if (nct && /clinicaltrials\.gov$/.test(u.hostname)) return nct[1].toUpperCase()
  const chembl = /(CHEMBL\d+)/i.exec(path); if (chembl && /ebi\.ac\.uk$/.test(u.hostname)) return `ChEMBL ${chembl[1].toUpperCase()}`
  return undefined
}
