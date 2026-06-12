"""Password hashing, reset-token hashing, and session-cookie signing."""
from __future__ import annotations

import hashlib
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from itsdangerous import BadSignature, URLSafeSerializer

from .config import settings

_ph = PasswordHasher()
_serializer = URLSafeSerializer(settings.session_secret, salt="orrery-session")


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        _ph.verify(password_hash, password)
        return True
    except VerifyMismatchError:
        return False
    except Exception:
        return False


def new_token() -> str:
    """A random URL-safe token (session id is a UUID; this is for resets)."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """sha256 of a reset token — we store the hash, email the raw token."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def sign_session(session_id: str) -> str:
    """Sign the session id for the cookie (tamper-evident)."""
    return _serializer.dumps(session_id)


def unsign_session(signed: str) -> str | None:
    try:
        return _serializer.loads(signed)
    except BadSignature:
        return None
