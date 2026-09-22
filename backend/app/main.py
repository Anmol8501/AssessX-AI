import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.dev import router as dev_router
from app.api.v1.router import api_v1
from app.core.config import get_settings
from app.core.database import check_database
from app.core.errors import register_exception_handlers
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
    yield
    log.info("AssessX API stopping")


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level, settings.effective_log_format)

    app = FastAPI(
        title="AssessX API",
        version="0.1.0",
        docs_url="/docs" if not settings.is_production else None,
        redoc_url=None,
        lifespan=lifespan,
    )
    # Outermost so every request — including CORS preflights and errors — gets an id and a log line.
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,  # bearer tokens, not cookies
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
        expose_headers=["X-Request-ID"],
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
