from functools import lru_cache
from typing import Annotated, Literal, Self

from pydantic import Field, field_validator, model_validator
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
        if problems:
            raise ValueError("; ".join(problems))
        return self

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
