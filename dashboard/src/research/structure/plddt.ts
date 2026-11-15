// pLDDT: the model's own confidence in each residue, 0-100 (the engine sends it on that scale for both models). The bands
// and colours are the ones the AlphaFold Protein Structure Database uses, so a person who knows them reads them at once.
export interface Band { min: number; color: string; label: string; means: string }
export const BANDS: Band[] = [
  { min: 90, color: "#0053d6", label: "Very high", means: "pLDDT 90 or more" },
  { min: 70, color: "#65cbf3", label: "Confident", means: "pLDDT 70 to 90" },
  { min: 50, color: "#ffdb13", label: "Low", means: "pLDDT 50 to 70" },
  { min: -Infinity, color: "#ff7d45", label: "Very low", means: "pLDDT below 50: may be disordered" },
]
export const bandOf = (plddt: number): Band => BANDS.find((b) => plddt >= b.min) ?? BANDS[BANDS.length - 1]
export const colorOf = (plddt: number): string => bandOf(plddt).color
