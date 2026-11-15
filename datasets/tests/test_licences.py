"""Licence normalisation: SPDX where the source is clear, the source's words otherwise, never a guess."""

import pytest

import licences
from licences import normalise


@pytest.mark.parametrize(
    "raw, expected, commercial, share_alike",
    [
        ("cc-by-4.0", "CC-BY-4.0", "yes", False),
        ("license:cc-by-nc-sa-4.0", "CC-BY-NC-SA-4.0", "no", True),
        ("CC0", "CC0-1.0", "yes", False),
        ("cc-zero", "CC0-1.0", "yes", False),
        ("CC0: Public Domain", "CC0-1.0", "yes", False),
        ("CC0 1.0 Universal (CC0 1.0) Public Domain Dedication", "CC0-1.0", "yes", False),
        ("mit", "MIT", "yes", False),
        ("apache-2.0", "Apache-2.0", "yes", False),
        ("gpl-3.0", "GPL-3.0", "yes", True),
        ("GPL 3.0+", "GPL-3.0-or-later", "yes", True),
        ("odbl", "ODbL-1.0", "yes", True),
        ("Open Data Commons Attribution License v1.0", "ODC-By-1.0", "yes", False),
        ("Database: Open Database, Contents: Database Contents", "ODbL-1.0", "yes", True),
        ("Creative Commons Attribution 4.0 International", "CC-BY-4.0", "yes", False),
        ("Creative Commons Attribution-ShareAlike 3.0 Unported", "CC-BY-SA-3.0", "yes", True),
        ("Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)", "CC-BY-NC-4.0", "no", False),
        ("Creative Commons Attribution Non Commercial No Derivatives 4.0 International", "CC-BY-NC-ND-4.0", "no", False),
        ("CC BY-SA 4.0", "CC-BY-SA-4.0", "yes", True),
        ("CC BY 3.0 US", "CC-BY-3.0-US", "yes", False),
        ("https://creativecommons.org/licenses/by/4.0/legalcode", "CC-BY-4.0", "yes", False),
        ("https://creativecommons.org/publicdomain/zero/1.0/", "CC0-1.0", "yes", False),
        ("https://creativecommons.org/licenses/by/3.0/igo/", "CC-BY-3.0-IGO", "yes", False),
        ("[Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0)", "Apache-2.0", "yes", False),
        ("[Creative Commons Attribution 4.0 International License](https://creativecommons.org/licenses/by/4.0/)", "CC-BY-4.0", "yes", False),
    ],
)
def test_known_licences_become_spdx(raw, expected, commercial, share_alike):
    got = normalise(raw)
    assert (got.id, got.spdx, got.commercial_use, got.share_alike) == (expected, True, commercial, share_alike)
    assert got.id.lower() in licences.SPDX


@pytest.mark.parametrize("raw", [None, "", "unknown", "notspecified", "Open Access", "N/A", [], ["Open Access", "Copyright (C) 2026 X"]])
def test_no_licence_is_unknown_and_unclear(raw):
    got = normalise(raw)
    assert got == licences.Licence("unknown", False, "unclear", False)


@pytest.mark.parametrize(
    "raw",
    [
        "Custom ZINC terms",
        "https://www.allencell.org/terms-of-use.html",
        "NIH Genomic Data Sharing Policy",
        "other",
        "openrail",
        "U.S. Government Works",
        "Public",
        "cc",
    ],
)
def test_unrecognised_terms_are_kept_as_a_name_and_never_called_commercial(raw):
    got = normalise(raw)
    assert not got.spdx
    assert got.id != "unknown"
    assert got.commercial_use == "unclear"
    assert got.share_alike is False


@pytest.mark.parametrize(
    "raw",
    [
        "Not specified by the original source; TDC distributes it under CC BY 4.0",
        "Not Specified. CC BY 4.0",
        "Varies by dataset",
        "Most data will be in an open license such as CC BY 4.0",
        "CC BY 4.0 except images, which are CC BY-NC",
        "Multiple - please see data origins",
    ],
)
def test_a_hedged_sentence_is_not_read_as_a_licence(raw):
    got = normalise(raw)
    assert not got.spdx and got.commercial_use == "unclear"


@pytest.mark.parametrize(
    "raw",
    [
        "CC BY 4.0 as stated by ARCHS4, limited on the same page to non-commercial use (commercial use needs a licence)",
        "CC BY 4.0 as stated by the Hub, with added limits: no commercial redistribution or marketing use",
        "CC BY 4.0 for the code",
        "https://creativecommons.org/licenses/by/4.0/ applies to text only",
        "MIT for the scripts, data from third parties",
    ],
)
def test_a_licence_name_with_extra_words_is_kept_as_written(raw):
    # These once came out as CC-BY-4.0 or CC-BY-NC-4.0. A qualified statement is not that licence.
    got = normalise(raw)
    assert (got.id, got.spdx, got.commercial_use) == (raw, False, "unclear")


def test_plain_statements_with_filler_words_are_still_read():
    assert normalise("This dataset is licensed under a Creative Commons Attribution 4.0 International License").id == "CC-BY-4.0"
    assert normalise("CC-BY 4.0 See https://github.com/x/y/blob/main/LICENSE").id == "CC-BY-4.0"
    assert normalise("Creative Commons Attribution 4.0 International Public License").id == "CC-BY-4.0"


def test_an_and_expression_of_identifiers_is_two_licences():
    both = normalise("CC-BY-SA-4.0 AND ODbL-1.0")
    assert (both.id, both.spdx, both.commercial_use, both.share_alike) == ("CC-BY-SA-4.0 AND ODbL-1.0", True, "yes", True)
    assert normalise("Research AND development use only").spdx is False


def test_markdown_link_with_two_statements_is_not_reduced_to_the_first():
    raw = "[MIT](https://github.com/x/y/blob/master/LICENSE); [terms of use](https://example.org/terms)"
    got = normalise(raw)
    assert not got.spdx and got.commercial_use == "unclear"


def test_version_not_stated_keeps_the_family_and_its_properties():
    assert normalise("CC BY") == licences.Licence("CC-BY (version not stated)", False, "yes", False)
    assert normalise("cc-by-sa") == licences.Licence("CC-BY-SA (version not stated)", False, "yes", True)
    assert normalise("CC BY-NC") == licences.Licence("CC-BY-NC (version not stated)", False, "no", False)


def test_explicit_statements_by_the_source():
    assert normalise("There are no restrictions on the use of this data.").commercial_use == "yes"
    assert normalise("other-nc").commercial_use == "no"
    assert normalise("Free for non-commercial use").commercial_use == "no"


def test_rights_lists():
    assert normalise(["cc-by-4.0", "Open Access"]).id == "CC-BY-4.0"
    assert normalise(["Creative Commons Attribution 4.0 International", "cc-by-4.0"]).id == "CC-BY-4.0"
    both = normalise(["cc-by-4.0", "mit", "Copyright (C) 2026 X"])
    assert (both.id, both.commercial_use) == ("CC-BY-4.0 AND MIT", "yes")
    mixed = normalise(["mit", "cc-by-nc-4.0"])
    assert (mixed.id, mixed.commercial_use) == ("CC-BY-NC-4.0 AND MIT", "no")
    alike = normalise(["cc-by-sa-4.0", "odbl"])
    assert (alike.id, alike.share_alike) == ("CC-BY-SA-4.0 AND ODbL-1.0", True)


def test_licence_url_is_used_when_the_label_is_not_a_licence():
    assert normalise("hpo", url="https://hpo.jax.org/app/license").spdx is False
    assert normalise(None, url="https://creativecommons.org/licenses/by-sa/4.0/").id == "CC-BY-SA-4.0"
    assert normalise("CC BY 3.0", url="http://creativecommons.org/licenses/by/3.0/").id == "CC-BY-3.0"


@pytest.mark.parametrize(
    "spdx_id, commercial, share_alike",
    [
        ("CC-BY-4.0", "yes", False), ("CC-BY-SA-3.0", "yes", True), ("CC-BY-ND-4.0", "yes", False),
        ("CC-BY-NC-4.0", "no", False), ("CC-BY-NC-SA-4.0", "no", True), ("CC-BY-NC-ND-4.0", "no", False),
        ("CC0-1.0", "yes", False), ("ODbL-1.0", "yes", True), ("PDDL-1.0", "yes", False),
        ("CDLA-Sharing-1.0", "yes", True), ("CDLA-Permissive-2.0", "yes", False),
        ("AGPL-3.0", "yes", True), ("C-UDA-1.0", "unclear", False), ("Hippocratic-2.1", "unclear", False),
    ],
)
def test_properties_of_spdx_identifiers(spdx_id, commercial, share_alike):
    assert licences.properties(spdx_id) == (commercial, share_alike)


def test_check_consistent_catches_a_wrong_flag():
    assert licences.check_consistent("CC-BY-4.0", "yes", False) is None
    assert "implies 'no'" in licences.check_consistent("CC-BY-NC-4.0", "yes", False)
    assert "share_alike" in licences.check_consistent("CC-BY-SA-4.0", "yes", False)
    assert "implies 'no'" in licences.check_consistent("CC-BY-NC-4.0 AND MIT", "yes", False)
    # a provider's own terms carry the flags the provider states: no rule to check against
    assert licences.check_consistent("EMBL-EBI Terms of Use", "unclear", False) is None


def test_detect_finds_the_licences_a_page_states():
    page = (
        '<a rel="license" href="https://creativecommons.org/licenses/by-sa/3.0/">Creative Commons '
        "Attribution-ShareAlike 3.0 Unported</a> <span>license:apache-2.0</span> "
        'and {"license": "mit"} and data under CC0.'
    )
    assert licences.detect(page) == {"CC-BY-SA-3.0", "Apache-2.0", "MIT", "CC0-1.0"}
    assert licences.detect("Nothing is said here about reuse.") == set()
    assert licences.detect("Attribution-NonCommercial 4.0 International") == {"CC-BY-NC-4.0"}


def test_family_drops_version_and_place():
    assert licences.family("CC-BY-SA-3.0") == "CC-BY-SA"
    assert licences.family("CC-BY-3.0-US") == "CC-BY"
    assert licences.family("CC-BY-4.0 AND MIT") == "CC-BY AND MIT"
    assert licences.family("GPL-3.0-or-later") == "GPL"


def test_every_alias_points_at_a_real_spdx_identifier():
    for alias, target in licences._ALIASES.items():
        assert target.lower() in licences.SPDX, (alias, target)
    assert len(licences.SPDX) > 600
