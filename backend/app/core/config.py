from functools import lru_cache
from typing import Annotated, Literal, Self

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

#: The SQLAlchemy driver the app is built for (psycopg 3; psycopg2 is not installed).
_DRIVER_SCHEME = "postgresql+psycopg://"

#: Minimum SECRET_KEY length when APP_ENV=production.
PRODUCTION_SECRET_MIN_LENGTH = 32


def normalize_database_url(url: str) -> str:
    """Accepts the URL forms hosting providers hand out and pins the installed driver.

    Supabase, Render and Heroku-style providers give `postgres://…` or `postgresql://…`; SQLAlchemy
    reads either as the psycopg2 driver, which is not installed. Rewriting only the scheme to
    `postgresql+psycopg://` keeps credentials, host, database and query options (e.g.
    `?sslmode=require`) exactly as given. An explicit driver scheme is left untouched.
    """
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return _DRIVER_SCHEME + url[len(prefix) :]
    return url


class Settings(BaseSettings):
    """Runtime configuration. Every value comes from the environment or `.env`; nothing is hardcoded."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: Literal["development", "test", "production"] = "development"
    database_url: str = Field(description="SQLAlchemy URL, e.g. postgresql+psycopg://user:pass@host/db")
    test_database_url: str | None = None
    # Connection pool per process. Defaults suit local PostgreSQL; a hosted pooler with a small
    # client limit (e.g. Supabase Free) should set these lower — see docs/DEPLOYMENT-RENDER.md.
    db_pool_size: int = Field(default=5, ge=1)
    db_max_overflow: int = Field(default=10, ge=0)
    secret_key: str = Field(
        min_length=16, description="Keys server-side token hashing; rotating it ends every session"
    )
    cors_origins: Annotated[list[str], NoDecode] = [
        "http://localhost:1420",
        "http://tauri.localhost",
        "https://tauri.localhost",
    ]
    # WebRTC (live video between an admin and a candidate). STUN lets two laptops on different
    # networks find each other; TURN relays the video when a network forbids a direct connection.
    # TURN is optional and uses Cloudflare Realtime TURN: the key id and its API token stay on the
    # server, which issues short-lived TURN credentials to signed-in apps (never built into an app).
    stun_urls: Annotated[list[str], NoDecode] = [
        "stun:stun.cloudflare.com:3478",
        "stun:stun.l.google.com:19302",
    ]
    cloudflare_turn_key_id: str | None = None
    cloudflare_turn_api_token: str | None = None
    turn_credential_ttl_seconds: int = Field(default=14400, ge=300, le=172800)
    # Coding assessments. Off until a code runner is set up (stage C2): until then an assessment that
    # contains coding questions can be built but not published, so candidates never meet a coding
    # question that cannot run.
    coding_execution_enabled: bool = False
    # The code runner's shared secret (stage C2). Unset: the runner routes are disabled (404). Set it on the
    # API and on the runner host only — never in the desktop app.
    runner_token: SecretStr | None = None
    # How long a claimed job may run before another runner may take it over, and how many claims a job
    # gets before it is failed as a system error.
    runner_lease_seconds: int = Field(default=180, ge=30, le=3600)
    runner_max_claims: int = Field(default=3, ge=1, le=10)
    # Phase 7B — AI answer evaluation. Server-side only: the key is never sent to any client, logged or
    # returned. `none` (default) records evaluations as unavailable and interviews continue without
    # them; `stub` is a labelled, deterministic test double allowed only in development/test.
    llm_provider: Literal["none", "anthropic", "stub"] = "none"
    llm_api_key: SecretStr | None = None
    llm_model: str = Field(default="claude-haiku-4-5-20251001", min_length=1, max_length=100)
    llm_timeout_seconds: float = Field(default=20.0, ge=2.0, le=60.0)
    #: Extra attempts for a rate-limited / unavailable / timed-out provider call (not for bad output).
    llm_max_retries: int = Field(default=2, ge=0, le=2)
    #: How long a candidate waits for an evaluation before the interview moves on without it.
    evaluation_wait_seconds: int = Field(default=25, ge=5, le=60)
    session_ttl_hours: int = 12
    session_remember_ttl_days: int = 30
    login_challenge_ttl_seconds: int = 300
    api_host: str = "127.0.0.1"
    api_port: int = 8000
    log_level: str = "INFO"
    log_format: Literal["console", "json"] | None = Field(
        default=None, description="Defaults to console in development/test and json in production"
    )

    @field_validator("database_url", "test_database_url")
    @classmethod
    def _normalize_database_url(cls, value: str | None) -> str | None:
        return normalize_database_url(value) if value else value

    @model_validator(mode="after")
    def _production_safety(self) -> Self:
        """Refuses to start a production process on unsafe configuration, rather than running with it."""
        if not self.is_production:
            return self
        problems: list[str] = []
        if "*" in self.cors_origins:
            problems.append("CORS_ORIGINS must list explicit origins; '*' is not allowed in production")
        if len(self.secret_key) < PRODUCTION_SECRET_MIN_LENGTH or self.secret_key.startswith("change-me"):
            problems.append(
                f"SECRET_KEY must be a random value of at least {PRODUCTION_SECRET_MIN_LENGTH} characters "
                "in production (not the development placeholder)"
            )
        if self.llm_provider == "stub":
            problems.append("LLM_PROVIDER=stub is a test double and is not allowed in production")
        if self.llm_provider == "anthropic" and not self.llm_api_key:
            problems.append("LLM_PROVIDER=anthropic needs LLM_API_KEY")
        if self.runner_token and len(self.runner_token.get_secret_value()) < PRODUCTION_SECRET_MIN_LENGTH:
            problems.append(
                f"RUNNER_TOKEN must be a random value of at least {PRODUCTION_SECRET_MIN_LENGTH} characters"
            )
        if self.runner_token and self.runner_token.get_secret_value() == self.secret_key:
            problems.append("RUNNER_TOKEN must not reuse SECRET_KEY")
        if self.coding_execution_enabled and not self.runner_token:
            problems.append(
                "CODING_EXECUTION_ENABLED needs RUNNER_TOKEN: "
                "without a runner, coding submissions are never judged"
            )
        if problems:
            raise ValueError("; ".join(problems))
        return self

    @field_validator("stun_urls", mode="before")
    @classmethod
    def _split_stun_urls(cls, value: object) -> object:
        if isinstance(value, str):
            return [url.strip() for url in value.split(",") if url.strip()]
        return value

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def effective_log_format(self) -> str:
        return self.log_format or ("json" if self.is_production else "console")


@lru_cache
def get_settings() -> Settings:
    return Settings()  # populated from the environment / .env
