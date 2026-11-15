"""Each fetcher's parsing, on recorded replies (tests/fixtures). No network."""

import json

import pytest

import fetch_aws_open_data as aws
import fetch_bioregistry as bioregistry
import fetch_datacite as datacite
import fetch_gdc as gdc
import fetch_huggingface as hf
import fetch_kaggle as kaggle
import fetch_obofoundry as obo
import fetch_openfda as openfda
import fetch_openml as openml
import fetch_registry as registry
import fetch_tdc as tdc
import schema
from conftest import FIXTURES, load

STAMP = "2026-01-31T12:00:00Z"


def all_valid(records):
    for record in records:
        assert schema.validate(record) == [], (record["id"], schema.validate(record))
    assert [r["id"] for r in records] == sorted(r["id"] for r in records)


# ----------------------------------------------------------------------------- Hugging Face


def hf_items():
    return [(item, STAMP, "GET fixture") for item in load("huggingface_items.json")["items"]]


def test_huggingface_keeps_ungated_relevant_datasets_only():
    records = hf.select(hf_items())
    all_valid(records)
    ids = {r["id"] for r in records}
    assert "hf:tahoebio/Tahoe-100M" in ids and "hf:zjunlp/Mol-Instructions" in ids
    assert "hf:AI4Math/MathVista" not in ids  # a general benchmark that only carries a chemistry tag
    gated = [i["id"] for i in load("huggingface_items.json")["items"] if i["gated"] is not False]
    assert gated and not ids & {"hf:" + g for g in gated}


def test_huggingface_fields_come_from_the_api_reply():
    record = next(r for r in hf.select(hf_items()) if r["id"] == "hf:tahoebio/Tahoe-100M")
    assert record["licence"] == "CC0-1.0" and record["commercial_use"] == "yes"
    assert record["url"] == "https://huggingface.co/datasets/tahoebio/Tahoe-100M"
    assert record["landing_api"] == "https://huggingface.co/api/datasets/tahoebio/Tahoe-100M"
    assert record["access"] == "open" and record["size"].endswith("rows") and "parquet" in record["format"]
    assert {"single-cell", "chemistry"} <= set(record["domains"])
    assert record["signals"]["downloads_30d"] > 0 and record["retrieved_at"] == STAMP
    assert "See the full description" not in record["description"] and len(record["description"]) <= 300


def test_huggingface_dataset_without_a_licence_needs_much_use():
    item = dict(next(i for i in load("huggingface_items.json")["items"] if i["id"] == "jglaser/binding_affinity"))
    record = hf.to_record(item, STAMP, "x")
    assert record is not None and record["licence"] == "unknown" and record["commercial_use"] == "unclear"
    item["downloads"], item["likes"] = 200, 3
    assert hf.to_record(item, STAMP, "x") is None


def test_huggingface_refuses_private_disabled_gated_and_placeholders():
    base = dict(next(i for i in load("huggingface_items.json")["items"] if i["id"] == "tahoebio/Tahoe-100M"))
    for change in ({"private": True}, {"disabled": True}, {"gated": "auto"}, {"gated": "manual"}, {"gated": None},
                   {"id": "someone/tahoe-preview"}, {"id": "someone/demo-data"}):
        assert hf.to_record(dict(base, **change), STAMP, "x") is None, change


def test_huggingface_boundary_and_mirrors_and_author_cap():
    base = dict(next(i for i in load("huggingface_items.json")["items"] if i["id"] == "tahoebio/Tahoe-100M"))
    schema.BOUNDARY_DROPS.clear()
    items = [
        (dict(base, id="lab/BixBench"), STAMP, "x"),
        (dict(base, id="lab/geo-counts", description="Counts from GSE123456 single-cell RNA molecules"), STAMP, "x"),
        (dict(base, id="lab/kegg_pathways"), STAMP, "x"),
        (dict(base, id="one/Molecule-Set", downloads=900), STAMP, "x"),
        (dict(base, id="two/molecule_set", downloads=5000), STAMP, "x"),
    ]
    records = hf.select(items)
    assert [r["id"] for r in records] == ["hf:two/molecule_set"]  # of two copies, the most downloaded
    assert schema.BOUNDARY_DROPS == {"benchmark": 1, "study accession": 1, "restricted source re-hosted on a hub": 1}
    many = [(dict(base, id=f"lab/molecules-{n:02d}", downloads=1000 + n), STAMP, "x") for n in range(40)]
    assert len(hf.select(many)) == hf.MAX_PER_AUTHOR


def test_huggingface_paging_helpers():
    assert "filter=biology" in hf.page_url("biology") and "expand%5B%5D=tags" in hf.page_url("biology")
    assert hf.next_link('<https://huggingface.co/api/datasets?cursor=abc>; rel="next"') == "https://huggingface.co/api/datasets?cursor=abc"
    assert hf.next_link(None) is None and hf.next_link('<https://x>; rel="prev"') is None


# ----------------------------------------------------------------------------- AWS registry


def aws_rows():
    return [json.loads(line) for line in (FIXTURES / "aws_index.ndjson").read_text(encoding="utf-8").splitlines() if line.strip()]


def test_aws_keeps_open_life_science_entries():
    rows = aws_rows()
    assert len(rows) == 6
    records = aws.select(rows, STAMP)
    all_valid(records)
    assert sorted(r["name"] for r in records) == ["Cell Painting Gallery", "Genome Aggregation Database (gnomAD)"]


def test_aws_licence_text_is_not_over_read():
    gnomad = next(r for r in aws.select(aws_rows(), STAMP) if "gnomAD" in r["name"])
    # the registry writes "[MIT](...); [terms of use](...)": two statements, so no single licence
    assert gnomad["licence"] != "MIT" and gnomad["commercial_use"] == "unclear"
    assert gnomad["url"].startswith("https://registry.opendata.aws/") and gnomad["access"] == "open"


def test_aws_drops_deprecated_controlled_and_off_topic_rows():
    by_reason = {
        "deprecated": lambda r: r.get("Deprecated"),
        "physiological signals": lambda r: "physionet" in r.get("ManagedBy", "").lower(),
        "controlled access only": lambda r: r.get("Resources") and all(x.get("ControlledAccess") for x in r["Resources"]),
        "earth observation": lambda r: "satellite imagery" in r.get("Tags", []),
    }
    for reason, match in by_reason.items():
        row = next(r for r in aws_rows() if match(r))
        assert aws.to_record(row, STAMP) is None, reason


# ----------------------------------------------------------------------------- Kaggle


def test_kaggle_keeps_well_used_datasets_with_a_licence():
    fixture = load("kaggle_items.json")
    records = kaggle.select([(item, STAMP, "GET fixture") for item in fixture["items"]])
    all_valid(records)
    by_name = {r["name"]: r for r in records}
    assert "AqSolDB: A curated aqueous solubility dataset" in by_name
    aqsol = by_name["AqSolDB: A curated aqueous solubility dataset"]
    assert aqsol["licence"] == "CC0-1.0" and aqsol["licence_raw"] == "CC0: Public Domain"
    assert "uploader's label" in aqsol["notes"] and aqsol["signals"]["votes"] >= kaggle.MIN_VOTES
    low = next(i for i in fixture["items"] if i["voteCount"] < kaggle.MIN_VOTES)
    assert kaggle.to_record(low, STAMP, "x") is None
    nolicence = dict(fixture["items"][0], licenseName="Unknown")
    assert kaggle.to_record(nolicence, STAMP, "x") is None


# ----------------------------------------------------------------------------- GDC


def test_gdc_lists_projects_with_open_files_only():
    fixture = load("gdc.json")
    records = [gdc.to_record(p, fixture["open_files"], "Data Release X", STAMP) for p in fixture["projects"]]
    kept = sorted((r for r in records if r), key=lambda r: r["id"])
    all_valid(kept)
    assert [r["id"] for r in kept] == ["gdc:TARGET-AML", "gdc:TCGA-BRCA"]
    brca = kept[1]
    assert brca["level"] == "collection" and brca["access"] == "open"
    assert brca["size"] == f"{fixture['open_files']['TCGA-BRCA']} open-access files"
    assert brca["commercial_use"] == "unclear" and "no licence stated" in brca["licence"]
    assert "Controlled-access" in brca["notes"] and "cancer" in brca["domains"]


def test_gdc_urls_are_well_formed():
    assert gdc.projects_url().startswith("https://api.gdc.cancer.gov/projects?") and "size=1000" in gdc.projects_url()
    assert "access" in gdc.open_files_url() and "facets=cases.project.project_id" in gdc.open_files_url()


# ----------------------------------------------------------------------------- openFDA


def test_openfda_endpoints_and_the_licence_rule():
    index = load("openfda_download.json")["index"]
    with_licence = openfda.to_records(index, "https://open.fda.gov/license/", STAMP)
    all_valid(with_licence)
    assert [r["id"] for r in with_licence] == ["openfda:drug/event", "openfda:drug/ndc"]  # device/udi is left out
    event = with_licence[0]
    assert event["licence"] == "CC0-1.0" and "records" in event["size"] and event["last_updated"]
    # when the licence page could not be read, nothing is assumed
    without = openfda.to_records(index, None, STAMP)
    assert {r["licence"] for r in without} == {"unknown"} and {r["commercial_use"] for r in without} == {"unclear"}


def test_openfda_licence_pattern():
    assert openfda.LICENCE_PATTERN.search("made available under the Creative Commons CC0 1.0 Universal dedication")
    assert not openfda.LICENCE_PATTERN.search("All rights reserved.")


# ----------------------------------------------------------------------------- OBO Foundry


def test_obofoundry_active_ontologies_with_licences():
    fixture = load("obofoundry.json")
    records = obo.select(fixture["ontologies"], STAMP)
    all_valid(records)
    assert [r["id"] for r in records] == ["obo:chebi", "obo:go", "obo:hp"]
    by_id = {r["id"]: r for r in records}
    assert by_id["obo:go"]["licence"] == "CC-BY-4.0" and by_id["obo:chebi"]["licence"] == "CC-BY-4.0"
    hp = by_id["obo:hp"]  # HPO has its own licence: the label is kept with its URL, not turned into SPDX
    assert "hpo" in hp["licence"].lower() and hp["commercial_use"] == "unclear"
    assert all("ontology" in r["domains"] for r in records)
    assert by_id["obo:go"]["landing_api"].startswith("http://purl.obolibrary.org/obo/")


# ----------------------------------------------------------------------------- Bioregistry


def test_bioregistry_keeps_licensed_databases_once():
    records = bioregistry.select(load("bioregistry.json")["registry"], STAMP)
    all_valid(records)
    ids = [r["id"] for r in records]
    assert "bioregistry:rhea" in ids and "bioregistry:efo" in ids
    assert "bioregistry:go" not in ids  # an OBO Foundry ontology: listed by the other fetcher
    assert "bioregistry:kegg.pathway" not in ids and "bioregistry:drugbank" not in ids  # no SPDX licence listed
    civic = [i for i in ids if i.startswith("bioregistry:civic")]
    assert len(civic) == 1  # two namespaces of one database give one record
    assert "identifier namespaces" in next(r for r in records if r["id"] == civic[0])["notes"]
    assert not any(i.startswith("bioregistry:worldavatar") for i in ids)  # a niche ontology


# ----------------------------------------------------------------------------- TDC


def test_tdc_sections_and_the_not_specified_rule():
    html = (FIXTURES / "tdc_adme.html").read_text(encoding="utf-8")
    records = sorted(tdc.parse_page(html, "single_pred_tasks/adme", STAMP), key=lambda r: r["id"])
    all_valid(records)
    assert [r["id"] for r in records] == ["tdc:Caco2_Wang", "tdc:Lipophilicity_AstraZeneca", "tdc:Solubility_AqSolDB"]
    caco, lipo, solubility = records
    assert caco["url"] == "https://tdcommons.ai/single_pred_tasks/adme/#caco-2-cell-effective-permeability-wang-et-al"
    assert caco["size"] == "906 drugs." and caco["domains"] == ["admet", "chemistry", "drug-discovery"]
    # TDC writes "Not Specified. CC BY 4.0." here: that is not a licence from the data owner
    assert caco["licence"].startswith("Not specified by the original source") and caco["commercial_use"] == "unclear"
    assert lipo["commercial_use"] == "unclear"
    assert solubility["licence"] == "CC-BY-4.0" and solubility["commercial_use"] == "yes"
    assert "Dataset License" in solubility["licence_source"]


def test_tdc_ignores_headings_that_are_not_datasets():
    assert tdc.parse_page('<h3 id="overview">Overview</h3><p>Text.</p>', "single_pred_tasks/adme", STAMP) == []


# ----------------------------------------------------------------------------- DataCite


def test_datacite_record_and_the_title_check():
    records = load("datacite.json")["records"]
    seed = {"doi": "10.6084/m9.figshare.5104873", "expect": "Chemical reactions from US patents"}
    record = datacite.to_record(seed, records[seed["doi"]]["data"], STAMP)
    assert schema.validate(record) == []
    assert record["id"] == "figshare:10.6084/m9.figshare.5104873" and record["source"] == "figshare"
    assert record["licence"] == "CC0-1.0" and record["citation"] == "doi:10.6084/m9.figshare.5104873"
    assert record["url"] == "https://doi.org/10.6084/m9.figshare.5104873"
    assert "reactions-synthesis" in record["domains"]
    # the same DOI under a wrong expectation is refused: a seed with a typo cannot add a wrong dataset
    assert datacite.to_record({"doi": seed["doi"], "expect": "Tabula Sapiens"}, records[seed["doi"]]["data"], STAMP) is None


def test_datacite_missing_rights_stay_unknown():
    records = load("datacite.json")["records"]
    seed = {"doi": "10.5281/zenodo.268568", "expect": "hetionet"}
    record = datacite.to_record(seed, records[seed["doi"]]["data"], STAMP)
    assert record["source"] == "zenodo" and record["licence"] == "unknown" and record["commercial_use"] == "unclear"


def test_datacite_helpers():
    assert datacite.source_of("10.5281/zenodo.1", "cern.zenodo") == "zenodo"
    assert datacite.source_of("10.7910/dvn/abc", "gdcc.harvard-dv") == "dataverse"
    assert datacite.source_of("10.9999/x", "someone.else") == "datacite"
    assert datacite.size_of({"sizes": ["1500000 Bytes"]}) == "1.5 MB" and datacite.size_of({"sizes": []}) is None
    seeds = json.loads(datacite.SEEDS.read_text(encoding="utf-8"))
    assert len({s["doi"] for s in seeds}) == len(seeds) and all(s["doi"] == s["doi"].lower() and s["expect"] for s in seeds)


# ----------------------------------------------------------------------------- OpenML (hand-made fixture)


def test_openml_record_from_documented_shapes():
    item = {"did": 4134, "name": "Bioresponse", "status": "active", "format": "ARFF",
            "quality": [{"name": "NumberOfInstances", "value": "3751.0"}, {"name": "NumberOfFeatures", "value": "1777.0"}]}
    detail = {"id": "4134", "name": "Bioresponse", "licence": "Public", "format": "ARFF", "upload_date": "2014-10-04T00:21:26",
              "description": "Predict a biological response of molecules from their chemical properties.", "tag": ["chemistry", "study_14"]}
    record = openml.to_record(item, detail, STAMP)
    assert schema.validate(record) == []
    assert record["id"] == "openml:4134" and record["size"] == "3,751 rows x 1,777 columns"
    assert record["licence"] == "Public (OpenML label)" and record["commercial_use"] == "unclear"
    assert openml.to_record(dict(item, name="QSAR-TID-11"), dict(detail, name="QSAR-TID-11"), STAMP) is None
    assert openml.to_record(dict(item, status="deactivated"), detail, STAMP) is None


# ----------------------------------------------------------------------------- curated registry


def test_registry_seeds_are_well_formed():
    seeds = json.loads(registry.SEEDS.read_text(encoding="utf-8"))
    ids = [s["id"] for s in seeds]
    assert len(ids) == len(set(ids)) and len(ids) >= 90
    for seed in seeds:
        assert seed["url"].startswith(("http://", "https://")), seed["id"]
        assert seed["domains"] == sorted(set(seed["domains"])) and set(seed["domains"]) <= set(schema.DOMAINS), seed["id"]
        assert 40 <= len(seed["description"]) <= schema.MAX_DESCRIPTION, seed["id"]
        assert seed.get("access", "open") in schema.ACCESS and seed.get("level", "repository") in schema.LEVELS
        licence = seed["licence"]
        if licence.get("kind") == "varies":
            assert licence["claim"].startswith("Varies"), seed["id"]
        for claim in licence.get("claims") or ([licence] if licence.get("claim") and licence.get("kind") != "varies" else []):
            # a claim is only ever accepted through a pattern on an evidence page
            assert claim.get("pattern") or claim.get("patterns"), seed["id"]
            assert licence.get("evidence"), seed["id"]


def test_registry_never_writes_a_licence_without_evidence(monkeypatch):
    seed = {
        "id": "example", "name": "Example DB", "url": "https://example.org/", "domains": ["chemistry"],
        "modality": "tabular", "description": "An example database used to test the evidence rule of the registry.",
        "format": "CSV", "licence": {"claim": "CC-BY-4.0", "evidence": ["https://example.org/licence"], "pattern": r"Creative Commons Attribution 4\.0"},
        "citation": {"doi": "10.1234/example", "title_has": "Example"},
    }
    pages = {"https://example.org/licence": "Data are under the Creative Commons Attribution 4.0 International licence."}
    monkeypatch.setattr(registry, "check_url", lambda url: ("ok", STAMP))
    monkeypatch.setattr(registry, "page_text", lambda url: (pages.get(url), "" if url in pages else "HTTP 404", STAMP))
    monkeypatch.setattr(registry, "resolve_citation", lambda s: ("doi:10.1234/example", "ok"))
    record, report = registry.to_record(seed, STAMP)
    assert schema.validate(record) == [] and report["licence_ok"]
    assert (record["licence"], record["commercial_use"]) == ("CC-BY-4.0", "yes")
    assert "matches" in record["licence_source"] and record["citation"] == "doi:10.1234/example"

    pages["https://example.org/licence"] = "Data may be used for academic research only."  # the page changed
    record, report = registry.to_record(seed, STAMP)
    assert not report["licence_ok"]
    assert (record["licence"], record["commercial_use"]) == ("unknown", "unclear")
    assert "Licence not re-read" in record["notes"] and "CC-BY-4.0" in record["notes"]

    monkeypatch.setattr(registry, "page_text", lambda url: (None, "robots.txt disallows it", None))
    monkeypatch.setattr(registry, "bioregistry_licence", lambda prefix: ("CC0-1.0", "https://example.org/"))
    seed["licence"]["bioregistry"] = "example.db"
    record, report = registry.to_record(seed, STAMP)
    assert record["licence"] == "CC0-1.0" and "Bioregistry entry 'example.db'" in record["licence_source"]
    assert record["same_as"] == ["bioregistry:example"]


def test_registry_offline_gives_unknown_licence_not_a_guess():
    # With no network and an empty cache nothing can be confirmed: the URL is unchecked, the
    # licence is unknown and the DOI is dropped.
    seed = next(s for s in json.loads(registry.SEEDS.read_text(encoding="utf-8")) if s["id"] == "chembl")
    seed = dict(seed, licence=dict(seed["licence"]))
    seed["licence"].pop("bioregistry", None)
    record, report = registry.to_record(seed, STAMP)
    assert record["licence"] == "unknown" and record["citation"] is None and report["url"].startswith("failed")
