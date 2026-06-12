"""Outbound email — a seam.

Dev: log the message (and any link) to the backend console. Real
delivery via Postmark is wired in a later pass behind this same
interface, selected by env (e.g. POSTMARK_API_TOKEN present).
"""
from __future__ import annotations

import logging
from typing import Protocol

log = logging.getLogger("orrery.email")


class EmailSender(Protocol):
    def send(self, to: str, subject: str, body: str) -> None: ...


class ConsoleEmailSender:
    """Prints the email instead of sending it. Used in dev."""

    def send(self, to: str, subject: str, body: str) -> None:
        log.warning(
            "[email:dev] would send to %s | %s\n%s", to, subject, body
        )


def get_email_sender() -> EmailSender:
    # Postmark sender lands here later, chosen when POSTMARK_API_TOKEN is set.
    return ConsoleEmailSender()
