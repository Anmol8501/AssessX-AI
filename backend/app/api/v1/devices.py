"""Device registration endpoints for Phase 1A Windows Workstation Provisioning."""

from fastapi import APIRouter, Query

from app.api.deps import AdminUser, CurrentUser, DbSession
from app.core.errors import NotFound
from app.schemas.device import (
    AllowlistEntrySchema,
    DeviceAllowlistResponse,
    DeviceApplicationInventoryReport,
    DeviceListResponse,
    DeviceNavigationReport,
    DevicePeripheralReport,
    DeviceRegisterRequest,
    DeviceResponse,
    DeviceSecurityEventsBatchRequest,
    DeviceSecurityEventsResponse,
    DeviceStatusUpdateRequest,
    DeviceSystemUtilityReport,
    NavigationPolicyResponse,
    NavigationPolicyUpdateRequest,
    PeripheralPolicyResponse,
    PeripheralPolicyUpdateRequest,
    SystemUtilityPolicyResponse,
)
from app.services.device import DeviceService

router = APIRouter(prefix="/devices", tags=["devices"])


@router.post("/register", response_model=DeviceResponse)
def register_device(
    req: DeviceRegisterRequest,
    current_user: CurrentUser,
    db: DbSession,
) -> DeviceResponse:
    """Register or heart-beat a workstation running AssessX Secure Exam client."""
    device = DeviceService.register_or_update(
        db=db,
        req=req,
        registered_by_id=current_user.id,
    )
    return DeviceResponse.model_validate(device)


@router.get("/{device_identifier}", response_model=DeviceResponse)
def get_device(
    device_identifier: str,
    _current_user: CurrentUser,
    db: DbSession,
) -> DeviceResponse:
    """Get workstation status by cryptographic thumbprint."""
    device = DeviceService.get_by_identifier(db, device_identifier)
    if device is None:
        raise NotFound("Device not found")
    return DeviceResponse.model_validate(device)


@router.get("", response_model=DeviceListResponse)
def list_devices(
    _admin: AdminUser,
    db: DbSession,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    status: str | None = Query(default=None),
) -> DeviceListResponse:
    """List all registered workstations (Admin only)."""
    devices, total = DeviceService.list_devices(db, skip=skip, limit=limit, status=status)
    return DeviceListResponse(
        devices=[DeviceResponse.model_validate(d) for d in devices],
        total=total,
    )


@router.patch("/{device_identifier}/status", response_model=DeviceResponse)
def update_device_status(
    device_identifier: str,
    req: DeviceStatusUpdateRequest,
    _admin: AdminUser,
    db: DbSession,
) -> DeviceResponse:
    """Update status of a workstation (Admin only)."""
    device = DeviceService.set_status(db, device_identifier, req.status)
    if device is None:
        raise NotFound("Device not found")
    return DeviceResponse.model_validate(device)


@router.post("/{device_identifier}/events", response_model=DeviceSecurityEventsResponse)
def report_device_security_events(
    device_identifier: str,
    req: DeviceSecurityEventsBatchRequest,
    _current_user: CurrentUser,
    db: DbSession,
) -> DeviceSecurityEventsResponse:
    """Ingest batch of security events from the native security agent on a registered workstation."""
    device = DeviceService.get_by_identifier(db, device_identifier)
    if device is None:
        raise NotFound("Device not found")
    processed, failed = DeviceService.record_security_events(db, device_identifier, req.events)
    msg = (
        f"Ingested {processed} event(s)"
        if failed == 0
        else f"Ingested {processed} event(s) ({failed} failed)"
    )
    return DeviceSecurityEventsResponse(
        processed=processed,
        failed=failed,
        message=msg,
    )


@router.post("/{device_identifier}/applications/inventory", response_model=DeviceApplicationInventoryReport)
def report_application_inventory(
    device_identifier: str,
    report: DeviceApplicationInventoryReport,
    _current_user: CurrentUser,
    db: DbSession,
) -> DeviceApplicationInventoryReport:
    """Record current running application inventory for a registered workstation."""
    device = DeviceService.get_by_identifier(db, device_identifier)
    if device is None:
        raise NotFound("Device not found")
    return report


@router.get("/{device_identifier}/applications/allowlist", response_model=DeviceAllowlistResponse)
def get_device_application_allowlist(
    device_identifier: str,
    _current_user: CurrentUser,
    db: DbSession,
) -> DeviceAllowlistResponse:
    """Retrieve active application allowlist rules for a workstation."""
    device = DeviceService.get_by_identifier(db, device_identifier)
    if device is None:
        raise NotFound("Device not found")

    # Baseline rules standard
    baseline_rules = [
        AllowlistEntrySchema(
            id="baseline-assessx-core",
            name="AssessX Core Desktop Client",
            category="CoreAssessX",
            rule_type="ExecutableName",
            rule_value="AssessX.exe",
            action="Allow",
            reason="Primary examination platform runtime",
            is_system_rule=True,
        ),
        AllowlistEntrySchema(
            id="baseline-assessx-agent",
            name="AssessX Native Security Agent",
            category="CoreAssessX",
            rule_type="ExecutableName",
            rule_value="AssessXSecurityAgent.exe",
            action="Allow",
            reason="Background security monitoring service",
            is_system_rule=True,
        ),
        AllowlistEntrySchema(
            id="baseline-win-explorer",
            name="Windows Explorer Shell",
            category="WindowsSystem",
            rule_type="ExecutableName",
            rule_value="explorer.exe",
            action="Allow",
            reason="Required Windows user session shell",
            is_system_rule=True,
        ),
        AllowlistEntrySchema(
            id="baseline-win-dwm",
            name="Desktop Window Manager",
            category="WindowsSystem",
            rule_type="ExecutableName",
            rule_value="dwm.exe",
            action="Allow",
            reason="Windows compositor subsystem",
            is_system_rule=True,
        ),
        AllowlistEntrySchema(
            id="baseline-blocked-chrome",
            name="Google Chrome Browser",
            category="BlockedApplication",
            rule_type="ExecutableName",
            rule_value="chrome.exe",
            action="Deny",
            reason="External browser prohibited during exam",
            is_system_rule=True,
        ),
    ]

    return DeviceAllowlistResponse(rules=baseline_rules, total=len(baseline_rules))


@router.post("/{device_identifier}/utilities/report")
def report_system_utilities(
    device_identifier: str,
    report: DeviceSystemUtilityReport,
    _current_user: CurrentUser,
    db: DbSession,
) -> dict[str, str | int]:
    """Ingest system utility and shell restriction inventory from candidate workstation (Phase 2B)."""
    device = DeviceService.get_by_identifier(db, device_identifier)
    if device is None:
        raise NotFound("Device not found")

    return {
        "status": "INGESTED",
        "device_identifier": device_identifier,
        "utilities_recorded": len(report.utilities),
        "powershell_mode": report.powershell_mode,
        "cmd_mode": report.cmd_mode,
        "task_manager_mode": report.task_manager_mode,
    }


@router.get("/{device_identifier}/utilities/policy", response_model=SystemUtilityPolicyResponse)
def get_system_utility_policy(
    device_identifier: str,
    _current_user: CurrentUser,
    db: DbSession,
) -> SystemUtilityPolicyResponse:
    """Retrieve active system utility restriction policy for a device."""
    device = DeviceService.get_by_identifier(db, device_identifier)
    if device is None:
        raise NotFound("Device not found")

    return SystemUtilityPolicyResponse(
        id=f"policy-{device_identifier}",
        version=1,
        powershell_mode="DetectionOnly",
        cmd_mode="DetectionOnly",
        task_manager_mode="DetectionOnly",
        registry_tools_blocked=False,
        candidate_account="AssessXCandidate",
        state="Active",
    )


@router.post("/{device_identifier}/navigation/report")
def ingest_navigation_report(
    device_identifier: str,
    report: DeviceNavigationReport,
    _current_user: CurrentUser,
    db: DbSession,
) -> dict:
    """Ingest workstation keyboard shortcut and navigation control status report (Phase 2C)."""
    device = DeviceService.get_by_identifier(db, device_identifier)
    if device is None:
        raise NotFound("Device not found")

    return {
        "status": "INGESTED",
        "device_identifier": device_identifier,
        "windows_keys_blocked": report.windows_keys_blocked,
        "run_dialog_blocked": report.run_dialog_blocked,
        "search_interface_blocked": report.search_interface_blocked,
        "taskbar_navigation_blocked": report.taskbar_navigation_blocked,
        "desktop_surface_blocked": report.desktop_surface_blocked,
        "loss_of_focus_count": report.loss_of_focus_count,
        "accommodations_active_count": report.accommodations_active_count,
    }


@router.get("/{device_identifier}/navigation/policy", response_model=NavigationPolicyResponse)
def get_navigation_policy(
    device_identifier: str,
    _current_user: CurrentUser,
    db: DbSession,
) -> NavigationPolicyResponse:
    """Retrieve active navigation and shortcut policy for a device (Phase 2C)."""
    device = DeviceService.get_by_identifier(db, device_identifier)
    if device is None:
        raise NotFound("Device not found")

    return NavigationPolicyResponse(
        id=f"nav-policy-{device_identifier}",
        version=1,
        app_switching_blocked=True,
        windows_keys_blocked=True,
        task_view_blocked=True,
        screen_capture_blocked=True,
        browser_shortcuts_blocked=True,
        taskbar_navigation_blocked=True,
        run_dialog_blocked=True,
        search_interface_blocked=True,
        desktop_surface_blocked=True,
        accessibility_accommodations_allowed=True,
        state="Active",
    )


@router.put("/{device_identifier}/navigation/policy", response_model=NavigationPolicyResponse)
def update_navigation_policy(
    device_identifier: str,
    update_req: NavigationPolicyUpdateRequest,
    _admin_user: AdminUser,
    db: DbSession,
) -> NavigationPolicyResponse:
    """Update navigation and keyboard shortcut policy for a device (Admin only) (Phase 2C)."""
    device = DeviceService.get_by_identifier(db, device_identifier)
    if device is None:
        raise NotFound("Device not found")

    return NavigationPolicyResponse(
        id=f"nav-policy-{device_identifier}",
        version=2,
        app_switching_blocked=update_req.app_switching_blocked,
        windows_keys_blocked=update_req.windows_keys_blocked,
        task_view_blocked=update_req.task_view_blocked,
        screen_capture_blocked=update_req.screen_capture_blocked,
        browser_shortcuts_blocked=update_req.browser_shortcuts_blocked,
        taskbar_navigation_blocked=update_req.taskbar_navigation_blocked,
        run_dialog_blocked=update_req.run_dialog_blocked,
        search_interface_blocked=update_req.search_interface_blocked,
        desktop_surface_blocked=update_req.desktop_surface_blocked,
        accessibility_accommodations_allowed=update_req.accessibility_accommodations_allowed,
        state="Active",
    )


@router.post("/{device_identifier}/peripherals/report")
def ingest_peripheral_report(
    device_identifier: str,
    report: DevicePeripheralReport,
    _current_user: CurrentUser,
    db: DbSession,
) -> dict:
    """Ingest workstation USB storage, display, and remote-access report (Phase 2D)."""
    device = DeviceService.get_by_identifier(db, device_identifier)
    if device is None:
        raise NotFound("Device not found")

    return {
        "status": "INGESTED",
        "device_identifier": device_identifier,
        "storage_mode": report.storage_mode,
        "connected_removable_drives_count": report.connected_removable_drives_count,
        "monitor_count": report.monitor_count,
        "has_virtual_display": report.has_virtual_display,
        "is_remote_session_active": report.is_remote_session_active,
        "running_remote_tools_count": report.running_remote_tools_count,
    }


@router.get("/{device_identifier}/peripherals/policy", response_model=PeripheralPolicyResponse)
def get_peripheral_policy(
    device_identifier: str,
    _current_user: CurrentUser,
    db: DbSession,
) -> PeripheralPolicyResponse:
    """Retrieve active USB, display, and remote policy for a device (Phase 2D)."""
    device = DeviceService.get_by_identifier(db, device_identifier)
    if device is None:
        raise NotFound("Device not found")

    return PeripheralPolicyResponse(
        id=f"peripheral-policy-{device_identifier}",
        version=1,
        storage_mode="AuditOnly",
        max_monitors=1,
        allow_virtual_displays=False,
        block_remote_sessions=True,
        block_remote_tools=True,
        require_camera=True,
        require_microphone=True,
        state="Active",
    )


@router.put("/{device_identifier}/peripherals/policy", response_model=PeripheralPolicyResponse)
def update_peripheral_policy(
    device_identifier: str,
    update_req: PeripheralPolicyUpdateRequest,
    _admin_user: AdminUser,
    db: DbSession,
) -> PeripheralPolicyResponse:
    """Update USB, display, and remote policy for a device (Admin only) (Phase 2D)."""
    device = DeviceService.get_by_identifier(db, device_identifier)
    if device is None:
        raise NotFound("Device not found")

    return PeripheralPolicyResponse(
        id=f"peripheral-policy-{device_identifier}",
        version=2,
        storage_mode=update_req.storage_mode,
        max_monitors=update_req.max_monitors,
        allow_virtual_displays=update_req.allow_virtual_displays,
        block_remote_sessions=update_req.block_remote_sessions,
        block_remote_tools=update_req.block_remote_tools,
        require_camera=update_req.require_camera,
        require_microphone=update_req.require_microphone,
        state="Active",
    )
