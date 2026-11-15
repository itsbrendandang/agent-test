"""Record validation and the boundary rules."""

import pytest

import schema


def test_a_record_built_by_make_record_is_valid(good_record):
    assert schema.validate(good_record) == []
    assert good_record["licence"] == "CC-BY-4.0"
    assert good_record["commercial_use"] == "yes" and good_record["share_alike"] is False
    assert good_record["domains"] == ["admet", "chemistry"]  # sorted


@pytest.mark.parametrize("field", schema.REQUIRED)
def test_every_required_field_is_required(good_record, field):
    del good_record[field]
    assert f"missing field {field}" in schema.validate(good_record)


def test_unexpected_field_is_refused(good_record):
    good_record["answer"] = "42"
    assert "unexpected field answer" in schema.validate(good_record)


@pytest.mark.parametrize(
    "field, value, word",
    [
        ("id", "No Prefix", "id must look like"),
        ("id", "example:has space", "id must look like"),
        ("url", "ftp://example.org/x", "http(s) URL"),
        ("landing_api", "not a url", "landing_api"),
        ("domains", [], "non-empty list"),
        ("domains", ["astrology"], "unknown domain"),
        ("domains", ["chemistry", "admet"], "sorted"),
        ("access", "gated", "access must be one of"),
        ("commercial_use", "maybe", "commercial_use must be one of"),
        ("share_alike", "no", "share_alike must be true or false"),
        ("last_updated", "yesterday", "last_updated"),
        ("retrieved_at", "2026-01-31", "retrieved_at"),
        ("description", "x" * 401, "longer than"),
        ("description", "two\nlines", "line break"),
        ("description", "", "non-empty"),
        ("level", "galaxy", "level must be one of"),
        ("signals", {"downloads": "many"}, "signals"),
        ("same_as", ["not an id"], "same_as"),
    ],
)
def test_bad_values_are_refused(good_record, field, value, word):
    good_record[field] = value
    assert any(word in problem for problem in schema.validate(good_record)), schema.validate(good_record)


def test_gated_access_cannot_be_recorded(good_record):
    good_record["access"] = "gated"
    assert schema.validate(good_record)
    good_record["access"] = "registration"
    assert schema.validate(good_record) == []


def test_licence_and_flags_must_agree(good_record):
    good_record["licence"] = "CC-BY-NC-4.0"
    assert any("implies 'no'" in p for p in schema.validate(good_record))
    good_record["commercial_use"] = "no"
    assert schema.validate(good_record) == []
    good_record["licence"], good_record["commercial_use"] = "unknown", "yes"
    assert any("unknown licence" in p for p in schema.validate(good_record))


def test_make_record_never_lets_a_caller_override_an_spdx_licence():
    record = schema.make_record(
        id="example:nc", name="NC set", source="example", url="https://example.org/nc", domains=["chemistry"],
        modality="tabular", description="d", licence_raw="CC BY-NC 4.0", retrieved_at="2026-01-31T12:00:00Z",
        how_retrieved="x", fetcher="f.py", commercial_use="yes", share_alike=True,
    )
    assert (record["licence"], record["commercial_use"], record["share_alike"]) == ("CC-BY-NC-4.0", "no", False)
    assert record["licence_raw"] == "CC BY-NC 4.0"


def test_make_record_takes_stated_flags_for_a_provider_policy_only():
    record = schema.make_record(
        id="example:policy", name="Policy set", source="example", url="https://example.org/p", domains=["genomics"],
        modality="tabular", description="d", licence_raw="Provider terms: research use only", commercial_use="no",
        retrieved_at="2026-01-31T12:00:00Z", how_retrieved="x", fetcher="f.py",
    )
    assert (record["licence"], record["commercial_use"]) == ("Provider terms: research use only", "no")
    missing = schema.make_record(
        id="example:none", name="No licence", source="example", url="https://example.org/n", domains=["genomics"],
        modality="tabular", description="d", licence_raw=None, commercial_use="yes",
        retrieved_at="2026-01-31T12:00:00Z", how_retrieved="x", fetcher="f.py",
    )
    assert (missing["licence"], missing["commercial_use"]) == ("unknown", "unclear")


# ----------------------------------------------------------------------------- boundary rules


@pytest.mark.parametrize("name", ["BixBench", "bixbench-v1.5 capsules", "Bix-Bench mirror", "BixBench3 tasks"])
def test_the_benchmark_is_never_an_entry(good_record, name):
    good_record["name"] = name
    assert schema.boundary_reason(good_record).startswith("benchmark")
    assert not schema.allowed(good_record)
    assert any(p.startswith("boundary: benchmark") for p in schema.validate(good_record))


@pytest.mark.parametrize(
    "text",
    [
        "Processed counts from GSE123456", "reads from SRP098765 and SRR1234567", "BioProject PRJNA765432",
        "ArrayExpress E-MTAB-1234", "ProteomeXchange PXD012345", "MetaboLights MTBLS123", "MassIVE MSV000081234",
        "dbGaP phs001234", "EGA EGAS00001001234", "GEO sample GSM1234567", "BioStudies S-BSST123",
    ],
)
def test_a_record_with_a_study_accession_is_dropped(good_record, text):
    good_record["description"] = text
    assert schema.boundary_reason(good_record).startswith("study accession")


@pytest.mark.parametrize(
    "text",
    ["SAMD11 knock-out lines", "the ERP study of 2019", "ST segment data", "GSEA gene sets", "PDB entry 1ABC",
     "CHEMBL25 and CID 2244", "GDS 1000 Genomes", "TCGA-BRCA project"],
)
def test_ordinary_words_are_not_taken_for_accessions(good_record, text):
    good_record["description"] = text
    assert schema.boundary_reason(good_record) is None


@pytest.mark.parametrize(
    "title",
    [
        "Data from: Molecular profiling of the hypothalamic preoptic region",
        "Data for: a new method",
        "Supplementary data for the paper on kinase inhibitors",
        "Source data for Figure 3",
        "Supporting information for 'A study of X'",
        "Dataset for the manuscript on protein folding",
        "Table S3 in Phylogeny of jumping plant lice",
        "Code and data for: the analysis",
        "Additional file 4 of Indirubin, a small molecule",
        "Replication data for: the trial",
    ],
)
def test_the_data_of_one_paper_is_not_a_catalogue_entry(good_record, title):
    good_record["name"] = title
    assert schema.boundary_reason(good_record).startswith("paper supplement")


@pytest.mark.parametrize(
    "title",
    ["Tabula Sapiens Single-Cell Dataset", "Chemical reactions from US patents (1976-Sep2016)", "ToxCast Database (invitroDB)",
     "QM7-X: A comprehensive dataset of quantum-mechanical properties", "Dataset of 10,000 protein structures"],
)
def test_reference_dataset_titles_pass(good_record, title):
    good_record["name"] = title
    assert schema.boundary_reason(good_record) is None


def test_a_repository_entry_may_have_any_title(good_record):
    good_record["name"], good_record["level"] = "Data from: the archive of everything", "repository"
    assert schema.boundary_reason(good_record) is None


@pytest.mark.parametrize("title", ["KEGG pathways as CSV", "Drug Bank 5.1.10 [CSV]", "MIMIC-III demo", "UMLS concepts", "COSMIC mutations"])
def test_restricted_sources_copied_to_a_hub_are_dropped(good_record, title):
    good_record["name"], good_record["source"] = title, "kaggle"
    assert schema.boundary_reason(good_record).startswith("restricted source")
    good_record["source"] = "example"  # the same words in a curated entry are allowed
    assert schema.boundary_reason(good_record) is None


def test_allowed_counts_refusals(good_record):
    schema.BOUNDARY_DROPS.clear()
    good_record["name"] = "BixBench"
    assert not schema.allowed(good_record)
    assert schema.BOUNDARY_DROPS == {"benchmark": 1}


def test_doi_of():
    assert schema.doi_of("doi:10.5281/zenodo.123") == "10.5281/zenodo.123"
    assert schema.doi_of("https://doi.org/10.1093/NAR/gkad1004.") == "10.1093/nar/gkad1004"
    assert schema.doi_of("arXiv:2301.00001") is None and schema.doi_of(None) is None
