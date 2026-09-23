from fastapi import APIRouter

from app.api.v1 import assessments, auth, candidates, health, users

api_v1 = APIRouter(prefix="/api/v1")
api_v1.include_router(health.router)
api_v1.include_router(auth.router)
api_v1.include_router(users.router)
api_v1.include_router(assessments.router)
api_v1.include_router(candidates.router)
