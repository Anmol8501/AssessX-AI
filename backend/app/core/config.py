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

    # -- Phase 8A hardening -------------------------------------------------------------------------
    #: The header a trusted proxy sets to the real client address. Behind Render (whose edge is
    #: Cloudflare) use `cf-connecting-ip`. Unset: the connection's own address. Never trust
    #: `X-Forwarded-For` for security decisions — a client can send any value in it.
    client_ip_header: str | None = Field(default=None, max_length=64)
    #: Largest request body accepted, in bytes. The biggest legitimate request (a coding-problem
    #: version with examples, starter code and a reference solution) is well under 1 MiB.
    max_request_bytes: int = Field(default=2 * 1024 * 1024, ge=64 * 1024, le=50 * 1024 * 1024)
    #: Password hashes computed at once (Argon2id uses 64 MiB each); further requests wait briefly.
    password_hash_concurrency: int = Field(default=2, ge=1, le=16)
    #: Sign-in throttling: failures counted within a sliding window, per (account, client), per account
    #: and per client. Reaching a limit refuses further sign-ins for that key until failures age out
    #: of the window — always temporary, never a permanent lockout. The per-client limits are sized for
    #: an exam hall: every student behind one NAT shares a client address (50 students with a few typos
    #: each, and a fresh security check after every attempt). Accounts stay protected individually by
    #: the per-account limits.
    login_window_seconds: int = Field(default=900, ge=60, le=86400)
    login_max_failures_per_account_client: int = Field(default=5, ge=1, le=100)
    login_max_failures_per_account: int = Field(default=20, ge=1, le=1000)
    login_max_failures_per_client: int = Field(default=150, ge=1, le=10000)
    #: Sign-in challenges a single client may request per window (they are written to the database).
    challenge_max_per_client: int = Field(default=400, ge=5, le=10000)
    challenge_window_seconds: int = Field(default=600, ge=60, le=86400)
    #: A one-time password-reset code issued by an administrator is valid this long.
    password_reset_ttl_minutes: int = Field(default=30, ge=5, le=1440)
    #: WebSocket tickets (short-lived, single-use) replace the session token in WebSocket URLs.
    ws_ticket_ttl_seconds: int = Field(default=60, ge=10, le=600)
    #: Accept the legacy `?token=` on WebSockets (apps up to 0.1.3). Turn off once every installed app
    #: has updated; then a session token never appears in a URL.
    ws_allow_legacy_token: bool = True
    #: An exam in progress belongs to the session that opened it. Another session may take it over only
    #: after the owning session has been silent this long (a crashed laptop, a lost network).
    exam_takeover_after_seconds: int = Field(default=120, ge=30, le=3600)

    # -- Evidence clips (PRD FR-017; docs/EVIDENCE-CLIPS.md) --------------------------------------------
    #: Short camera clips around qualifying factual events, for human review. `None` (the default): on
    #: outside production, off in production until it is switched on with private storage configured.
    evidence_clips_enabled: bool | None = None
    #: Event types that may get a clip — only an AI episode's *start* (after 5C's stabilisation).
    evidence_event_types: Annotated[list[str], NoDecode] = Field(
        default=[
            "FACE_NOT_DETECTED",
            "MULTIPLE_FACES_DETECTED",
            "HEAD_ORIENTATION_CHANGED",
            "FACE_TOO_FAR",
            "FACE_TOO_CLOSE",
            "UPPER_BODY_NOT_VISIBLE",
            "PHONE_DETECTED",
            "BOOK_DETECTED",
            "LAPTOP_DETECTED",
            "HANDHELD_DEVICE_DETECTED",
        ]
    )
    #: Seconds of video kept from before the event (the rolling buffer) and recorded after it.
    evidence_pre_seconds: int = Field(default=5, ge=2, le=15)
    evidence_post_seconds: int = Field(default=10, ge=2, le=20)
    #: Hard ceilings on one clip, enforced on upload whatever the app sends.
    evidence_max_clip_seconds: int = Field(default=30, ge=10, le=60)
    evidence_max_clip_bytes: int = Field(default=1_500_000, ge=100_000, le=8 * 1024 * 1024)
    #: Recording quality — bounded so a clip stays small (see the storage estimate in the docs).
    evidence_video_bits_per_second: int = Field(default=250_000, ge=100_000, le=1_500_000)
    evidence_max_width: int = Field(default=640, ge=160, le=1280)
    evidence_max_height: int = Field(default=360, ge=120, le=720)
    evidence_frame_rate: int = Field(default=10, ge=5, le=30)
    #: A new clip starts no sooner than this after the previous one in the same session; an event that
    #: falls inside a clip still being captured is linked to that clip instead of getting its own.
    evidence_cooldown_seconds: int = Field(default=30, ge=0, le=600)
    evidence_max_clips_per_session: int = Field(default=20, ge=1, le=200)
    #: How long after a clip's capture window the app may still upload it before it is marked FAILED.
    evidence_upload_grace_seconds: int = Field(default=120, ge=30, le=3600)
    evidence_max_upload_attempts: int = Field(default=3, ge=1, le=10)
    #: Days a READY clip is kept; then the video is deleted (metadata stays, as EXPIRED). An attempt
    #: whose review is in progress is held until the review completes.
    evidence_retention_days: int = Field(default=30, ge=1, le=365)
    #: How often the API itself runs retention and the upload-deadline sweep (0 = never; then run
    #: `python -m app.cli evidence-maintenance` on a schedule instead).
    evidence_maintenance_interval_minutes: int = Field(default=60, ge=0, le=1440)
    #: Where clip videos live. `local` (a directory on this machine) is for development: Render's disk
    #: is wiped on every deploy, so production must use `supabase` (a PRIVATE bucket).
    evidence_storage_backend: Literal["local", "supabase"] = "local"
    evidence_local_dir: str = "var/evidence"
    supabase_url: str | None = None
    #: Supabase service-role key: server-only, never sent to any app, never logged.
    supabase_service_role_key: SecretStr | None = None
    evidence_bucket: str = Field(default="assessx-evidence", pattern=r"^[a-z0-9][a-z0-9._-]{2,62}$")

    # -- Security operations (Phase 8 final; docs/SECURITY-OPERATIONS.md) --------------------------------
    #: Where security alerts are posted (Slack/Discord/ntfy-compatible JSON). Unset: alerts are logged and
    #: kept in `security_alerts` only. Secret (the URL often embeds a token).
    alert_webhook_url: SecretStr | None = None
    #: Admin TOTP. `None`: required in production, optional elsewhere. A production API refuses `false`.
    admin_mfa_required: bool | None = None
    #: Admin sessions never last longer than this, and "keep me signed in" does not apply to admins.
    admin_session_ttl_hours: int = Field(default=12, ge=1, le=24)
    #: Bearer token for `POST /api/v1/internal/maintenance` (the scheduled job). Unset: the route is off.
    maintenance_token: SecretStr | None = None
    #: Expected maximum gap between successful backups before a `backup_missing` alert.
    backup_max_age_hours: int = Field(default=26, ge=1, le=24 * 14)
    #: Retention (docs/DATA-RETENTION.md). 0 keeps that data indefinitely.
    retention_security_event_days: int = Field(default=365, ge=0, le=3650)
    retention_proctoring_event_days: int = Field(default=365, ge=0, le=3650)
    retention_attempt_days: int = Field(default=1095, ge=0, le=3650)
    retention_session_days: int = Field(default=30, ge=1, le=365)
    #: Evidence-media views per admin per hour, and report downloads per admin per hour.
    evidence_views_per_hour: int = Field(default=120, ge=10, le=5000)
    report_downloads_per_hour: int = Field(default=120, ge=10, le=5000)
    #: Open WebSockets per user.
    max_sockets_per_user: int = Field(default=6, ge=1, le=50)

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
        if self.evidence_clips_enabled and self.evidence_storage_backend != "supabase":
            problems.append(
                "EVIDENCE_CLIPS_ENABLED needs EVIDENCE_STORAGE_BACKEND=supabase in production "
                "(local storage is lost on every deploy)"
            )
        if self.evidence_storage_backend == "supabase" and not (
            self.supabase_url and self.supabase_service_role_key
        ):
            problems.append(
                "EVIDENCE_STORAGE_BACKEND=supabase needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"
            )
        if self.admin_mfa_required is False:
            problems.append("ADMIN_MFA_REQUIRED=false is not allowed in production")
        if self.alert_webhook_url and not self.alert_webhook_url.get_secret_value().startswith("https://"):
            problems.append("ALERT_WEBHOOK_URL must use https://")
        if (
            self.maintenance_token
            and len(self.maintenance_token.get_secret_value()) < PRODUCTION_SECRET_MIN_LENGTH
        ):
            problems.append(f"MAINTENANCE_TOKEN must be at least {PRODUCTION_SECRET_MIN_LENGTH} characters")
        if self.supabase_url and not self.supabase_url.startswith("https://"):
            problems.append("SUPABASE_URL must use https:// in production")
        if problems:
            raise ValueError("; ".join(problems))
        return self

    @model_validator(mode="after")
    def _evidence_bounds(self) -> Self:
        """Cross-field limits for evidence clips (any environment)."""
        from app.models.proctoring_event import ProctoringEventType

        unknown = [t for t in self.evidence_event_types if t not in ProctoringEventType.__members__]
        if unknown:
            raise ValueError(f"EVIDENCE_EVENT_TYPES has unknown event types: {', '.join(unknown)}")
        # The app keeps up to one extra pre-event segment (the rolling buffer), so the longest clip it
        # can produce is 2 x pre + post. That must fit the ceiling, and a clip must fit a request.
        if 2 * self.evidence_pre_seconds + self.evidence_post_seconds > self.evidence_max_clip_seconds:
            raise ValueError("EVIDENCE_MAX_CLIP_SECONDS must be at least 2 x PRE + POST seconds")
        if self.evidence_max_clip_bytes > self.max_request_bytes:
            raise ValueError("EVIDENCE_MAX_CLIP_BYTES must not exceed MAX_REQUEST_BYTES")
        return self

    @field_validator("evidence_event_types", mode="before")
    @classmethod
    def _split_event_types(cls, value: object) -> object:
        if isinstance(value, str):
            return [part.strip() for part in value.split(",") if part.strip()]
        return value

    @property
    def mfa_required(self) -> bool:
        return self.is_production if self.admin_mfa_required is None else self.admin_mfa_required

    @property
    def evidence_enabled(self) -> bool:
        """Effective switch: explicit setting, else on outside production only."""
        if self.evidence_clips_enabled is None:
            return not self.is_production
        return self.evidence_clips_enabled

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
