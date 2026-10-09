import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.dev import router as dev_router
from app.api.v1.router import api_v1
from app.core.config import get_settings
from app.core.database import DatabaseSessionMiddleware, check_database
from app.core.errors import register_exception_handlers
from app.core.limits import BodySizeLimitMiddleware, SecurityHeadersMiddleware
from app.core.logging import RequestContextMiddleware, configure_logging

log = logging.getLogger("assessx.app")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    log.info(
        "AssessX API starting",
        extra={"env": settings.app_env, "version": app.version, "log_format": settings.effective_log_format},
    )
    # A missing database is reported, not fatal: /api/v1/health surfaces it and the process
    # keeps serving so an orchestrator can see *why* it is unhealthy.
    if check_database():
        log.info("Database reachable")
    else:
        log.error("Database unreachable at startup; requests will fail with 503 until it returns")
    maintenance = _start_evidence_maintenance(settings)
    yield
    if maintenance is not None:
        maintenance.cancel()
    log.info("AssessX API stopping")


def _start_evidence_maintenance(settings) -> "asyncio.Task[None] | None":  # noqa: ANN001
    """Evidence clips (FR-017): fail overdue uploads and apply retention every N minutes, in a worker
    thread so it never blocks a request. Off in tests and when the interval is 0 (then run the CLI's
    `evidence-maintenance` on a schedule instead)."""
    minutes = settings.evidence_maintenance_interval_minutes
    if minutes == 0 or settings.app_env == "test":
        return None

    async def loop() -> None:
        from app.core.database import SessionLocal
        from app.services.retention import run_all

        def once() -> None:
            with SessionLocal() as db:
                run_all(db, get_settings())
                db.commit()

        while True:
            await asyncio.sleep(minutes * 60)
            try:
                await asyncio.to_thread(once)
            except Exception:  # noqa: BLE001 — retried next interval; never takes the API down
                log.exception("Evidence maintenance failed")

    return asyncio.create_task(loop())


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level, settings.effective_log_format)

    app = FastAPI(
        title="AssessX API",
        version="0.1.0",
        docs_url="/docs" if not settings.is_production else None,
        redoc_url=None,
        # The API description is not published in production (AX-12): no client needs it.
        openapi_url="/openapi.json" if not settings.is_production else None,
        lifespan=lifespan,
    )
    # Added first, so it sits closest to the application and commits before anything else sees
    # the response. See `app/core/database.py`.
    app.add_middleware(DatabaseSessionMiddleware)
    # Phase 8A: a bounded request body (AX-02) and defensive response headers (AX-11).
    app.add_middleware(BodySizeLimitMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    # Outermost so every request — including CORS preflights and errors — gets an id and a log line.
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,  # bearer tokens, not cookies
        # PUT is how a candidate's answer is upserted (Phase 3A); without it the browser's
        # preflight is refused and every save fails from the desktop client.
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
        expose_headers=["X-Request-ID", "X-Next-Offset"],
    )
    register_exception_handlers(app)
    app.include_router(api_v1)
    if not settings.is_production:
        app.include_router(dev_router, prefix="/api/v1")

    @app.get("/health", include_in_schema=False)
    def liveness() -> dict[str, str]:
        """Unversioned liveness probe for containers / load balancers. No dependencies checked."""
        return {"status": "ok"}

    return app


app = create_app()
