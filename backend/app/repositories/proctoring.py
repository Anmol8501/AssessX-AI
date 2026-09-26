from sqlalchemy.orm import Session

from app.models.proctoring import ProctoringSession


class ProctoringRepository:
    """Proctoring sessions.

    There is no lookup here on purpose: a session is only ever reached through its attempt
    (`AssessmentAttempt.proctoring_session`), and the attempt has already been scoped to the
    signed-in candidate by `AttemptRepository`, so ownership is checked in exactly one place.
    """

    def __init__(self, db: Session) -> None:
        self.db = db

    def add(self, session: ProctoringSession) -> ProctoringSession:
        self.db.add(session)
        self.db.flush()
        return session
