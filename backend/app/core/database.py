"""Database engine and request-scoped sessions.

One process-wide engine (a connection pool), one short-lived `Session` per request. Sessions
are never shared across requests or stored globally.

**The commit is owned by middleware, not by the dependency.** A `yield` dependency's cleanup runs
after the response has been sent, which meant a client issuing its next request immediately did
not reliably see its own writes: signing in and calling an endpoint could return "session
expired", and a row written by one call could be missing from the next. `DatabaseSessionMiddleware`
commits while the response is being sent instead, so read-your-writes holds for a client that does
not pause between requests.
"""

from typing import Any

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker
from starlette.requests import Request

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


def get_db(request: Request) -> Session:
    """The request's session, opened on first use.

    Committing and closing belong to `DatabaseSessionMiddleware`; a request that never touches
    the database never opens a session at all.
    """
    state = request.scope.setdefault("state", {})
    db = state.get("db")
    if db is None:
        db = SessionLocal()
        state["db"] = db
    return db


class DatabaseSessionMiddleware:
    """Owns the request's session so that its transaction commits before the response leaves.

    The commit is attached to `http.response.start` rather than to the end of the ASGI call: by
    the time the response begins, the handler has finished and produced its body, but nothing has
    reached the client yet. Committing there is what makes a write visible to whatever the client
    does next.

    A handled error still commits, matching the previous behaviour and relied upon deliberately —
    an attempt that is refused *because* the server just marked it expired must keep that
    transition. Only an exception escaping the application rolls the transaction back.
    """

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        state = scope.setdefault("state", {})
        state["db"] = None
        committed = False

        async def send_wrapper(message: dict[str, Any]) -> None:
            nonlocal committed
            if message["type"] == "http.response.start" and not committed:
                committed = True
                session: Session | None = state.get("db")
                if session is not None:
                    session.commit()
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except BaseException:
            session = state.get("db")
            if session is not None:
                session.rollback()
            raise
        finally:
            session = state.get("db")
            if session is not None:
                session.close()
            state["db"] = None
