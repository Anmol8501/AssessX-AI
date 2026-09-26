from fastapi import APIRouter

from app.api.v1 import (
    admin_monitoring,
    assessments,
    attempts,
    auth,
    candidates,
    health,
    proctoring,
    users,
    ws,
)

api_v1 = APIRouter(prefix="/api/v1")
api_v1.include_router(health.router)
api_v1.include_router(auth.router)
api_v1.include_router(users.router)
api_v1.include_router(assessments.router)
api_v1.include_router(candidates.router)
api_v1.include_router(attempts.router)
api_v1.include_router(proctoring.router)
api_v1.include_router(admin_monitoring.router)
api_v1.include_router(ws.router)
