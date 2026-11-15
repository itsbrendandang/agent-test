// The example questions on the home page. A click puts one in the box; nothing is sent.
/** The first example everywhere: the cancer drug the Graph view's built-in example maps (graph/examples/pembrolizumab.ts). */
export const CANCER_DRUG = { topic: "Cancer drug, start to finish", question: "Pembrolizumab: FDA path, interactions, retractions, trials?" }
export const STARTERS: { topic: string; question: string }[] = [
  CANCER_DRUG,
  { topic: "Market", question: "What GLP-1s are working in the market right now?" },
  { topic: "Clinical evidence", question: "Do KRAS G12C inhibitors work in previously treated lung cancer?" },
  { topic: "Safety", question: "Is hERG a known risk for kinase inhibitors?" },
]
