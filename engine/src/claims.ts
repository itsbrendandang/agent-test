// Members end each reply with a CLAIMS section (format in agents.ts). Parsing it is plain code: no
// extra model call to extract claims.
export interface Claim { kind: "literature" | "computed" | "brief"; text: string; source: string }

export function parseClaims(reply: string): Claim[] {
  const section = reply.split(/^#*\s*CLAIMS\s*:?\s*$/im)[1] ?? ""
  return section.split("\n").flatMap((line) => {
    const m = /^\s*-\s*\[(literature|computed|brief)\]\s*(.+?)\s*\(source:\s*(.+?)\)\s*$/i.exec(line)
    return m ? [{ kind: m[1].toLowerCase() as Claim["kind"], text: m[2], source: m[3] }] : []
  })
}

export const stripClaims = (reply: string) => reply.split(/^#*\s*CLAIMS\s*:?\s*$/im)[0].trim()
