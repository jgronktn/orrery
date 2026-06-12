"""Drive access for the engineering agent — READ-ONLY reasoning side.

INVARIANT (CLAUDE.md): the agent's reasoning tools are read-only. This
module exposes ONLY search + read, and builds its Google credential with
the read-only scope. The single write capability — creating a new doc in
engineering/drafts/ — lives in the separate `draft.py` module (which the
agent's reasoning loop never imports). Do not add a write method here.

The generic service-account plumbing (auth, scopes, doc→text) lives in
`orrery_lib.drive`; this module is the engineering-specific reader on top
of it, scoped to the engineering Shared Drive.

Scope of search: the service account can only see what was shared with
it — the engineering/ tree — so a full-text search across everything it
can access IS a search of engineering/. ENGINEERING_FOLDER_ID is the
Shared Drive id, needed to query the drive corpus.
"""
from __future__ import annotations

import io
import os
from dataclasses import dataclass
from typing import Protocol

from orrery_lib import NotConfiguredError
from orrery_lib.drive import (
    DOCX_MIME,
    EXPORT_AS_TEXT,
    READONLY_SCOPES,
    SERVICE_ACCOUNT_PATH,
    build_service,
    docx_to_text,
)

# The engineering Shared Drive id (corpora='drive' queries need it).
ENGINEERING_FOLDER_ID = os.environ.get("ORRERY_ENG_DRIVE_FOLDER_ID", "")

_SETUP_HINT = (
    "Drive access is not configured yet. Save the service-account JSON to "
    "the repo root as service-account.json (gitignored), mount it in "
    "docker-compose.yml, and share engineering/ (Viewer) with the "
    "service-account email."
)


@dataclass
class DriveHit:
    """One Drive search result."""

    file_id: str
    name: str
    mime_type: str
    web_view_link: str
    snippet: str = ""


class DriveReader(Protocol):
    """Read-only contract the agent's Drive tool talks to."""

    def search(self, query: str, k: int = 5) -> list[DriveHit]: ...

    def read(self, file_id: str) -> str: ...


class NullDriveReader:
    """Stand-in until the service account is mounted. Never pretends."""

    def search(self, query: str, k: int = 5) -> list[DriveHit]:
        raise NotConfiguredError(_SETUP_HINT)

    def read(self, file_id: str) -> str:
        raise NotConfiguredError(_SETUP_HINT)


class ServiceAccountDriveReader:
    """Read-only Drive access via the engineering service account."""

    def __init__(self):
        self._service = build_service(READONLY_SCOPES)

    def search(self, query: str, k: int = 5) -> list[DriveHit]:
        # Escape single quotes for the Drive query language.
        safe = query.replace("\\", "\\\\").replace("'", "\\'")
        list_kwargs = dict(
            q=f"fullText contains '{safe}' and trashed = false",
            pageSize=max(1, min(k, 25)),
            fields="files(id, name, mimeType, webViewLink)",
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
        )
        # The engineering corpus lives on a Shared Drive. Shared-drive
        # contents are NOT returned by the default (user) corpus even
        # when shared — you must query the drive corpus explicitly.
        if ENGINEERING_FOLDER_ID.startswith("0A"):
            list_kwargs["corpora"] = "drive"
            list_kwargs["driveId"] = ENGINEERING_FOLDER_ID
        resp = self._service.files().list(**list_kwargs).execute()
        return [
            DriveHit(
                file_id=f["id"],
                name=f.get("name", "?"),
                mime_type=f.get("mimeType", ""),
                web_view_link=f.get("webViewLink", ""),
            )
            for f in resp.get("files", [])
        ]

    def read(self, file_id: str) -> str:
        """Return text for Google-native docs and uploaded .docx; for
        binaries (PDFs etc.) return a pointer to the link rather than raw
        bytes — the human reads datasheets/PDFs, the agent surfaces the
        link."""
        from googleapiclient.http import MediaIoBaseDownload

        meta = (
            self._service.files()
            .get(fileId=file_id, fields="id, name, mimeType, webViewLink",
                 supportsAllDrives=True)
            .execute()
        )
        mime = meta.get("mimeType", "")

        # Uploaded Word doc → download bytes, extract text.
        if mime == DOCX_MIME:
            buf = io.BytesIO()
            request = self._service.files().get_media(
                fileId=file_id, supportsAllDrives=True
            )
            downloader = MediaIoBaseDownload(buf, request)
            done = False
            while not done:
                _, done = downloader.next_chunk()
            return docx_to_text(buf.getvalue())

        # Google-native doc → export to text/csv.
        export_mime = EXPORT_AS_TEXT.get(mime)
        if export_mime is None:
            link = meta.get("webViewLink", "")
            return (
                f"[{meta.get('name', file_id)}] is a non-text file "
                f"({mime}). Open it directly: {link}"
            )
        request = self._service.files().export_media(
            fileId=file_id, mimeType=export_mime
        )
        buf = io.BytesIO()
        downloader = MediaIoBaseDownload(buf, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()
        return buf.getvalue().decode("utf-8", errors="replace")


def build_drive_reader() -> DriveReader:
    """Live reader if the key is mounted, else the null reader.

    Gated on the key file alone — search relies on the service account's
    visibility, not on the folder id, so it works as soon as the key is
    present and the folder is shared."""
    if SERVICE_ACCOUNT_PATH.exists():
        return ServiceAccountDriveReader()
    return NullDriveReader()
