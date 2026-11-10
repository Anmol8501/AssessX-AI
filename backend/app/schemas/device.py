"""Pydantic schemas for Phase 1A device identity and registration."""

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class DeviceRegisterRequest(BaseModel):
    """Payload sent by workstation to register or heart-beat device identity."""

    device_identifier: str = Field(
        min_length=16,
        max_length=64,
        description="Cryptographic device thumbprint",
    )
    hostname: str = Field(min_length=1, max_length=255)
    platform: str = Field(default="Windows", max_length=64)
    os_edition: str | None = Field(default=None, max_length=128)
    os_build: str | None = Field(default=None, max_length=64)


class DeviceResponse(BaseModel):
    """Registered device response representation."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    device_identifier: str
    hostname: str
    platform: str
    os_edition: str | None = None
    os_build: str | None = None
    status: str
    last_seen_at: datetime
    registered_by_id: uuid.UUID | None = None
    created_at: datetime


class DeviceListResponse(BaseModel):
    """List of registered workstations."""

    devices: list[DeviceResponse]
    total: int


class DeviceStatusUpdateRequest(BaseModel):
    """Admin request to change workstation status (e.g., ACTIVE, SUSPENDED, REVOKED)."""

    status: str = Field(min_length=3, max_length=32)


class DeviceSecurityEventCreate(BaseModel):
    """Payload for a single device security agent event."""

    event_type: str = Field(min_length=3, max_length=64)
    severity: str = Field(default="MEDIUM", min_length=3, max_length=10)
    category: str = Field(default="device_agent", max_length=32)
    details: dict[str, Any] = Field(default_factory=dict)


class DeviceSecurityEventsBatchRequest(BaseModel):
    """Batch ingestion of device security events from Phase 1C Security Agent."""

    events: list[DeviceSecurityEventCreate] = Field(..., min_length=1, max_length=100)


class DeviceSecurityEventsResponse(BaseModel):
    """Result of security event ingestion."""

    processed: int
    failed: int = 0
    message: str = "Events ingested successfully"


class ApplicationIdentitySchema(BaseModel):
    """Normalized application identity reported from Phase 2A workstation inventory."""

    application_id: str
    display_name: str
    executable_name: str
    executable_path: str
    publisher: str | None = None
    file_hash: str
    file_version: str | None = None
    signature_status: str = "Unknown"
    is_running: bool = False
    process_ids: list[int] = Field(default_factory=list)


class DeviceApplicationInventoryReport(BaseModel):
    """Workstation running application inventory report."""

    device_identifier: str
    total_applications: int
    applications: list[ApplicationIdentitySchema]


class AllowlistEntrySchema(BaseModel):
    """Allowlist authorization entry."""

    id: str
    name: str
    category: str
    rule_type: str
    rule_value: str
    action: str
    reason: str
    is_system_rule: bool = False


class DeviceAllowlistResponse(BaseModel):
    """Set of active allowlist rules configured for examination environments."""

    rules: list[AllowlistEntrySchema]
    total: int


class ApplicationPolicyApplyRequest(BaseModel):
    """Request to transition application control policy mode."""

    mode: str = Field(default="AuditMode", description="AuditMode or EnforcementMode")
    admin_approved: bool = Field(default=True)


class SystemUtilityItemSchema(BaseModel):
    """System utility catalog entry for Phase 2B."""

    utility_id: str
    display_name: str
    executable_name: str
    category: str
    criticality: str
    publisher: str | None = None
    file_hash: str | None = None
    is_installed: bool = False
    is_critical_protected: bool = False


class DeviceSystemUtilityReport(BaseModel):
    """Workstation system utility and shell restriction status report."""

    device_identifier: str
    total_utilities: int
    utilities: list[SystemUtilityItemSchema]
    powershell_mode: str = "DetectionOnly"
    cmd_mode: str = "DetectionOnly"
    task_manager_mode: str = "DetectionOnly"
    registry_tools_blocked: bool = False


class SystemUtilityPolicyResponse(BaseModel):
    """Active system utility restriction policy."""

    id: str
    version: int
    powershell_mode: str
    cmd_mode: str
    task_manager_mode: str
    registry_tools_blocked: bool
    candidate_account: str = "AssessXCandidate"
    state: str = "Active"


class SystemUtilityPolicyUpdateRequest(BaseModel):
    """Request to update system utility restriction policy."""

    powershell_mode: str = Field(default="DetectionOnly")
    cmd_mode: str = Field(default="DetectionOnly")
    task_manager_mode: str = Field(default="DetectionOnly")
    registry_tools_blocked: bool = Field(default=False)
    admin_approved: bool = Field(default=True)


class ShortcutItemSchema(BaseModel):
    """Keyboard shortcut catalog entry for Phase 2C."""

    id: str
    key_combination: str
    description: str
    category: str
    risk_level: str
    enforcement_type: str
    default_action: str
    is_kernel_restricted: bool = False
    target_interface: str


class DeviceNavigationReport(BaseModel):
    """Workstation keyboard shortcut and navigation restriction status report."""

    device_identifier: str
    windows_keys_blocked: bool = False
    run_dialog_blocked: bool = False
    search_interface_blocked: bool = False
    taskbar_navigation_blocked: bool = False
    desktop_surface_blocked: bool = False
    app_switching_blocked: bool = False
    accommodations_active_count: int = 0
    loss_of_focus_count: int = 0
    shortcuts_catalog: list[ShortcutItemSchema] = Field(default_factory=list)


class NavigationPolicyResponse(BaseModel):
    """Active keyboard shortcut and navigation control policy."""

    id: str
    version: int
    app_switching_blocked: bool
    windows_keys_blocked: bool
    task_view_blocked: bool
    screen_capture_blocked: bool
    browser_shortcuts_blocked: bool
    taskbar_navigation_blocked: bool
    run_dialog_blocked: bool
    search_interface_blocked: bool
    desktop_surface_blocked: bool
    accessibility_accommodations_allowed: bool
    state: str = "Active"


class NavigationPolicyUpdateRequest(BaseModel):
    """Request to update navigation and shortcut restriction policy."""

    app_switching_blocked: bool = Field(default=True)
    windows_keys_blocked: bool = Field(default=True)
    task_view_blocked: bool = Field(default=True)
    screen_capture_blocked: bool = Field(default=True)
    browser_shortcuts_blocked: bool = Field(default=True)
    taskbar_navigation_blocked: bool = Field(default=True)
    run_dialog_blocked: bool = Field(default=True)
    search_interface_blocked: bool = Field(default=True)
    desktop_surface_blocked: bool = Field(default=True)
    accessibility_accommodations_allowed: bool = Field(default=True)
    admin_approved: bool = Field(default=True)


class RemovableDriveSchema(BaseModel):
    """Removable USB drive descriptor for Phase 2D."""

    drive_letter: str
    volume_name: str
    file_system: str
    is_blocked: bool = False


class DevicePeripheralReport(BaseModel):
    """Workstation USB storage, display topology, and remote access report."""

    device_identifier: str
    storage_mode: str = "AuditOnly"
    connected_removable_drives_count: int = 0
    removable_drives: list[RemovableDriveSchema] = Field(default_factory=list)
    monitor_count: int = 1
    primary_width: int = 1920
    primary_height: int = 1080
    has_virtual_display: bool = False
    is_remote_session_active: bool = False
    running_remote_tools_count: int = 0
    camera_detected: bool = True
    microphone_detected: bool = True


class PeripheralPolicyResponse(BaseModel):
    """Active USB, display, and remote access restriction policy."""

    id: str
    version: int
    storage_mode: str
    max_monitors: int
    allow_virtual_displays: bool
    block_remote_sessions: bool
    block_remote_tools: bool
    require_camera: bool
    require_microphone: bool
    state: str = "Active"


class PeripheralPolicyUpdateRequest(BaseModel):
    """Request to update peripheral and remote-access policy."""

    storage_mode: str = Field(default="AuditOnly")
    max_monitors: int = Field(default=1)
    allow_virtual_displays: bool = Field(default=False)
    block_remote_sessions: bool = Field(default=True)
    block_remote_tools: bool = Field(default=True)
    require_camera: bool = Field(default=True)
    require_microphone: bool = Field(default=True)
    admin_approved: bool = Field(default=True)
