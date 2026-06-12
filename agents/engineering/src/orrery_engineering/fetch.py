"""SpecFetcher — download a human-specified file into engineering/drafts/.

This is a WRITE + EGRESS path, deliberately kept OUT of the agent's
reasoning loop. The agent never imports this module and has no tool that
calls it. The agent can only FIND and PROPOSE a datasheet URL (via its
existing web search); a human runs `eng-save-spec --url ...` to actually
fetch and store it. So:

  - The agent has no write tool        → read-only-reasoning invariant holds.
  - The agent has no direct net fetch  → it never touches the external URL.
  - A human triggers every download    → governed-autonomy holds.

DELIBERATE OVERRIDE (logged for reviewers): downloading from an arbitrary
vendor URL is outbound egress beyond the Exa search endpoint, which
CLAUDE.md's egress invariant otherwise forbids ("egress restricted to the
search provider only"). This is an explicit, human-invoked exception, and
the egress lives HERE, never in the agent. Guards below limit the blast
radius; they do not make arbitrary fetch risk-free.

Guards: http/https only; refuse private/loopback/link-local hosts (basic
SSRF guard on the initial host); 30 MB size cap; 30 s timeout. Files are
always NEW in drafts/ — this never overwrites (create-only).
"""
from __future__ import annotations

import ipaddress
import os
import re
import socket
from urllib.parse import unquote, urlparse

import httpx

from orrery_lib import NotConfiguredError
from orrery_lib.drive import SERVICE_ACCOUNT_PATH, WRITE_SCOPES, build_service

from .draft import DRAFTS_FOLDER_ID, CreatedDraft

MAX_BYTES = 30 * 1024 * 1024  # 30 MB
TIMEOUT_S = 30.0

# content-type → extension, for naming when the URL lacks one.
_EXT_BY_TYPE = {
    "application/pdf": ".pdf",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "text/plain": ".txt",
    "text/html": ".html",
}

_SETUP_HINT = (
    "Spec fetch is not configured yet. It needs the service-account key "
    f"({SERVICE_ACCOUNT_PATH}), Editor share on engineering/drafts/, and "
    "ORRERY_ENG_DRAFTS_FOLDER_ID set to that folder's id."
)


def _guard_url(url: str) -> None:
    """Allow only http/https to public hosts. Basic SSRF guard."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"only http/https URLs allowed, got: {parsed.scheme!r}")
    host = parsed.hostname
    if not host:
        raise ValueError("URL has no host")
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise ValueError(f"cannot resolve host {host!r}: {exc}") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
        ):
            raise ValueError(
                f"refusing to fetch non-public host {host!r} ({ip})"
            )


def _derive_name(url: str, name: str | None, content_type: str) -> str:
    """A safe filename for the stored draft."""
    if name:
        base = name.strip()
    else:
        path = unquote(urlparse(url).path)
        base = os.path.basename(path) or "downloaded-spec"
    base = re.sub(r"[^A-Za-z0-9._ -]+", "_", base).strip() or "downloaded-spec"
    if "." not in base:
        base += _EXT_BY_TYPE.get(content_type, "")
    return base


def fetch_to_drafts(url: str, name: str | None = None) -> CreatedDraft:
    """Download `url` and store it as a NEW file in engineering/drafts/.
    Returns the created draft handle. Create-only; never overwrites."""
    if not (SERVICE_ACCOUNT_PATH.exists() and DRAFTS_FOLDER_ID):
        raise NotConfiguredError(_SETUP_HINT)
    _guard_url(url)

    headers = {"User-Agent": "orrery-engineering-agent/0.1"}
    with httpx.Client(follow_redirects=True, timeout=TIMEOUT_S) as client:
        with client.stream("GET", url, headers=headers) as resp:
            resp.raise_for_status()
            content_type = (
                resp.headers.get("content-type", "").split(";")[0].strip()
                or "application/octet-stream"
            )
            declared = resp.headers.get("content-length")
            if declared and int(declared) > MAX_BYTES:
                raise ValueError(
                    f"file is {int(declared):,} bytes, over the "
                    f"{MAX_BYTES:,}-byte cap"
                )
            buf = bytearray()
            for chunk in resp.iter_bytes():
                buf.extend(chunk)
                if len(buf) > MAX_BYTES:
                    raise ValueError(f"file exceeds the {MAX_BYTES:,}-byte cap")
            data = bytes(buf)

    filename = _derive_name(url, name, content_type)

    from googleapiclient.http import MediaInMemoryUpload

    service = build_service(WRITE_SCOPES)
    media = MediaInMemoryUpload(data, mimetype=content_type, resumable=False)
    created = (
        service.files()
        .create(
            body={"name": filename, "parents": [DRAFTS_FOLDER_ID]},
            media_body=media,
            fields="id, name, webViewLink",
            supportsAllDrives=True,
        )
        .execute()
    )
    return CreatedDraft(
        file_id=created["id"],
        name=created.get("name", filename),
        web_view_link=created.get("webViewLink", ""),
    )
