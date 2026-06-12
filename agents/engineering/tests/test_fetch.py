"""Unit tests for the spec-fetch guards and naming (no network/creds)."""
import pytest

from orrery_engineering.fetch import _derive_name, _guard_url


def test_guard_rejects_non_http():
    with pytest.raises(ValueError):
        _guard_url("ftp://example.com/file.pdf")


def test_guard_rejects_loopback():
    with pytest.raises(ValueError):
        _guard_url("http://127.0.0.1/x")


def test_guard_rejects_private_range():
    with pytest.raises(ValueError):
        _guard_url("http://10.0.0.5/x")


def test_derive_name_from_url_basename():
    assert (
        _derive_name("https://ti.com/lit/ds/ina228.pdf", None, "application/pdf")
        == "ina228.pdf"
    )


def test_derive_name_adds_extension_from_content_type():
    assert (
        _derive_name("https://x.com/download", None, "application/pdf")
        == "download.pdf"
    )


def test_derive_name_honors_explicit_name():
    assert _derive_name("https://x.com/whatever", "my-part.pdf", "application/pdf") == (
        "my-part.pdf"
    )
