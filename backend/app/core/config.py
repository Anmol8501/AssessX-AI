from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration. Every value comes from the environment or `.env`; nothing is hardcoded."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: Literal["development", "test", "production"] = "development"
    database_url: str = Field(description="SQLAlchemy URL, e.g. postgresql+psycopg://user:pass@host/db")
    test_database_url: str | None = None
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
