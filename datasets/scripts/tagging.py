"""Domain tags and modality from a dataset's own words (name, tags, description).

Used for records that come from general hubs, where nobody assigned our domains by hand.
The rules are plain keyword rules, in priority order. They are deterministic.
"""

from __future__ import annotations

import re
from typing import Iterable, List, Optional, Sequence, Tuple

_RULES: List[Tuple[str, str]] = [
    ("drug-discovery", r"drug[\s-]?discovery|drug[\s-]design|virtual[\s-]screening|\bdocking\b|lead[\s-]optimi[sz]ation"
                       r"|drug[\s-]target|\bdti\b|binding[\s-]affinit|drug[\s-]repurpos|medicinal[\s-]chem|pharmacolog"
                       r"|therapeutic|drug[\s-]like|\bdrugs?\b|ligand|antibiotic|small[\s-]molecule"),
    ("admet", r"\badmet?\b|pharmacokinetic|solubilit|permeab|lipophilic|\blogp\b|\blogd\b|clearance|bioavailab"
              r"|blood[\s-]brain|\bbbbp?\b|\bherg\b|cyp[\s-]?450|\bcyp\d|metabolic[\s-]stability|plasma[\s-]protein|half[\s-]life"),
    ("toxicology", r"toxic|\btox21\b|toxcast|carcinogen|mutagen|\bames\b|hepatotox|cardiotox|\bld50\b|clintox|\bdili\b"),
    ("pharmacovigilance", r"adverse[\s-](drug[\s-])?(event|reaction|effect)|side[\s-]effect|\bfaers\b|pharmacovigilance|\bsider\b|drug[\s-]safety"),
    ("clinical-trials", r"clinical[\s-]trial|clinicaltrials|randomi[sz]ed[\s-]controlled"),
    ("bioactivity", r"bioactivit|binding[\s-]affinit|\bic50\b|\bec50\b|\bpic50\b|\bchembl\b|bindingdb|bioassay|\bassays?\b|\bhts\b|high[\s-]throughput[\s-]screen|\bqsar\b|kinase"),
    ("structural-biology", r"protein[\s-]structure|\bpdb\b|alphafold|crystal[\s-]structure|cryo-?em|3d[\s-]structure|protein[\s-]ligand"
                           r"|structure[\s-]prediction|\bfolding\b|conformation|protein[\s-]design|binding[\s-]site|\bpockets?\b|protein[\s-]complex"),
    ("quantum-chemistry", r"quantum[\s-](chem|mechani)|\bdft\b|density[\s-]functional|\bqm[789]\b|ab[\s-]initio|force[\s-]field"
                          r"|potential[\s-]energy|molecular[\s-]dynamics|\bmd17\b|\bani-?1|conformer|interatomic|machine[\s-]learn\w*[\s-]potential"),
    ("reactions-synthesis", r"chemical[\s-]reactions?|organic[\s-]reactions?|reaction[\s-](prediction|yield|condition|cent(er|re)|class|smiles|data|outcome|mechanism)"
                            r"|retrosynth|\buspto\b|organic[\s-]synthesis|chemical[\s-]synthesis|synthes[ie]s[\s-](route|planning|procedure)|synthetic[\s-](route|accessib)|\breactants?\b"),
    ("chemistry", r"chemi|molecul|\bsmiles\b|\bselfies\b|compound|polymer|solvent|cheminformatic|\binchi\b"),
    ("materials", r"materials[\s-]science|\bcrystals?\b|\bcatalyst|\balloy|perovskite|\bmofs?\b|batter(y|ies)|zeolite|inorganic"),
    ("single-cell", r"single[\s-]cell|\bscrna|sc-rna|snrna|cell[\s-]atlas|cellxgene|anndata|\bh5ad\b|perturb-seq|\bscatac"),
    ("transcriptomics", r"transcriptom|rna-?seq|gene[\s-]expression|\bmrna\b|microarray|expression[\s-]profil|spatial[\s-]transcript"),
    ("epigenomics", r"epigenom|methylation|chromatin|atac-?seq|chip-?seq|histone|\bhi-c\b|enhancer|promoter"),
    ("variation", r"\bvariants?\b|\bmutations?\b|\bsnps?\b|\bgwas\b|polymorphism|clinvar|gnomad|pathogenic|variant[\s-]effect"),
    ("genomics", r"genom|\bdna\b|nucleotide|chromosom|\bgenes?\b|crispr|sequenc(e|ing)[\s-]reads|\bfasta\b|\bfastq\b|\brna\b"),
    ("proteomics", r"proteomic|mass[\s-]spectrometry|\bms/ms\b|phosphoproteom|peptide[\s-]identification"),
    ("metabolomics", r"metabolom|metabolite|lipidom|mass[\s-]spectr(a|um)|\bnmr\b"),
    ("protein", r"protein|peptide|antibod|enzyme|amino[\s-]acid|uniprot|nanobod|\besm\b"),
    ("perturbation", r"perturb|knock[\s-]?out|knock[\s-]?down|crispr[\s-]screen|drug[\s-]response|dose[\s-]response|\bl1000\b|\blincs\b"
                     r"|cell[\s-]viability|drug[\s-]sensitivity|cell[\s-]line"),
    ("cancer", r"cancer|tumou?r|oncolog|\btcga\b|carcinoma|leuk[ae]mi|melanoma|glioma|lymphoma"),
    ("immunology", r"immun|antibod|t[\s-]cell|\btcr\b|b[\s-]cell|epitope|\bmhc\b|\bhla\b|vaccin"),
    ("microbiome", r"microbiom|metagenom|\b16s\b|microbial|bacteri|\bvirus|\bviral\b|pathogen|antimicrobial|\bamr\b|phage"),
    ("pathways-networks", r"pathway|interaction[\s-]network|protein[\s-]protein[\s-]interaction|\bppi\b|knowledge[\s-]graph|regulatory[\s-]network|interactome"),
    ("imaging", r"microscop|histopatholog|histolog|cell[\s-]painting|\bimages?\b|\bimaging\b|\bmri\b|x-ray|radiolog|whole[\s-]slide|segmentation|\bct[\s-]scan"),
    ("text-literature", r"pubmed|literature|abstracts|named[\s-]entity|\bner\b|relation[\s-]extraction|question[\s-]answering|text[\s-]mining"
                        r"|\bcorpus\b|\bcorpora\b|instruction|\bqa\b|\bllms?\b|language[\s-]model|\bcaption|multiple[\s-]choice|\breasoning\b"
                        r"|educational?|textbook|\bexams?\b|\bquiz|olympiad|tutoring|\bmcqs?\b|\bprompts?\b|chat"),
    ("ontology", r"ontolog|controlled[\s-]vocabular|\btaxonomy\b"),
    ("multi-omics", r"multi-?omic"),
    ("clinical", r"clinical|patient|\behr\b|electronic[\s-]health|hospital|diagnos|\bicu\b|medical[\s-]record"),
    ("model-organism", r"\bmouse\b|\bmice\b|zebrafish|drosophila|c\.[\s]?elegans|\byeast\b|arabidopsis|\bmurine\b"),
    ("plant-agri", r"\bplants?\b|\bcrops?\b|agricultur|\brice\b|\bmaize\b|\bwheat\b"),
    ("medical", r"medical|medicine|health|disease|biomedical"),
]
_COMPILED = [(domain, re.compile(pattern, re.I)) for domain, pattern in _RULES]

# Domains that show the record is about biology or chemistry data, not only "medical" or "text".
CORE = {
    "drug-discovery", "admet", "toxicology", "pharmacovigilance", "clinical-trials", "bioactivity",
    "structural-biology", "quantum-chemistry", "reactions-synthesis", "chemistry", "single-cell",
    "transcriptomics", "epigenomics", "variation", "genomics", "proteomics", "metabolomics", "protein",
    "perturbation", "cancer", "immunology", "microbiome", "pathways-networks", "multi-omics",
}

MAX_DOMAINS = 5


def domains_for(texts: Iterable[Optional[str]], fallback: Sequence[str] = ("general-biology",)) -> List[str]:
    """Up to MAX_DOMAINS domain tags, in rule priority, from the given texts."""
    blob = " \n ".join(t for t in texts if t)
    found: List[str] = []
    for domain, pattern in _COMPILED:
        if pattern.search(blob):
            found.append(domain)
            if len(found) >= MAX_DOMAINS:
                break
    if not found:
        found = list(fallback)
    return sorted(set(found))


def core_hits(texts: Iterable[Optional[str]]) -> int:
    """How many core biology or chemistry domains the texts match."""
    blob = " \n ".join(t for t in texts if t)
    return sum(1 for domain, pattern in _COMPILED if domain in CORE and pattern.search(blob))


_MODALITY: List[Tuple[str, str]] = [
    ("3D structure", r"\bpdb\b|\bmmcif\b|3d[\s-]structure|protein[\s-]structure|\bconformer|coordinates|\bxyz\b|\bsdf\b|crystal[\s-]structure"),
    ("molecule (SMILES or graph)", r"\bsmiles\b|\bselfies\b|\binchi\b|molecular[\s-]graph|\bmolecules?\b|compounds?"),
    ("sequence", r"\bfasta\b|\bfastq\b|protein[\s-]sequence|amino[\s-]acid[\s-]sequence|\bdna[\s-]sequence|nucleotide[\s-]sequence|\bsequences?\b"),
    ("expression matrix", r"\bh5ad\b|anndata|count[\s-]matri|expression[\s-]matri|gene[\s-]expression|single[\s-]cell|rna-?seq"),
    ("spectra", r"mass[\s-]spectr|\bms/ms\b|\bnmr\b|spectra\b|spectrum"),
    ("image", r"\bimages?\b|microscop|histopatholog|\bimaging\b|whole[\s-]slide"),
    ("graph", r"knowledge[\s-]graph|interaction[\s-]network|\bgraph\b"),
    ("text", r"\btext\b|question[\s-]answering|\bcorpus\b|abstracts|instruction|\bqa\b"),
    ("tabular", r"\btabular\b|\bcsv\b|\btsv\b|\bparquet\b|\btable\b|spreadsheet"),
]
_MODALITY_COMPILED = [(name, re.compile(pattern, re.I)) for name, pattern in _MODALITY]


def modality_for(texts: Iterable[Optional[str]], stated: Sequence[str] = ()) -> str:
    """A short modality label. `stated` holds modalities the source itself names (they win)."""
    if stated:
        return ", ".join(sorted(set(stated)))
    blob = " \n ".join(t for t in texts if t)
    found = [name for name, pattern in _MODALITY_COMPILED if pattern.search(blob)]
    return ", ".join(found[:3]) if found else "unspecified"
