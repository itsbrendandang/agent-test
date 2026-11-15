"""The polite HTTP client: robots.txt rules, the cache, offline mode, text helpers."""

import json

import pytest

import common
from conftest import FIXTURES

OUR_NAME = common.UA_NAME


def robots(host):
    return common.Robots((FIXTURES / "robots" / f"{host}.txt").read_text(encoding="utf-8"))


def test_zenodo_api_is_disallowed_but_records_are_not():
    rules = robots("zenodo.org")
    assert not rules.allowed(OUR_NAME, "https://zenodo.org/api/records?q=chembl")
    assert rules.allowed(OUR_NAME, "https://zenodo.org/records/7711952")
    assert rules.allowed(OUR_NAME, "https://zenodo.org/api/records/7711952/files")  # the longer Allow rule wins
    assert not rules.allowed(OUR_NAME, "https://zenodo.org/records/7711952/preview/x.csv")  # wildcard rule
    assert rules.crawl_delay(OUR_NAME) == 10


def test_api_paths_that_robots_disallows():
    assert not robots("clinicaltrials.gov").allowed(OUR_NAME, "https://clinicaltrials.gov/api/v2/studies")
    assert robots("clinicaltrials.gov").allowed(OUR_NAME, "https://clinicaltrials.gov/api/int/studies")
    assert robots("clinicaltrials.gov").allowed(OUR_NAME, "https://clinicaltrials.gov/about-site/terms-conditions")
    assert not robots("gtexportal.org").allowed(OUR_NAME, "https://gtexportal.org/api/v2/dataset/tissueSiteDetail")
    assert robots("gtexportal.org").allowed("googlebot", "https://gtexportal.org/home/")  # a named group


def test_crawl_delay_is_read_and_never_shortened():
    assert robots("depmap.org").crawl_delay(OUR_NAME) == 500
    assert common.MAX_CRAWL_DELAY >= 500


def test_ai_agent_groups_are_obeyed(monkeypatch):
    rules = robots("www.openml.org")
    url = "https://www.openml.org/api/v1/json/data/list"
    assert rules.allowed(OUR_NAME, url)  # the "*" group allows it
    assert not rules.allowed("claudebot", url) and not rules.allowed("anthropic-ai", url)
    common._ROBOTS["https://www.openml.org"] = rules
    monkeypatch.delenv("DATASET_SCOUT_OPERATOR", raising=False)
    assert common.operator_is_ai() and not common.robots_allows(url)
    monkeypatch.setenv("DATASET_SCOUT_OPERATOR", "human")
    assert common.robots_allows(url)
    monkeypatch.setenv("DATASET_SCOUT_OPERATOR", "robot")  # only the exact word counts
    assert not common.robots_allows(url)


def test_robots_matching_rules():
    rules = common.Robots(
        "User-agent: *\nDisallow: /private\nAllow: /private/open\nDisallow: /*.zip$\nDisallow:\n\n"
        "User-agent: drug-board-dataset-scout\nDisallow: /only-us\n"
    )
    assert not rules.allowed("otherbot", "https://x/private/a") and rules.allowed("otherbot", "https://x/private/open/a")
    assert not rules.allowed("otherbot", "https://x/files/a.zip") and rules.allowed("otherbot", "https://x/files/a.zip.txt")
    # a group for our own name replaces the "*" group
    assert rules.allowed(OUR_NAME, "https://x/private/a") and not rules.allowed(OUR_NAME, "https://x/only-us/a")
    assert rules.allowed(OUR_NAME, "https://x/robots.txt")
    assert common.Robots("").allowed(OUR_NAME, "https://x/anything")


def test_no_host_is_exempt_from_robots():
    assert common.ROBOTS_EXEMPT_API_HOSTS == {}


def test_offline_mode_refuses_what_is_not_cached():
    with pytest.raises(common.HttpError) as error:
        common.fetch("https://example.org/not-cached", check_robots=False)
    assert "offline" in str(error.value)
    with pytest.raises(ValueError):
        common.fetch("file:///etc/hosts")


def test_cache_is_used_before_the_network(tmp_path):
    url = "https://example.org/cached.json"
    meta, body = common._cache_paths("GET", url, None)
    body.write_bytes(b'{"ok": true}')
    meta.write_text(json.dumps({"url": url, "method": "GET", "status": 200, "headers": {}, "fetched_at": "2026-01-31T12:00:00Z"}))
    data, got = common.get_json(url, check_robots=False)
    assert data == {"ok": True} and got.from_cache and got.fetched_at == "2026-01-31T12:00:00Z"
    # a cached error status is an error again, with no request
    url_404 = "https://example.org/gone"
    meta, body = common._cache_paths("GET", url_404, None)
    body.write_bytes(b"")
    meta.write_text(json.dumps({"url": url_404, "method": "GET", "status": 404, "headers": {}, "fetched_at": "2026-01-31T12:00:00Z"}))
    with pytest.raises(common.HttpError) as error:
        common.fetch(url_404, check_robots=False)
    assert error.value.status == 404
    assert common.fetch(url_404, check_robots=False, ok_statuses=(200, 404)).status == 404
    assert common.request_count() == 0  # nothing reached the network in this test session


def test_user_agent_names_the_tool_and_carries_no_secret():
    assert common.UA.startswith(common.UA_NAME + "/") and "http" in common.UA
    send = {"User-Agent": common.UA}
    assert "authorization" not in {k.lower() for k in send}


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("<p>Hello <b>world</b></p>", "Hello world"),
        ("A [link](https://x.org) and ![img](y.png) here", "A link and here"),
        ("line one\n\n\tline two", "line one line two"),
        ("# Title\n**bold** `code`", "Title bold code"),
        (None, ""),
    ],
)
def test_clean_text(raw, expected):
    assert common.clean_text(raw) == expected


def test_clean_text_cuts_at_a_word():
    text = common.clean_text("word " * 200, 50)
    assert len(text) <= 50 and text.endswith("…") and not text[:-1].endswith(" ")


def test_human_size():
    assert common.human_size(999) == "999 B" and common.human_size(1500) == "1.5 KB"
    assert common.human_size(337644770670) == "338 GB" and common.human_size(0) is None and common.human_size("x") is None


def test_write_records_is_sorted_with_a_drop_report():
    path = common.write_records("unit", [{"id": "b:2"}, {"id": "a:1"}], drops={"benchmark": 1})
    assert [r["id"] for r in common.read_jsonl(path)] == ["a:1", "b:2"]
    assert json.loads((path.parent / "unit.drops.json").read_text()) == {"benchmark": 1}
