from fastapi import APIRouter

from app.api.v1 import (
    admin_attempts,
    admin_monitoring,
    admin_reviews,
    assessments,
    attempts,
    auth,
    candidate_interviews,
    candidates,
    health,
    interview_calls,
    interview_reports,
    interviews,
    proctoring,
    realtime,
    users,
    ws,
    ws_calls,
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
api_v1.include_router(admin_attempts.router)
api_v1.include_router(admin_reviews.router)
# Before `interviews`: `/interviews/reports` must not be read as `/interviews/{interview_id}`.
api_v1.include_router(interview_reports.router)
api_v1.include_router(interviews.router)
api_v1.include_router(interview_calls.admin_router)
api_v1.include_router(interview_calls.candidate_router)
api_v1.include_router(candidate_interviews.router)
api_v1.include_router(realtime.router)
api_v1.include_router(ws.router)
api_v1.include_router(ws_calls.router)
