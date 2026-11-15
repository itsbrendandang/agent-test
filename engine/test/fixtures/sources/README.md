# Fixtures for the database clients (`engine/src/sources/`)

Real answers from the six public services, saved on 2026-11-14 with the clients' own requests, then trimmed. Each
file is a list of exchanges: `{ name, url, method, post?, status, body }`. The tests answer a client's request from
this list by exact address (and body, for Open Targets), so a request a client should not send fails the test.

| File | Lookups saved |
|---|---|
| `chembl.json` | `sotorasib`; `sotorasib target: KRAS`; `target: HERG` |
| `clinicaltrials.json` | `sotorasib KRAS G12C`; `NCT04303780`; `NCT00000000` (not held: status 400) |
| `openfda.json` | `sotorasib` (label, reaction counts, serious counts); `zzzznotadrug` (status 404) |
| `opentargets.json` | `KRAS lung`; `KCNH2` (one search request that carries each hit's target record, saved on 2026-11-15); `ENSG00000055118` (read by id) |
| `uniprot.json` | `KRAS`; `lacZ` (no human entry, then other organisms) |
| `pubchem.json` | `sotorasib`; `aspirin`; `zzzznotacompound` (status 404) |

What was trimmed, and nothing else: ChEMBL `molfile` and `standard_inchi` (replaced by a marker); openFDA label
sections the client does not read; UniProt `evidences`, `lineage`, `extraAttributes`; PubChem `Description`,
`ExtendedReference`, `URL`, `Markup`, `ANID`. Numbers are kept digit for digit. No key was sent, and none is in
these files.

Licences of the data (from the services' documentation as the author remembers it; check before publishing any of
it): ChEMBL CC BY-SA 3.0; UniProt CC BY 4.0; Open Targets Platform data CC0; ClinicalTrials.gov, openFDA and PubChem's
own computed data are US government data. The PubChem file also holds values PubChem took from other sources, each
with that source's own licence note (read from the answer itself).
