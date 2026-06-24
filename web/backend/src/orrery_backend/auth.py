"""Email/password auth: register, login, logout, me, password reset.

Server-side sessions (a row per session, id carried in a signed cookie)
with sliding expiration. Sessions invalidate on password change.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session as DbSession

from .config import settings
from .db import get_db
from .email import get_email_sender
from .models import PasswordResetToken, Session, User
from .schemas import (
    LoginIn,
    PasswordResetConfirmIn,
    PasswordResetRequestIn,
    RegisterIn,
    UserOut,
)
from .security import (
    hash_password,
    hash_token,
    new_token,
    sign_session,
    unsign_session,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _start_session(db: DbSession, user: User, response: Response) -> None:
    """Create a session row and set the signed cookie."""
    expires = _utcnow() + timedelta(hours=settings.session_ttl_hours)
    sess = Session(user_id=user.id, expires_at=expires)
    db.add(sess)
    db.commit()
    response.set_cookie(
        key=settings.session_cookie_name,
        value=sign_session(str(sess.id)),
        max_age=settings.session_ttl_hours * 3600,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
    )


# Slide the session's expiry/last_used_at at most this often, instead of on
# every request — removes a write from the hot path. Expiry is still CHECKED on
# every request (correctness unchanged); we just don't re-stamp it each time.
_SLIDE_AFTER = timedelta(minutes=5)


def current_user(request: Request, db: DbSession = Depends(get_db)) -> User:
    """Resolve the authenticated user from the session cookie, or 401.
    Slides the session's expiry forward (throttled to once per _SLIDE_AFTER)."""
    raw = request.cookies.get(settings.session_cookie_name)
    if not raw:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not authenticated")
    sid = unsign_session(raw)
    if not sid:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid session")
    # One round trip: the session + its user (instead of two PK lookups).
    row = db.execute(
        select(Session, User).join(User, User.id == Session.user_id).where(
            Session.id == sid
        )
    ).first()
    now = _utcnow()
    if row is None or row[0].expires_at <= now:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "session expired")
    sess, user = row
    if user.status != "active":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "user inactive")
    # Sliding expiration — throttled: only re-stamp (a write) once it's stale.
    if sess.last_used_at < now - _SLIDE_AFTER:
        sess.last_used_at = now
        sess.expires_at = now + timedelta(hours=settings.session_ttl_hours)
        db.commit()
    return user


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(body: RegisterIn, response: Response, db: DbSession = Depends(get_db)) -> User:
    exists = db.scalar(select(User).where(User.email == body.email.lower()))
    if exists:
        raise HTTPException(status.HTTP_409_CONFLICT, "email already registered")
    user = User(
        email=body.email.lower(),
        display_name=body.display_name,
        password_hash=hash_password(body.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    _start_session(db, user, response)  # auto-login on register
    return user


@router.post("/login", response_model=UserOut)
def login(body: LoginIn, response: Response, db: DbSession = Depends(get_db)) -> User:
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if user is None or not verify_password(user.password_hash, body.password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid credentials")
    if user.status != "active":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "account disabled")
    _start_session(db, user, response)
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response, db: DbSession = Depends(get_db)) -> None:
    raw = request.cookies.get(settings.session_cookie_name)
    if raw:
        sid = unsign_session(raw)
        if sid:
            db.execute(delete(Session).where(Session.id == sid))
            db.commit()
    response.delete_cookie(settings.session_cookie_name)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)) -> User:
    return user


@router.post("/password-reset/request", status_code=status.HTTP_202_ACCEPTED)
def password_reset_request(
    body: PasswordResetRequestIn, db: DbSession = Depends(get_db)
) -> dict:
    """Always returns 202 (never reveal whether the email exists)."""
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if user is not None:
        token = new_token()
        db.add(
            PasswordResetToken(
                user_id=user.id,
                token_hash=hash_token(token),
                expires_at=_utcnow() + timedelta(minutes=settings.reset_ttl_minutes),
            )
        )
        db.commit()
        link = f"/reset-password?token={token}"
        get_email_sender().send(
            user.email,
            "Reset your Orrery password",
            f"Use this link within {settings.reset_ttl_minutes} minutes: {link}",
        )
    return {"status": "accepted"}


@router.post("/password-reset/confirm", status_code=status.HTTP_204_NO_CONTENT)
def password_reset_confirm(
    body: PasswordResetConfirmIn, db: DbSession = Depends(get_db)
) -> None:
    row = db.scalar(
        select(PasswordResetToken).where(
            PasswordResetToken.token_hash == hash_token(body.token)
        )
    )
    if row is None or row.used or row.expires_at <= _utcnow():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid or expired token")
    user = db.get(User, row.user_id)
    if user is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid token")
    user.password_hash = hash_password(body.new_password)
    row.used = True
    # Invalidate all of the user's sessions on password change.
    db.execute(delete(Session).where(Session.user_id == user.id))
    db.commit()
