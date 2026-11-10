"""Unit tests for Phase 2D Device Peripheral, USB storage, and Display schemas."""

from app.schemas.device import (
    DevicePeripheralReport,
    PeripheralPolicyResponse,
    PeripheralPolicyUpdateRequest,
    RemovableDriveSchema,
)


def test_removable_drive_schema():
    drive = RemovableDriveSchema(
        drive_letter="E:",
        volume_name="SECURE_USB",
        file_system="FAT32",
        is_blocked=False,
    )
    assert drive.drive_letter == "E:"
    assert drive.volume_name == "SECURE_USB"
    assert drive.is_blocked is False


def test_device_peripheral_report():
    drive = RemovableDriveSchema(
        drive_letter="F:",
        volume_name="BACKUP",
        file_system="NTFS",
        is_blocked=True,
    )
    report = DevicePeripheralReport(
        device_identifier="device-uuid-99999",
        storage_mode="BlockUnapprovedStorage",
        connected_removable_drives_count=1,
        removable_drives=[drive],
        monitor_count=1,
        primary_width=1920,
        primary_height=1080,
        has_virtual_display=False,
        is_remote_session_active=False,
        running_remote_tools_count=0,
        camera_detected=True,
        microphone_detected=True,
    )
    assert report.device_identifier == "device-uuid-99999"
    assert report.storage_mode == "BlockUnapprovedStorage"
    assert len(report.removable_drives) == 1
    assert report.removable_drives[0].is_blocked is True
    assert report.monitor_count == 1
    assert report.camera_detected is True


def test_peripheral_policy_response():
    policy = PeripheralPolicyResponse(
        id="peripheral-policy-test",
        version=1,
        storage_mode="BlockUnapprovedStorage",
        max_monitors=1,
        allow_virtual_displays=False,
        block_remote_sessions=True,
        block_remote_tools=True,
        require_camera=True,
        require_microphone=True,
        state="Active",
    )
    assert policy.version == 1
    assert policy.max_monitors == 1
    assert policy.state == "Active"


def test_peripheral_policy_update_request():
    req = PeripheralPolicyUpdateRequest(
        storage_mode="AuditOnly",
        max_monitors=2,
        allow_virtual_displays=False,
        block_remote_sessions=True,
        block_remote_tools=True,
        require_camera=True,
        require_microphone=True,
        admin_approved=True,
    )
    assert req.storage_mode == "AuditOnly"
    assert req.max_monitors == 2
    assert req.admin_approved is True
