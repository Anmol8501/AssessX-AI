"""A candidate's working code for one coding question of one attempt (coding assessments, stage C3).

Autosaved by the coding page (debounced, never per keystroke), restored when the candidate comes back.
One row per (attempt, question); `revision` increases with every save, and a save names the revision it
was based on, so a stale tab cannot overwrite newer code. Only the attempt's own candidate can read or
write it. A draft is not a submission and is never scored.
"""

import uuid

from sqlalchemy import CheckConstraint, ForeignKey, Integer, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class CodingDraft(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "coding_drafts"
    __table_args__ = (
        UniqueConstraint("attempt_id", "question_id", name="uq_coding_drafts_attempt_question"),
        CheckConstraint("char_length(source) <= 65536", name="ck_coding_drafts_source_size"),
        CheckConstraint("revision > 0", name="ck_coding_drafts_revision"),
    )

    attempt_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("assessment_attempts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    question_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("questions.id", ondelete="CASCADE"), nullable=False
    )
    language: Mapped[str] = mapped_column(String(20), nullable=False)
    source: Mapped[str] = mapped_column(Text, nullable=False, default="")
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
