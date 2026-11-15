"""Runs the teammate's selftest.py (scripted model, no key) under pytest."""

import selftest


def test_selftest_passes():
    assert selftest.main() == 0
