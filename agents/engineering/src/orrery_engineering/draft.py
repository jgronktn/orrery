"""DriveDraftCreator — the engineering agent's ONLY write capability.

INVARIANT (CLAUDE.md), mirroring the support agent's send.py:
  This module is NEVER imported by agent.py. The agent's reasoning loop
  has no path to create or modify a Drive file. The top-level driver
  (handle.py / the `eng-draft` command) imports it separately, to turn
  an already-produced draft into a NEW document. Any refactor that
  lands a create/write tool on the Agent breaks the governance
  guarantee and must be rejected at review.

Two hard rules this enforces:
  - NEVER overwrite. Every call CREATES a NEW file. There is no update
    path here.
  - New docs land ONLY in engineering/drafts/ (DRAFTS_FOLDER_ID).

The write credential uses the full drive scope, but Google's own folder
ACLs are the real boundary: the service account is Editor ONLY on
engineering/drafts/ and Viewer elsewhere, so a create anywhere else
fails at the API. Code intent + Google ACL agree.

Drafting model: the agent reads the relevant template via its read-only
tool and produces the filled draft as Markdown. create() converts that
Markdown to HTML and uploads it as a NEW Google Doc — Drive's importer
turns the HTML into real Doc formatting (headings, bold, bullet lists,
and tables), so the draft isn't a plaintext blob. This uses only the
Drive API (no Docs API / extra scope).
"""
from __future__ import annotations

import os
from dataclasses import dataclass

from orrery_lib import NotConfiguredError
from orrery_lib.drive import SERVICE_ACCOUNT_PATH, WRITE_SCOPES, build_service


def _markdown_to_html(body: str) -> str:
    """Render the agent's Markdown draft to a full HTML document.

    Drive's converter maps semantic HTML to Doc structure: h1-h6 →
    heading styles, strong/em → bold/italic, ul/ol → lists, table →
    a real table. The 'extra' extension set enables pipe tables and
    sane lists. Imported lazily so the package loads without the dep."""
    import markdown

    html_body = markdown.markdown(
        body, extensions=["extra", "sane_lists"], output_format="html"
    )
    return (
        "<!DOCTYPE html><html><head><meta charset='utf-8'></head>"
        f"<body>{html_body}</body></html>"
    )

# Drive folder id for engineering/drafts/ — the only place writes land.
DRAFTS_FOLDER_ID = os.environ.get("ORRERY_ENG_DRAFTS_FOLDER_ID", "")

_SETUP_HINT = (
    "Draft creation is not configured yet. It needs the service-account "
    f"key ({SERVICE_ACCOUNT_PATH}), Editor share on engineering/drafts/, "
    "and ORRERY_ENG_DRAFTS_FOLDER_ID set to that folder's id."
)


@dataclass
class CreatedDraft:
    """Result of creating a new draft doc."""

    file_id: str
    name: str
    web_view_link: str


class DriveDraftCreator:
    """Creates a NEW doc in engineering/drafts/. Create-only by
    construction — no update/overwrite method exists."""

    def __init__(self, drafts_folder_id: str = DRAFTS_FOLDER_ID):
        self.drafts_folder_id = drafts_folder_id

    def create(self, name: str, body: str) -> CreatedDraft:
        """Create a new draft Google Doc from `body` (Markdown) in
        drafts/, with real formatting. Never touches an existing file."""
        if not (SERVICE_ACCOUNT_PATH.exists() and self.drafts_folder_id):
            raise NotConfiguredError(_SETUP_HINT)

        from googleapiclient.http import MediaInMemoryUpload

        service = build_service(WRITE_SCOPES)
        html = _markdown_to_html(body)
        media = MediaInMemoryUpload(
            html.encode("utf-8"), mimetype="text/html", resumable=False
        )
        created = (
            service.files()
            .create(
                body={
                    "name": name,
                    "parents": [self.drafts_folder_id],
                    # Drive converts the uploaded HTML into a native
                    # Google Doc, preserving headings/bold/lists/tables.
                    "mimeType": "application/vnd.google-apps.document",
                },
                media_body=media,
                fields="id, name, webViewLink",
                supportsAllDrives=True,
            )
            .execute()
        )
        return CreatedDraft(
            file_id=created["id"],
            name=created.get("name", name),
            web_view_link=created.get("webViewLink", ""),
        )
