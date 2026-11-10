"""Unit tests for Phase 2C Device Navigation & Keyboard Shortcut schemas and models."""

from app.schemas.device import (
    DeviceNavigationReport,
    NavigationPolicyResponse,
    NavigationPolicyUpdateRequest,
    ShortcutItemSchema,
)


def test_shortcut_item_schema():
    sc = ShortcutItemSchema(
        id="sc-alt-tab",
        key_combination="Alt + Tab",
        description="Windows Task Switcher",
        category="ApplicationSwitching",
        risk_level="Severe",
        enforcement_type="NativeKeyboardFilter",
        default_action="Block",
        is_kernel_restricted=False,
        target_interface="TaskSwitcher",
    )
    assert sc.id == "sc-alt-tab"
    assert sc.key_combination == "Alt + Tab"
    assert sc.default_action == "Block"
    assert sc.is_kernel_restricted is False


def test_device_navigation_report():
    sc = ShortcutItemSchema(
        id="sc-ctrl-alt-del",
        key_combination="Ctrl + Alt + Delete",
        description="SAS",
        category="TaskAndSessionControl",
        risk_level="CriticalAttention",
        enforcement_type="KernelRestricted",
        default_action="KernelRestricted",
        is_kernel_restricted=True,
        target_interface="WinlogonSurface",
    )
    report = DeviceNavigationReport(
        device_identifier="test-device-uuid-12345",
        windows_keys_blocked=True,
        run_dialog_blocked=True,
        search_interface_blocked=True,
        taskbar_navigation_blocked=True,
        desktop_surface_blocked=True,
        app_switching_blocked=True,
        accommodations_active_count=1,
        loss_of_focus_count=2,
        shortcuts_catalog=[sc],
    )
    assert report.device_identifier == "test-device-uuid-12345"
    assert report.windows_keys_blocked is True
    assert report.loss_of_focus_count == 2
    assert len(report.shortcuts_catalog) == 1
    assert report.shortcuts_catalog[0].is_kernel_restricted is True


def test_navigation_policy_response():
    policy = NavigationPolicyResponse(
        id="nav-policy-test",
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
    assert policy.version == 1
    assert policy.state == "Active"
    assert policy.accessibility_accommodations_allowed is True


def test_navigation_policy_update_request():
    req = NavigationPolicyUpdateRequest(
        app_switching_blocked=True,
        windows_keys_blocked=True,
        accessibility_accommodations_allowed=True,
        admin_approved=True,
    )
    assert req.admin_approved is True
    assert req.accessibility_accommodations_allowed is True
