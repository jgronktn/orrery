"""Unit tests for Markdown → HTML rendering used by draft creation."""
from orrery_engineering.draft import _markdown_to_html


def test_markdown_renders_heading_bold_and_table():
    md = "# Title\n\n**bold**\n\n| a | b |\n|---|---|\n| 1 | 2 |\n"
    html = _markdown_to_html(md)
    assert "<h1" in html
    assert "<strong>bold</strong>" in html
    assert "<table>" in html


def test_markdown_renders_bullets():
    html = _markdown_to_html("- one\n- two\n")
    assert "<ul>" in html
    assert "<li>one</li>" in html
