"""Backend settings, read from the environment."""
from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ORRERY_", extra="ignore")

    # Postgres (SQLAlchemy + psycopg v3).
    database_url: str = (
        "postgresql+psycopg://orrery:orrery@postgres:5432/orrery"
    )

    # Session signing + cookie. SESSION_SECRET MUST be set in prod.
    session_secret: str = "dev-insecure-change-me"
    session_cookie_name: str = "orrery_session"
    session_ttl_hours: int = 24 * 14  # sliding 14-day window
    cookie_secure: bool = False  # True behind HTTPS in prod
    cookie_samesite: str = "lax"

    # Password-reset token lifetime.
    reset_ttl_minutes: int = 60

    # Agent HTTP services (the backend is the only caller).
    engineering_agent_url: str = "http://engineering:8001"
    corporate_agent_url: str = "http://corporate:8002"
    # URL agents use to call back into /internal/agent/* (in-network name).
    backend_internal_url: str = "http://backend:8000"

    # CORS origins for the future frontend (Vite dev server).
    cors_origins: list[str] = ["http://localhost:5173"]

    # Slack (approval-queue notifications). Read from the unprefixed env
    # vars the rest of the stack already uses. Empty → log instead of post.
    slack_bot_token: str = Field("", validation_alias="SLACK_BOT_TOKEN")
    slack_approval_channel: str = Field("", validation_alias="SLACK_APPROVAL_CHANNEL")

    # Company identity for the Home read model (no company table this phase).
    company_name: str = "Orrery"
    company_tagline: str = "Your company, in orbit."

    # Our email domain(s), comma-separated. An email whose From is on one of
    # these is "outgoing" (sent by us); otherwise "incoming".
    company_email_domains: str = "propertyprotectioninnovations.com"

    env: str = "dev"

    @property
    def company_domains(self) -> set[str]:
        return {
            d.strip().lower()
            for d in self.company_email_domains.split(",")
            if d.strip()
        }


settings = Settings()
