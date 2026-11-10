"""Device service handling workstation registration and validation."""

import uuid
from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.base import utcnow
from app.models.device import Device
from app.models.security_event import SecurityEvent
from app.schemas.device import DeviceRegisterRequest, DeviceSecurityEventCreate


class DeviceService:
    @staticmethod
    def register_or_update(
        db: Session,
        req: DeviceRegisterRequest,
        registered_by_id: uuid.UUID | None = None,
    ) -> Device:
        """Register a workstation or update its heart-beat / telemetry idempotently."""
        stmt = select(Device).where(Device.device_identifier == req.device_identifier)
        device = db.execute(stmt).scalar_one_or_none()

        now = utcnow()
        if device is None:
            device = Device(
                device_identifier=req.device_identifier,
                hostname=req.hostname,
                platform=req.platform,
                os_edition=req.os_edition,
                os_build=req.os_build,
                status="ACTIVE",
                last_seen_at=now,
                registered_by_id=registered_by_id,
            )
            db.add(device)
        else:
            device.hostname = req.hostname
            device.platform = req.platform
            device.os_edition = req.os_edition
            device.os_build = req.os_build
            device.last_seen_at = now
            if registered_by_id is not None and device.registered_by_id is None:
                device.registered_by_id = registered_by_id

        db.commit()
        db.refresh(device)
        return device

    @staticmethod
    def get_by_identifier(db: Session, device_identifier: str) -> Device | None:
        """Fetch device by cryptographic thumbprint."""
        stmt = select(Device).where(Device.device_identifier == device_identifier)
        return db.execute(stmt).scalar_one_or_none()

    @staticmethod
    def list_devices(
        db: Session,
        skip: int = 0,
        limit: int = 100,
        status: str | None = None,
    ) -> tuple[Sequence[Device], int]:
        """List registered workstations with pagination and optional status filter."""
        base_query = select(Device)
        count_query = select(func.count(Device.id))

        if status:
            base_query = base_query.where(Device.status == status)
            count_query = count_query.where(Device.status == status)

        total = db.execute(count_query).scalar_one()
        devices = (
            db.execute(base_query.order_by(Device.last_seen_at.desc()).offset(skip).limit(limit))
            .scalars()
            .all()
        )
        return devices, total

    @staticmethod
    def set_status(db: Session, device_identifier: str, status: str) -> Device | None:
        """Update authorization status of a workstation."""
        device = DeviceService.get_by_identifier(db, device_identifier)
        if device is None:
            return None
        device.status = status
        db.commit()
        db.refresh(device)
        return device

    @staticmethod
    def record_security_events(
        db: Session,
        device_identifier: str,
        events: list[DeviceSecurityEventCreate],
    ) -> tuple[int, int]:
        """Ingest batch of security events from device agent and update last_seen_at."""
        device = DeviceService.get_by_identifier(db, device_identifier)
        if device is None:
            return 0, len(events)

        now = utcnow()
        device.last_seen_at = now
        processed = 0
        failed = 0

        for ev in events:
            sev = ev.severity.upper()
            if sev not in {"LOW", "MEDIUM", "HIGH", "CRITICAL"}:
                sev = "MEDIUM"
            try:
                sec_event = SecurityEvent(
                    event_type=ev.event_type[:64],
                    severity=sev,
                    category=ev.category[:32] if ev.category else "device_agent",
                    target_type="device",
                    target_id=device_identifier[:64],
                    details=ev.details,
                    occurred_at=now,
                )
                db.add(sec_event)
                processed += 1
            except Exception:
                failed += 1

        db.commit()
        return processed, failed
