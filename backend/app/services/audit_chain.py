"""Verifies the tamper-evident audit hash chain (Phase 8 final, CX-11).

The database computes each row's `entry_hash` on insert (trigger `audit_logs_chain`, migration 0028) as
SHA-256 over the previous row's hash and the row's canonical content. Verification recomputes every hash in
SQL with the same function and reports the first rows where either the stored hash or the link to the
previous row does not match — a changed, deleted or inserted row breaks the chain from that point on.

This protects against changes made behind the application's back (with a database tool). It does not stop
someone with full database rights from rebuilding the whole chain; for that, keep the periodic
`entry_hash` checkpoints the maintenance job logs (docs/SECURITY-OPERATIONS.md).
"""

from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.orm import Session

_VERIFY = text(
    """
    WITH chain AS (
        SELECT seq, entry_hash, prev_hash,
               lag(entry_hash) OVER (ORDER BY seq) AS expected_prev,
               encode(sha256(convert_to(prev_hash || '|' || audit_canonical(
                   id, actor_id, action, attempt_id, assessment_id, interview_id, interview_session_id,
                   occurred_at, details, request_id, client_ip), 'UTF8')), 'hex') AS recomputed
        FROM audit_logs
        WHERE seq IS NOT NULL
    )
    SELECT seq FROM chain
    WHERE entry_hash IS DISTINCT FROM recomputed
       OR prev_hash IS DISTINCT FROM coalesce(expected_prev, repeat('0', 64))
    ORDER BY seq
    LIMIT 20
    """
)


@dataclass(frozen=True)
class ChainResult:
    verified: bool
    rows_checked: int
    broken_at: list[int]
    head_seq: int | None
    head_hash: str | None


def verify_chain(db: Session) -> ChainResult:
    broken = [row[0] for row in db.execute(_VERIFY)]
    count, head_seq = db.execute(
        text("SELECT count(*), max(seq) FROM audit_logs WHERE seq IS NOT NULL")
    ).one()
    head_hash = (
        db.scalar(text("SELECT entry_hash FROM audit_logs WHERE seq = :s"), {"s": head_seq})
        if head_seq
        else None
    )
    unchained = db.scalar(text("SELECT count(*) FROM audit_logs WHERE seq IS NULL")) or 0
    return ChainResult(
        verified=not broken and unchained == 0,
        rows_checked=int(count or 0),
        broken_at=list(broken),
        head_seq=head_seq,
        head_hash=head_hash,
    )
