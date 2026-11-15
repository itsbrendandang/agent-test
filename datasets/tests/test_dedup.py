"""Duplicate removal in build_catalog.py."""

import copy

import build_catalog as build
import schema


def rec(record_id, url, fetcher="fetch_huggingface.py", source="huggingface", citation=None, same_as=None, name=None):
    return schema.make_record(
        id=record_id, name=name or record_id, source=source, url=url, domains=["chemistry"], modality="tabular",
        description="d", licence_raw="cc0-1.0", retrieved_at="2026-01-31T12:00:00Z", how_retrieved="x",
        fetcher=fetcher, citation=citation, same_as=same_as,
    )


def ids(records):
    return [r["id"] for r in records]


def test_same_id_is_kept_once():
    kept, dropped = build.dedup([rec("hf:a/b", "https://example.org/1"), rec("hf:a/b", "https://example.org/2")])
    assert ids(kept) == ["hf:a/b"] and dropped == [("hf:a/b", "hf:a/b", "id")]


def test_same_url_in_two_spellings_is_one_record():
    a = rec("db:alpha", "https://www.example.org/data/", fetcher="fetch_registry.py", source="alpha")
    b = rec("hf:x/alpha", "http://example.org/data")
    kept, dropped = build.dedup([b, a])
    assert ids(kept) == ["db:alpha"]  # the hand-checked registry wins over a hub
    assert dropped == [("hf:x/alpha", "db:alpha", "url")]


def test_fragment_and_query_keep_entries_apart():
    a = rec("tdc:A", "https://tdcommons.ai/single_pred_tasks/adme/#a", fetcher="fetch_tdc.py", source="tdc")
    b = rec("tdc:B", "https://tdcommons.ai/single_pred_tasks/adme/#b", fetcher="fetch_tdc.py", source="tdc")
    c = rec("ex:1", "https://example.org/d?id=1")
    d = rec("ex:2", "https://example.org/d?id=2")
    kept, dropped = build.dedup([a, b, c, d])
    assert len(kept) == 4 and dropped == []


def test_two_versions_of_one_dataset_doi_are_one_record():
    a = rec("figshare:10.6084/m9.figshare.1", "https://doi.org/10.6084/m9.figshare.1", fetcher="fetch_datacite.py", source="figshare", citation="doi:10.6084/m9.figshare.1")
    b = rec("figshare:10.6084/m9.figshare.1.v5", "https://doi.org/10.6084/m9.figshare.1.v5", fetcher="fetch_datacite.py", source="figshare", citation="doi:10.6084/M9.FIGSHARE.1.v5")
    kept, dropped = build.dedup([b, a])
    assert ids(kept) == ["figshare:10.6084/m9.figshare.1"] and dropped[0][2] == "doi"


def test_a_shared_paper_doi_does_not_merge_two_databases():
    a = rec("db:pubchem", "https://example.org/pubchem", fetcher="fetch_registry.py", source="pubchem", citation="doi:10.1093/nar/x")
    b = rec("db:pubchem-bioassay", "https://example.org/bioassay", fetcher="fetch_registry.py", source="pubchem", citation="doi:10.1093/nar/x")
    kept, _ = build.dedup([a, b])
    assert len(kept) == 2


def test_same_as_removes_the_other_registry_entry_for_any_namespace_of_it():
    curated = rec("db:gtopdb", "https://www.guidetopharmacology.org/", fetcher="fetch_registry.py", source="gtopdb", same_as=["bioregistry:iuphar"])
    other = rec("bioregistry:iuphar.family", "http://www.guidetopharmacology.org/GRAC/FamilyDisplayForward", fetcher="fetch_bioregistry.py", source="bioregistry")
    unrelated = rec("bioregistry:rhea", "https://www.rhea-db.org/", fetcher="fetch_bioregistry.py", source="bioregistry")
    kept, dropped = build.dedup([other, unrelated, curated])
    assert ids(kept) == ["bioregistry:rhea", "db:gtopdb"]
    assert dropped == [("bioregistry:iuphar.family", "db:gtopdb", "same_as")]


def test_priority_order_is_the_documented_one():
    order = ["fetch_registry.py", "fetch_tdc.py", "fetch_datacite.py", "fetch_aws_open_data.py", "fetch_bioregistry.py", "fetch_huggingface.py", "fetch_kaggle.py"]
    records = [rec(f"x:{i}", "https://example.org/same", fetcher=f) for i, f in enumerate(order)]
    for start in range(len(order)):
        kept, _ = build.dedup(records[start:][::-1])
        assert kept[0]["fetcher"] == order[start]


def test_output_is_sorted_and_does_not_depend_on_input_order():
    records = [rec(f"hf:o/{name}", f"https://example.org/{name}") for name in ("zeta", "Alpha", "beta", "10", "2")]
    kept_a, _ = build.dedup(records)
    kept_b, _ = build.dedup(list(reversed(copy.deepcopy(records))))
    assert ids(kept_a) == sorted(ids(kept_a)) == ids(kept_b)
    assert build.dump(kept_a) == build.dump(kept_b)


def test_check_records_reports_duplicates_and_disorder():
    a, b = rec("hf:a/1", "https://example.org/1"), rec("hf:a/2", "https://example.org/1/")
    problems = build.check_records([a, b])
    assert any("duplicate of hf:a/1 (url)" in p for p in problems)
    assert any("not sorted" in p for p in build.check_records([rec("hf:b/1", "https://example.org/b"), rec("hf:a/1", "https://example.org/a")]))
    assert build.check_records([a]) == []


def test_a_record_with_a_key_like_string_is_refused():
    fake = "sk-" + "a1B2" * 9  # guard: not a secret
    record = rec("hf:a/keyed", "https://example.org/k")
    record["description"] = "token " + fake
    assert build.key_like(record)
    assert any("looks like an API key" in p for p in build.check_records([record]))
    assert not build.key_like(rec("hf:a/plain", "https://example.org/p"))


def test_url_key():
    assert build.url_key("https://www.Example.org/Data/") == build.url_key("http://example.org/Data")
    assert build.url_key("https://example.org/Data") != build.url_key("https://example.org/data")  # paths are case-sensitive
    assert build.url_key("https://doi.org/10.5281/ZENODO.1") == build.url_key("https://doi.org/10.5281/zenodo.1")
