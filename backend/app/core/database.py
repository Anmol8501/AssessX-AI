"""Database engine and request-scoped sessions.

One process-wide engine (a connection pool), one short-lived `Session` per request. Sessions
are never shared across requests or stored globally.
"""

from collections.abc import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings


def build_engine(url: str) -> Engine:
    # pool_pre_ping drops stale connections (e.g. after a database restart) instead of
    # handing them to a request; pool_recycle keeps long-lived pools healthy behind proxies.
    return create_engine(url, pool_pre_ping=True, pool_recycle=1800, pool_size=5, max_overflow=10)


engine = build_engine(get_settings().database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, class_=Session)


def check_database(target: Engine = engine) -> bool:
    """True when a trivial query succeeds. Used by the health endpoint and startup."""
    try:
        with target.connect() as connection:
            connection.execute(text("SELECT 1"))
        return True
    except SQLAlchemyError:
        return False


def get_db() -> Generator[Session, None, None]:
    """Request-scoped database session: commits when the request succeeds, rolls back otherwise."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
