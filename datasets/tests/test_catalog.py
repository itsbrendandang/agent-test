"""The catalogue that is in the repository: valid, deduplicated, inside the boundary, small."""

import re
from pathlib import Path

import build_catalog as build
import licences
import schema
from conftest import CATALOG

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent


def test_catalogue_is_large_and_every_record_is_valid(catalog):
    assert len(catalog) >= 1000
    assert build.check_records(catalog) == []


def test_catalogue_file_is_what_the_build_writes(catalog):
    assert CATALOG.read_text(encoding="utf-8") == build.dump(catalog)  # sorted keys, one record per line
    assert CATALOG.stat().st_size < build.MAX_BYTES < 5 * 1024 * 1024


def test_no_gated_entry_and_no_missing_provenance(catalog):
    assert {r["access"] for r in catalog} <= {"open", "registration"}
    for record in catalog:
        assert record["how_retrieved"] and record["retrieved_at"] and record["fetcher"]
        assert (ROOT / "scripts" / record["fetcher"]).exists(), record["fetcher"]


def test_benchmark_boundary_holds_for_the_whole_file(catalog):
    text = CATALOG.read_text(encoding="utf-8")
    assert not schema.BENCHMARK.search(text)
    assert not [r["id"] for r in catalog if schema.BENCHMARK_MAKERS.match(r["id"])]
    for record in catalog:
        fields = [record.get(k) for k in ("id", "name", "url", "landing_api", "description", "citation", "notes")]
        assert schema.study_accessions(*fields) == [], record["id"]


def test_licence_fields_are_consistent(catalog):
    for record in catalog:
        assert licences.check_consistent(record["licence"], record["commercial_use"], record["share_alike"]) is None, record["id"]
        if record["licence"] == "unknown":
            assert record["commercial_use"] == "unclear" and record["share_alike"] is False, record["id"]
        if record["commercial_use"] == "yes" and all(p.lower() in licences.SPDX for p in record["licence"].split(" AND ")):
            assert "-NC" not in record["licence"], record["id"]


def test_curated_entries_carry_their_evidence(catalog):
    curated = [r for r in catalog if r["fetcher"] == "fetch_registry.py"]
    assert len(curated) >= 90
    for record in curated:
        if record["licence"] != "unknown":
            assert record.get("licence_source"), record["id"]
        else:
            assert "Licence not re-read" in record.get("notes", ""), record["id"]


def test_sources_named_in_the_brief_are_present(catalog):
    ids = {r["id"] for r in catalog}
    for wanted in (
        "db:chembl", "db:pubchem-bioassay", "db:bindingdb", "db:tdc", "db:moleculenet", "db:zinc", "db:drugbank-open",
        "db:opentargets-platform", "db:pdbbind", "db:pdb", "db:alphafold-db", "db:tox21", "db:toxcast", "db:sider",
        "db:faers", "openfda:drug/event", "db:clinicaltrials-gov", "db:drugcentral", "db:gtopdb", "tdc:hERG",
        "db:geo", "db:sra", "db:ena", "db:biostudies-arrayexpress", "db:gtex", "db:gdc", "gdc:TCGA-BRCA", "db:encode",
        "db:hca", "db:cellxgene", "db:lincs", "db:recount3", "db:archs4", "db:pride", "db:massive", "db:metabolights",
        "db:hpa", "db:uniprot", "db:string", "db:reactome", "db:huggingface-hub", "db:zenodo", "db:figshare", "db:dryad",
        "db:openml", "db:kaggle-datasets",
    ):
        assert wanted in ids, wanted
    assert any(i.startswith("figshare:") and "tabula sapiens" in r["name"].lower() for i, r in ((r["id"], r) for r in catalog))
    assert any("depmap" in r["name"].lower() for r in catalog)


def test_readme_counts_match_the_catalogue(catalog):
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    begin, end = "<!-- stats:begin -->", "<!-- stats:end -->"
    assert begin in readme and end in readme
    block = readme[readme.index(begin) + len(begin): readme.index(end)].strip()
    assert block == build.stats_markdown(catalog).strip(), "run scripts/build_catalog.py to refresh the README tables"
    assert re.search(r"Total entries: \*\*%d\*\*" % len(catalog), block)


def test_top_25_in_the_readme_are_catalogue_entries(catalog):
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    section = readme[readme.index("## The 25 most useful"):]
    section = section[: section.index("\n## ", 5)]
    listed = re.findall(r"`([a-z][a-z0-9-]*:[^`\s]+)`", section)
    ids = {r["id"] for r in catalog}
    assert len(listed) >= 25
    assert [i for i in listed if i not in ids] == []


def test_no_bulk_data_and_no_secret_in_the_folder():
    allowed = {".py", ".md", ".json", ".jsonl", ".ndjson", ".txt", ".html", ".ini", ".gitignore", ""}
    for path in ROOT.rglob("*"):
        if path.is_file() and "__pycache__" not in path.parts:
            assert path.suffix in allowed, path
            assert path.stat().st_size < 5 * 1024 * 1024, path
            if path.suffix != ".jsonl":
                assert path.stat().st_size < 400_000, path
