from typing import Literal

from fastapi import APIRouter, Response
from pydantic import BaseModel

from app.core.database import check_database

router = APIRouter(prefix="/health", tags=["meta"])


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    database: Literal["ok", "unavailable"]


@router.get("", response_model=HealthResponse)
def health(response: Response) -> HealthResponse:
    """Liveness plus a database probe. 503 when the database cannot be reached."""
    database_ok = check_database()
    if not database_ok:
        response.status_code = 503
    return HealthResponse(
        status="ok" if database_ok else "degraded", database="ok" if database_ok else "unavailable"
    )
