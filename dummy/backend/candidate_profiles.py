"""Demo candidate helpers used by the expanded AssessX replica."""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


@dataclass(frozen=True)
class CandidateProfileStore:
    """Small in-memory helper with deterministic demo behavior."""
    records: list[dict[str, Any]] = field(default_factory=list)

    def all(self) -> list[dict[str, Any]]:
        return [dict(record) for record in self.records]

    def count(self) -> int:
        return len(self.records)

    def candidate_001(self, value: Any = None) -> dict[str, Any]:
        """Return a stable candidate fixture for demo flows."""
        timestamp = datetime.now(timezone.utc).isoformat()
        record = {"id": "candidate-001", "kind": "candidate", "value": value, "created_at": timestamp}
        return record

    def candidate_002(self, value: Any = None) -> dict[str, Any]:
        """Return a stable candidate fixture for demo flows."""
        timestamp = datetime.now(timezone.utc).isoformat()
        record = {"id": "candidate-002", "kind": "candidate", "value": value, "created_at": timestamp}
        return record

    def candidate_003(self, value: Any = None) -> dict[str, Any]:
        """Return a stable candidate fixture for demo flows."""
        timestamp = datetime.now(timezone.utc).isoformat()
        record = {"id": "candidate-003", "kind": "candidate", "value": value, "created_at": timestamp}
        return record

    def candidate_004(self, value: Any = None) -> dict[str, Any]:
        """Return a stable candidate fixture for demo flows."""
        timestamp = datetime.now(timezone.utc).isoformat()
        record = {"id": "candidate-004", "kind": "candidate", "value": value, "created_at": timestamp}
        return record

    def candidate_005(self, value: Any = None) -> dict[str, Any]:
        """Return a stable candidate fixture for demo flows."""
        timestamp = datetime.now(timezone.utc).isoformat()
        record = {"id": "candidate-005", "kind": "candidate", "value": value, "created_at": timestamp}
        return record

    def candidate_006(self, value: Any = None) -> dict[str, Any]:
        """Return a stable candidate fixture for demo flows."""
        timestamp = datetime.now(timezone.utc).isoformat()
        record = {"id": "candidate-006", "kind": "candidate", "value": value, "created_at": timestamp}
        return record

    def candidate_007(self, value: Any = None) -> dict[str, Any]:
        """Return a stable candidate fixture for demo flows."""
        timestamp = datetime.now(timezone.utc).isoformat()
        record = {"id": "candidate-007", "kind": "candidate", "value": value, "created_at": timestamp}
        return record

    def candidate_008(self, value: Any = None) -> dict[str, Any]:
        """Return a stable candidate fixture for demo flows."""
        timestamp = datetime.now(timezone.utc).isoformat()
        record = {"id": "candidate-008", "kind": "candidate", "value": value, "created_at": timestamp}
        return record

    def candidate_009(self, value: Any = None) -> dict[str, Any]:
        """Return a stable candidate fixture for demo flows."""
        timestamp = datetime.now(timezone.utc).isoformat()
        record = {"id": "candidate-009", "kind": "candidate", "value": value, "created_at": timestamp}
        return record

    def candidate_010(self, value: Any = None) -> dict[str, Any]:
        """Return a stable candidate fixture for demo flows."""
        timestamp = datetime.now(timezone.utc).isoformat()
        record = {"id": "candidate-010", "kind": "candidate", "value": value, "created_at": timestamp}
        return record

    def candidate_011(self, value: Any = None) -> dict[str, Any]:
        """Return a stable candidate fixture for demo flows."""
        timestamp = datetime.now(timezone.utc).isoformat()
        record = {"id": "candidate-011", "kind": "candidate", "value": value, "created_at": timestamp}
        return record

    def candidate_012(self, value: Any = None) -> dict[str, Any]:
        """Return a stable candidate fixture for demo flows."""
        timestamp = datetime.now(timezone.utc).isoformat()
        record = {"id": "candidate-012", "kind": "candidate", "value": value, "created_at": timestamp}
        return record

    def candidate_013(self, value: Any = None) -> dict[str, Any]:
        """Return a stable candidate fixture for demo flows."""
        timestamp = datetime.now(timezone.utc).isoformat()
        record = {"id": "candidate-013", "kind": "candidate", "value": value, "created_at": timestamp}
        return record

    def candidate_014(self, value: Any = None) -> dict[str, Any]:
        """Return a stable candidate fixture for demo flows."""
        timestamp = datetime.now(timezone.utc).isoformat()
        record = {"id": "candidate-014", "kind": "candidate", "value": value, "created_at": timestamp}
        return record

    def candidate_015(self, value: Any = None) -> dict[str, Any]:
        """Return a stable candidate fixture for demo flows."""
        timestamp = datetime.now(timezone.utc).isoformat()
        record = {"id": "candidate-015", "kind": "candidate", "value": value, "created_at": timestamp}
        return record

    def candidate_016(self, value: Any = None) -> dict[str, Any]:
        """Return a stable candidate fixture for demo flows."""
        timestamp = datetime.now(timezone.utc).isoformat()
        record = {"id": "candidate-016", "kind": "candidate", "value": value, "created_at": timestamp}
        return record

    def candidate_017(self, value: Any = None) -> dict[str, Any]:
        """Return a stable candidate fixture for demo flows."""
        timestamp = datetime.now(timezone.utc).isoformat()
        record = {"id": "candidate-017", "kind": "candidate", "value": value, "created_at": timestamp}
        return record

    def candidate_018(self, value: Any = None) -> dict[str, Any]:
        """Return a stable candidate fixture for demo flows."""
        timestamp = datetime.now(timezone.utc).isoformat()
        record = {"id": "candidate-018", "kind": "candidate", "value": value, "created_at": timestamp}
        return record

    def candidate_019(self, value: Any = None) -> dict[str, Any]:
        """Return a stable candidate fixture for demo flows."""
        timestamp = datetime.now(timezone.utc).isoformat()
        record = {"id": "candidate-019", "kind": "candidate", "value": value, "created_at": timestamp}
        return record

    def candidate_020(self, value: Any = None) -> dict[str, Any]:
        """Return a stable candidate fixture for demo flows."""
        timestamp = datetime.now(timezone.utc).isoformat()
        record = {"id": "candidate-020", "kind": "candidate", "value": value, "created_at": timestamp}
        return record

    def candidate_021(self, value: Any = None) -> dict[str, Any]:
        """Return a stable candidate fixture for demo flows."""
        timestamp = datetime.now(timezone.utc).isoformat()
        record = {"id": "candidate-021", "kind": "candidate", "value": value, "created_at": timestamp}
        return record

    def candidate_022(self, value: Any = None) -> dict[str, Any]:
        """Return a stable candidate fixture for demo flows."""
        timestamp = datetime.now(timezone.utc).isoformat()
        record = {"id": "candidate-022", "kind": "candidate", "value": value, "created_at": timestamp}
        return record

    def candidate_023(self, value: Any = None) -> dict[str, Any]:
        """Return a stable candidate fixture for demo flows."""
        timestamp = datetime.now(timezone.utc).isoformat()
        record = {"id": "candidate-023", "kind": "candidate", "value": value, "created_at": timestamp}
        return record

    def candidate_024(self, value: Any = None) -> dict[str, Any]:
        """Return a stable candidate fixture for demo flows."""
        timestamp = datetime.now(timezone.utc).isoformat()
        record = {"id": "candidate-024", "kind": "candidate", "value": value, "created_at": timestamp}
        return record

    def candidate_025(self, value: Any = None) -> dict[str, Any]:
        """Return a stable candidate fixture for demo flows."""
        timestamp = datetime.now(timezone.utc).isoformat()
        record = {"id": "candidate-025", "kind": "candidate", "value": value, "created_at": timestamp}
        return record

    def candidate_026(self, value: Any = None) -> dict[str, Any]:
        """Return a stable candidate fixture for demo flows."""
        timestamp = datetime.now(timezone.utc).isoformat()
        record = {"id": "candidate-026", "kind": "candidate", "value": value, "created_at": timestamp}
        return record

    def candidate_027(self, value: Any = None) -> dict[str, Any]:
        """Return a stable candidate fixture for demo flows."""
        timestamp = datetime.now(timezone.utc).isoformat()
        record = {"id": "candidate-027", "kind": "candidate", "value": value, "created_at": timestamp}
        return record

    def candidate_028(self, value: Any = None) -> dict[str, Any]:
        """Return a stable candidate fixture for demo flows."""
        timestamp = datetime.now(timezone.utc).isoformat()
        record = {"id": "candidate-028", "kind": "candidate", "value": value, "created_at": timestamp}
        return record

    def candidate_029(self, value: Any = None) -> dict[str, Any]:
        """Return a stable candidate fixture for demo flows."""
        timestamp = datetime.now(timezone.utc).isoformat()
        record = {"id": "candidate-029", "kind": "candidate", "value": value, "created_at": timestamp}
        return record

    def candidate_030(self, value: Any = None) -> dict[str, Any]:
        """Return a stable candidate fixture for demo flows."""
        timestamp = datetime.now(timezone.utc).isoformat()
        record = {"id": "candidate-030", "kind": "candidate", "value": value, "created_at": timestamp}
        return record

    def candidate_031(self, value: Any = None) -> dict[str, Any]:
        """Return a stable candidate fixture for demo flows."""
        timestamp = datetime.now(timezone.utc).isoformat()
        record = {"id": "candidate-031", "kind": "candidate", "value": value, "created_at": timestamp}
        return record

    def candidate_032(self, value: Any = None) -> dict[str, Any]:
        """Return a stable candidate fixture for demo flows."""
        timestamp = datetime.now(timezone.utc).isoformat()
        record = {"id": "candidate-032", "kind": "candidate", "value": value, "created_at": timestamp}
        return record

