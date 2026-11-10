# AssessX — Phase 2 Knowledge Base
## Advanced Windows Security Enforcement

**Project:** AssessX  
**Phase:** 2 of 4  
**Phase Name:** Advanced Windows Security Enforcement  
**Platform:** Windows  
**Primary Stack:** Tauri + React + TypeScript + Rust  
**Native Security Component:** Rust-based AssessX Security Agent  
**Backend:** FastAPI + PostgreSQL (Supabase)  
**Document Type:** Technical Knowledge Base / Product and Implementation Specification  
**Status:** Planning / Specification

---

# 1. Phase 2 — Overview

## 1.1 Purpose

Phase 2 strengthens the Windows examination environment established in Phase 1.

Phase 1 establishes the foundation:

- Windows compatibility and device provisioning.
- Candidate account preparation.
- Device registration.
- Secure shell and examination startup.
- Native Security Agent.
- Secure communication between the desktop application and Security Agent.
- Device compliance and component integrity monitoring.
- Controlled recovery and restoration.

Phase 2 builds upon this foundation by introducing more comprehensive operating-system-level restrictions.

The primary objective is to reduce the candidate's ability to leave the AssessX examination environment, launch unauthorized applications, access system utilities, use prohibited external storage, change display configurations, or establish unauthorized remote-access sessions.

These restrictions must be implemented through supported Windows security mechanisms wherever possible.

**Important:** Application-level restrictions, fullscreen mode, and JavaScript keyboard event handlers alone are not sufficient to secure a Windows examination environment.

## 1.2 Product Vision

During a secured examination:

1. AssessX should remain the candidate's primary interface.
2. Only approved applications and system components should be available according to the examination policy.
3. Unauthorized command interpreters and system utilities should be restricted.
4. Unapproved keyboard shortcuts and navigation paths should be restricted where supported.
5. Unauthorized USB storage access should be controlled.
6. Display and peripheral configurations should remain within the permitted policy.
7. Unauthorized remote-access tools and sessions should be detected or restricted according to the applied policy.
8. The Security Agent should monitor the security state.
9. Policy violations and configuration changes should be recorded.
10. Authorized administrator recovery must remain possible.

The goal is not to disable Windows indiscriminately. The goal is to create a predictable, controlled, recoverable examination environment.

## 1.3 Relationship Between the Four Phases

| Phase | Name | Primary responsibility |
|---|---|---|
| Phase 1 | Windows Secure Environment Foundation | Provisioning, secure shell, Security Agent |
| Phase 2 | Advanced Windows Security Enforcement | OS-level restrictions and security policies |
| Phase 3 | Institutional & Administrator Control | Activation, exit authorization, remote policy management |
| Phase 4 | Security Validation & Production Readiness | Penetration testing, independent audit, rollout |

Phase 2 must reuse the infrastructure created in Phase 1.

It must not introduce a second device-management system, a competing Security Agent, or a duplicate secure-shell architecture.

---

# 2. Core Design Principles

## 2.1 Windows-first development

Windows is the primary platform for the first complete AssessX product.

Linux support is not part of this phase.

## 2.2 Operating-system-level enforcement

Use supported Windows security and policy mechanisms rather than depending entirely on application-level restrictions.

Potential mechanisms include:

- Windows Assigned Access, where supported.
- Windows Shell Launcher, where supported.
- Group Policy.
- Local Security Policy.
- Windows application-control technologies.
- Windows device-installation and removable-storage policies.
- Windows firewall and network security policies.
- Supported Windows management interfaces.

The actual mechanism must be selected after checking Windows edition, licensing, device configuration, and the intended deployment model.

## 2.3 Least privilege

The candidate should normally use a dedicated standard Windows account.

The candidate account must not receive unnecessary administrative privileges.

Privileged policy operations should be performed through an appropriately authorized administrative context.

## 2.4 Explicit authorization

Every system-level policy change must be:

- Previewed before application where practical.
- Explicitly authorized.
- Validated before execution.
- Recorded in a change journal.
- Verified after application.
- Reversible wherever technically possible.

## 2.5 Reliability before aggressive lockdown

A failed security policy must not permanently damage the Windows installation.

Every policy must have:

- A clear purpose.
- A defined scope.
- A supported implementation mechanism.
- A verification method.
- A failure-handling strategy.
- A recovery or rollback procedure.

## 2.6 Detection versus prevention

AssessX must distinguish between:

- Preventing an action through an OS-enforced policy.
- Detecting that an action was attempted.
- Detecting a configuration change after it occurred.
- Reporting a suspicious event.

These are different capabilities.

Do not describe a detection-only feature as prevention.

---

# 3. Phase 2 Architecture

## 3.1 High-Level Architecture

Phase 2 extends the existing Phase 1 architecture.

```text
                 WINDOWS DEVICE
                       |
                       v
             ASSESSX SECURE SHELL
                       |
                       v
             ASSESSX DESKTOP APP
                       |
                       |
                AUTHENTICATED IPC
                       |
                       v
             ASSESSX SECURITY AGENT
                       |
          +------------+-------------+
          |            |             |
          v            v             v
      POLICY        SECURITY       DEVICE
      MANAGER       MONITOR        MONITOR
          |            |             |
          +------------+-------------+
                       |
                       v
             WINDOWS POLICY LAYER
                       |
          +------------+-------------+
          |            |             |
          v            v             v
     APPLICATION    SYSTEM        DEVICE /
     CONTROL        RESTRICTIONS  NETWORK CONTROL
                       |
                       v
               POLICY VERIFICATION
                       |
                       v
              SECURITY EVENT ENGINE
                       |
                       v
              ASSESSX FASTAPI BACKEND
                       |
                       v
                 ADMINISTRATION
```

## 3.2 Main Components

### A. Policy Manager

Responsible for managing examination security policies.

### B. Application Control Manager

Responsible for approved-application policies and application allowlisting.

### C. System Restriction Manager

Responsible for restrictions on command interpreters, system utilities, and supported navigation paths.

### D. Shortcut and Navigation Manager

Responsible for applying supported keyboard, shell, and navigation restrictions.

### E. USB and Device Control Manager

Responsible for removable-storage and approved-device policies.

### F. Display and Peripheral Policy Manager

Responsible for display, monitor, and peripheral restrictions.

### G. Remote Access Security Manager

Responsible for evaluating and enforcing policies concerning remote-access software and sessions.

### H. Policy Verification Engine

Responsible for verifying whether the intended Windows policy is actually active.

### I. Security Event Manager

Responsible for recording, classifying, and reporting policy events.

### J. Recovery and Rollback Manager

Responsible for restoring previous configurations and preserving administrator access.

---

# 4. P2.1 — Comprehensive Application Allowlisting

## 4.1 Objective

Implement a comprehensive application-control mechanism that limits which applications can execute during a secured examination.

The objective is to ensure that the candidate can use AssessX and only those supporting applications explicitly permitted by the examination policy.

Application allowlisting should be enforced through appropriate Windows application-control technologies wherever supported.

## 4.2 Requirements

The application-control system should support:

1. Approved application definitions.
2. Application identity and publisher information.
3. Application version tracking.
4. Application execution policy.
5. Application policy verification.
6. Unauthorized application execution prevention where supported.
7. Application-control event reporting.
8. Policy updates through authorized administration.
9. Safe handling of application updates.
10. Recovery when a policy prevents a required component from launching.

## 4.3 Application Categories

The policy engine should distinguish between the following categories.

| Category | Description |
|---|---|
| CORE_ASSESSX | AssessX desktop application and essential components |
| SECURITY_COMPONENT | AssessX Security Agent and required security components |
| WINDOWS_SYSTEM | Required Windows system components |
| APPROVED_SUPPORT | Explicitly approved supporting applications |
| APPROVED_ACCESSIBILITY | Accessibility applications permitted by policy |
| APPROVED_INPUT | Required keyboard, mouse, and input-device software |
| BLOCKED_APPLICATION | Applications explicitly prohibited |
| UNKNOWN_APPLICATION | Applications not classified by the current policy |

An application must not be automatically trusted simply because it is installed in a standard Windows directory.

## 4.4 Application Identity

Evaluate appropriate application identification mechanisms, including:

- Trusted publisher.
- Digital signature.
- File hash.
- Application path.
- Product identity.
- File version.
- Trusted release manifest.

Do not rely exclusively on file paths.

Paths can be changed, and executable files can be replaced.

Do not rely exclusively on hashes when application updates are expected.

A trusted signing and update process is necessary for reliable application identity.

## 4.5 Windows Application-Control Technologies

Evaluate supported options such as:

- Windows App Control for Business / Windows Defender Application Control.
- AppLocker, where supported.
- Other supported Windows application-control policies.

Do not assume all Windows editions support identical enforcement capabilities.

The implementation must detect the device's edition and available features before recommending or applying a policy.

Do not implement a custom executable-blocking mechanism as a substitute for OS-enforced application control.

## 4.6 Policy Modes

Support clearly defined modes:

**AUDIT_MODE**

- Evaluate application activity.
- Record policy matches and violations.
- Do not enforce blocking.
- Useful for testing policy compatibility.

**ENFORCEMENT_MODE**

- Apply the approved application-control policy.
- Prevent prohibited execution where the selected Windows mechanism supports it.
- Record enforcement events.

**MAINTENANCE_MODE**

- Permit authorized administrative maintenance.
- Keep the device outside active examination mode.
- Avoid silently disabling all security policies.

## 4.7 Application Policy Structure

Conceptual example:

```json
{
  "policy_id": "exam-policy-001",
  "policy_version": 1,
  "mode": "ENFORCEMENT_MODE",
  "approved_applications": [
    {
      "application_id": "assessx-desktop",
      "publisher": "trusted-publisher",
      "required": true
    },
    {
      "application_id": "assessx-security-agent",
      "publisher": "trusted-publisher",
      "required": true
    }
  ],
  "unknown_application_action": "DENY"
}
```

This is an illustrative data structure, not a final Windows policy format.

## 4.8 Policy Verification

The system must verify:

- The intended application-control policy exists.
- The correct policy version is applied.
- Required applications are permitted.
- Prohibited applications are restricted according to the policy.
- The policy has not been unexpectedly modified.
- The Windows enforcement mechanism is active.

Do not report application allowlisting as active merely because a JSON configuration exists in the AssessX installation directory.

## 4.9 Acceptance Criteria

- Application policies can be created and validated.
- Required AssessX components remain available.
- Unauthorized applications are restricted in enforcement mode.
- Audit mode records relevant application activity.
- Application updates can be handled safely.
- Policy failures are reported.
- Administrator recovery remains possible.

---

# 5. P2.2 — Advanced PowerShell and CMD Restrictions

## 5.1 Objective

Restrict unauthorized access to command interpreters and scripting environments during secured examinations.

The primary targets include:

- Command Prompt.
- PowerShell.
- Windows scripting interfaces.
- Other command execution environments identified by the security policy.

## 5.2 Requirements

The system should:

1. Detect the relevant command-interpreter availability.
2. Apply supported Windows restrictions.
3. Prevent candidate access according to the applied policy.
4. Monitor relevant policy state.
5. Record attempted or detected unauthorized access where supported.
6. Verify that the restrictions remain active.
7. Preserve administrator maintenance and recovery access.

## 5.3 Restriction Scope

The policy should distinguish between:

- Candidate user context.
- Administrator context.
- AssessX Security Agent context.
- Required Windows system services.

A restriction applied to the candidate must not unintentionally prevent the Security Agent or authorized administrators from operating.

## 5.4 Implementation Principles

- Prefer supported Windows policy mechanisms.
- Use account-scoped restrictions where appropriate.
- Avoid broad process termination.
- Do not continuously kill every process whose name contains `powershell` or `cmd`.
- Do not break Windows maintenance or recovery tools.
- Do not disable required Windows services.
- Do not assume hiding a shortcut disables the underlying utility.
- Verify actual enforcement rather than relying on UI appearance.

## 5.5 Monitoring

Where supported, monitor:

- Relevant command-interpreter policy state.
- Unauthorized attempts.
- Unexpected policy changes.
- Changes to the candidate account's security configuration.

The system must distinguish an attempted action from successful execution.

## 5.6 Acceptance Criteria

- Candidate restrictions are applied through a supported mechanism.
- Required system and administrative functionality remains available.
- Policy status can be verified.
- Relevant events are recorded.
- Recovery remains possible.

---

# 6. P2.3 — Task Manager and System Utility Restrictions

## 6.1 Objective

Restrict candidate access to system-management utilities that could be used to leave, interfere with, or disrupt the examination environment.

## 6.2 Potential Targets

The policy should evaluate relevant utilities such as:

- Task Manager.
- Run dialog.
- Control Panel.
- Settings.
- File Explorer navigation.
- System configuration utilities.
- Windows administrative tools.
- Registry editing tools.
- Services management interfaces.
- Other system utilities relevant to the examination threat model.

Not every utility should automatically be blocked.

Some Windows components are required for normal operation, accessibility, input, or recovery.

## 6.3 Requirements

1. Define a categorized list of restricted utilities.
2. Apply restrictions to the candidate account.
3. Preserve authorized administrator access.
4. Detect relevant policy changes.
5. Verify enforcement.
6. Record relevant security events.
7. Support policy rollback.

## 6.4 Utility Classification

| Category | Policy |
|---|---|
| REQUIRED_SYSTEM | Must remain available to Windows |
| ASSESSX_REQUIRED | Required by AssessX |
| ADMIN_ONLY | Available only to authorized administration |
| CANDIDATE_RESTRICTED | Restricted during examination |
| ACCESSIBILITY_REQUIRED | Controlled according to accessibility policy |
| UNKNOWN | Requires policy evaluation |

## 6.5 Important Considerations

- Blocking Task Manager does not guarantee that all process-management methods are unavailable.
- Hiding Control Panel is not equivalent to enforcing a system policy.
- Windows Settings may expose functions required for legitimate system operation.
- A system utility may have multiple entry points.

The implementation should use supported Windows policy mechanisms and test the actual candidate experience.

## 6.6 Acceptance Criteria

- Selected candidate restrictions work.
- Required Windows functionality remains available.
- Administrator access is preserved.
- Policy state is verifiable.
- Unauthorized changes are reported.

---

# 7. P2.4 — Comprehensive Shortcut and Navigation Restrictions

## 7.1 Objective

Restrict supported keyboard shortcuts and navigation paths that could allow a candidate to leave the AssessX examination environment.

## 7.2 Potential Areas

Evaluate restrictions for:

- Windows key combinations.
- Application switching.
- Desktop switching.
- Run dialog access.
- System navigation.
- Task switching.
- Shell navigation.
- Other relevant Windows navigation paths.

## 7.3 Design Principles

Do not rely exclusively on frontend keyboard listeners.

A JavaScript event handler cannot reliably prevent every system-level keyboard shortcut.

The implementation should use the selected Windows kiosk, shell, or supported policy mechanisms.

## 7.4 Accessibility Requirements

Do not blindly disable all keyboard shortcuts.

The policy must account for:

- Accessibility requirements.
- Screen readers.
- On-screen keyboards.
- Input-device requirements.
- Language and keyboard layout.
- Legitimate examination navigation.

Provide a mechanism for approved accessibility exceptions.

## 7.5 Event Classification

Possible event types:

- RESTRICTED_SHORTCUT_ATTEMPT
- UNEXPECTED_SHELL_NAVIGATION
- APPLICATION_FOCUS_LOST
- UNEXPECTED_DESKTOP_TRANSITION
- POLICY_CONFIGURATION_CHANGED

These events should be reported as security observations, not automatic proof of misconduct.

## 7.6 Acceptance Criteria

- Relevant navigation restrictions are applied.
- AssessX remains usable.
- Approved accessibility features work.
- System-level restrictions are verified.
- Relevant events are recorded.
- Administrator recovery remains possible.

---

# 8. P2.5 — USB Storage Control

## 8.1 Objective

Control removable storage access during examinations.

The objective is to prevent unauthorized use of USB storage devices for transferring examination material or accessing external content.

## 8.2 Device Categories

Classify devices such as:

- USB mass-storage devices.
- External hard drives.
- USB flash drives.
- Memory-card readers.
- Approved keyboards.
- Approved mice.
- Approved accessibility devices.
- Other permitted peripherals.

Do not treat every USB device as a storage device.

## 8.3 Policy Modes

**ALLOW_ALL_SUPPORTED**

Used only in an explicitly configured maintenance or non-examination environment.

**BLOCK_UNAPPROVED_STORAGE**

Block removable storage that is not explicitly approved.

**ALLOW_APPROVED_DEVICES**

Allow only devices meeting the institution's configured approval policy, where the selected Windows mechanism supports this.

**AUDIT_ONLY**

Record relevant device activity without enforcing blocking.

## 8.4 Requirements

1. Detect relevant removable-storage devices.
2. Apply the selected policy.
3. Prevent unauthorized storage access where supported.
4. Preserve approved input devices.
5. Avoid breaking essential system devices.
6. Detect relevant device connection and removal events.
7. Report policy violations.
8. Support approved-device exceptions.
9. Verify that policy changes are applied.
10. Provide authorized restoration.

## 8.5 Device Identification

Evaluate supported device-identification attributes such as:

- Device class.
- Hardware ID.
- Device instance information.
- Manufacturer.
- Product identifier.
- Serial number, where appropriate and permitted.

Avoid collecting unnecessary hardware identifiers.

Use the minimum information needed for the policy.

## 8.6 Important Considerations

- USB storage restrictions must not disable keyboards and mice accidentally.
- Device identifiers may not be available or reliable for every device.
- Some devices expose multiple interfaces.
- USB-based network adapters and other peripherals must be classified separately.
- A device policy must not be treated as proof that every possible data-transfer channel is blocked.

## 8.7 Acceptance Criteria

- Removable-storage policies can be configured.
- Unauthorized storage is restricted according to policy.
- Approved input devices continue working.
- Device events are recorded.
- Policy verification works.
- Authorized restoration works.

---

# 9. P2.6 — Advanced Display and Peripheral Policies

## 9.1 Objective

Maintain an examination environment with a predictable display and peripheral configuration.

## 9.2 Display Policy

Evaluate:

- Number of connected displays.
- Primary display.
- Display changes during an examination.
- Resolution changes.
- Display arrangement.
- External monitor connections.
- Display configuration changes.

## 9.3 Expected Behaviour

The system should:

1. Detect the initial display configuration.
2. Compare it with the examination policy.
3. Identify unauthorized changes.
4. Record display changes.
5. Apply supported restrictions where available.
6. Notify the desktop application.
7. Preserve recovery behaviour if a display becomes unavailable.

## 9.4 Peripheral Policy

Evaluate relevant peripherals:

- Keyboard.
- Mouse.
- Webcam.
- Microphone.
- External display.
- USB devices.
- Audio devices.
- Other examination-related hardware.

The policy should distinguish required peripherals from optional or prohibited peripherals.

## 9.5 Device Policy Structure

Conceptual example:

```json
{
  "policy_id": "device-policy-001",
  "display": {
    "max_monitors": 1,
    "allow_display_change": false,
    "require_primary_display": true
  },
  "peripherals": {
    "camera_required": true,
    "microphone_required": true,
    "approved_keyboard_required": true,
    "approved_mouse_required": true
  }
}
```

This is a proposed AssessX policy structure, not a direct Windows configuration format.

## 9.6 Multi-Monitor Handling

The system should:

- Detect connected displays.
- Record display topology.
- Identify unexpected display changes.
- Distinguish initial setup from an active examination.
- Apply policy-specific handling.
- Avoid incorrectly blocking a legitimate display driver or accessibility configuration.

## 9.7 Peripheral Failure Handling

Examples:

- Camera disconnects.
- Microphone becomes unavailable.
- External display disconnects.
- Mouse or keyboard disconnects.
- A newly connected device appears.

The system should report the event and follow the examination policy.

A temporary peripheral failure must not automatically be classified as cheating.

## 9.8 Acceptance Criteria

- Display topology can be evaluated.
- Peripheral readiness can be checked.
- Policy deviations are detected.
- Required devices remain functional.
- Events are reported.
- Recovery behaviour is predictable.

---

# 10. P2.7 — Advanced Remote-Access Restrictions

## 10.1 Objective

Detect and restrict unauthorized remote-access capabilities during secured examinations.

The objective is to reduce the possibility of a candidate receiving unauthorized remote assistance or controlling the examination computer through remote-access software.

## 10.2 Areas to Evaluate

Evaluate relevant remote-access capabilities, including:

- Remote desktop sessions.
- Remote assistance tools.
- Third-party remote-control software.
- Remote administration utilities.
- Unauthorized remote sessions.
- Relevant remote-access services.
- Remote network connections associated with prohibited tools.

Examples of software categories may include remote desktop clients, remote assistance applications, and third-party remote-control tools.

Do not rely exclusively on a fixed list of executable names.

## 10.3 Requirements

1. Detect relevant remote-session state.
2. Identify known remote-access software where technically supported.
3. Evaluate relevant Windows remote-access configuration.
4. Apply authorized policy restrictions.
5. Record relevant connection and configuration events.
6. Verify the policy state.
7. Preserve legitimate administrator maintenance procedures.

## 10.4 Classification

Possible states:

- REMOTE_ACCESS_DISABLED
- REMOTE_ACCESS_ALLOWED_BY_POLICY
- REMOTE_SESSION_DETECTED
- REMOTE_TOOL_DETECTED
- UNKNOWN_REMOTE_ACTIVITY
- REMOTE_ACCESS_POLICY_WARNING
- REMOTE_ACCESS_POLICY_VIOLATION

## 10.5 Important Considerations

- Process-name matching alone is not sufficient.
- Some legitimate Windows services may use remote communication.
- Network traffic alone does not establish remote control.
- A remote-access application being installed does not prove that a remote session is active.
- Institutional administration may require authorized remote maintenance outside examination sessions.

Use policy-based classification and evidence.

Do not label every network connection or remote-management service as cheating.

## 10.6 Acceptance Criteria

- Relevant remote-access configuration is evaluated.
- Unauthorized remote-access capabilities are restricted where supported.
- Relevant remote sessions are detected.
- Authorized maintenance is preserved.
- Security events are recorded.
- False-positive behaviour is tested.

---

# 11. P2.8 — Central Security Policy Management

## 11.1 Objective

Create a consistent policy-management layer for Phase 2 restrictions.

This is a proposed architectural component that coordinates the Phase 2 feature areas.

The system should not apply unrelated Windows policies independently without a common policy model.

## 11.2 Policy Structure

A policy should contain:

- Policy ID.
- Policy name.
- Policy version.
- Policy status.
- Applicable Windows edition.
- Device scope.
- Examination scope, where relevant.
- Policy mode.
- Feature settings.
- Approved exceptions.
- Creation timestamp.
- Update timestamp.
- Authorization metadata.

## 11.3 Policy Modes

- DRAFT
- VALIDATION
- AUDIT
- ENFORCEMENT
- MAINTENANCE
- DISABLED

A policy must be validated before enforcement.

## 11.4 Policy Application Lifecycle

```text
POLICY CREATED
      |
      v
POLICY VALIDATION
      |
      v
COMPATIBILITY CHECK
      |
      v
ADMINISTRATOR APPROVAL
      |
      v
POLICY APPLICATION
      |
      v
WINDOWS VERIFICATION
      |
      +-------> FAILED
      |            |
      |            v
      |       ROLLBACK
      |
      v
POLICY ACTIVE
      |
      v
CONTINUOUS MONITORING
```

## 11.5 Policy Validation

Before applying a policy, verify:

- Windows edition compatibility.
- Required privileges.
- Existing configuration conflicts.
- Required AssessX components.
- Candidate account scope.
- Administrator recovery path.
- Expected policy impact.
- Rollback availability.

## 11.6 Policy Change Journal

Every policy operation should record:

- Operation ID.
- Policy ID.
- Previous policy version.
- New policy version.
- Initiating administrator or authorized process.
- Timestamp.
- Applied changes.
- Verification result.
- Rollback information.

Do not overwrite previous system settings without recording their state.

---

# 12. P2.9 — Security Agent Integration

## 12.1 Objective

Extend the Phase 1C Security Agent so it can monitor and verify Phase 2 Windows security policies.

Do not create a second background service.

## 12.2 Responsibilities

The existing Security Agent should:

1. Read the active security policy.
2. Verify policy version.
3. Check relevant Windows policy state.
4. Detect unauthorized configuration changes.
5. Monitor application-control status.
6. Monitor removable-storage policy status.
7. Monitor relevant system restrictions.
8. Monitor display and peripheral policy state.
9. Monitor remote-access security state.
10. Generate structured events.
11. Report compliance status.
12. Coordinate authorized recovery where required.

## 12.3 New Logical Modules

Adapt the existing Rust architecture.

Potential modules:

```text
security_agent/
│
├── policy/
│   ├── policy_loader
│   ├── policy_validator
│   ├── policy_version
│   └── policy_verifier
│
├── application_control/
│   ├── application_policy
│   └── application_status
│
├── system_restrictions/
│   ├── command_policy
│   ├── utility_policy
│   └── navigation_policy
│
├── device_control/
│   ├── usb_storage_policy
│   ├── display_policy
│   └── peripheral_policy
│
├── remote_access/
│   ├── remote_session_monitor
│   └── remote_policy_verifier
│
└── enforcement/
    ├── enforcement_status
    ├── policy_audit
    └── rollback_coordinator
```

This is a conceptual structure. Reuse existing modules wherever possible.

## 12.4 Agent Security

- The agent must not expose arbitrary policy commands through IPC.
- Only explicitly defined policy operations may be requested.
- Policy updates must be authenticated.
- Policy signatures or another trusted integrity mechanism should be used where appropriate.
- The agent must verify that a policy applies to the current device.
- The agent must not trust policy data solely because it came from the desktop frontend.
- Privileged Windows changes must follow the authorized policy-application process.

---

# 13. P2.10 — Compliance and Security Event Reporting

## 13.1 Objective

Report Phase 2 security status to the AssessX backend.

Reuse the Phase 1C event-reporting architecture.

## 13.2 Event Categories

Potential events include:

- APPLICATION_POLICY_APPLIED
- APPLICATION_POLICY_FAILED
- UNAUTHORIZED_APPLICATION_BLOCKED
- COMMAND_RESTRICTION_CHANGED
- SYSTEM_UTILITY_RESTRICTION_CHANGED
- RESTRICTED_NAVIGATION_ATTEMPT
- USB_STORAGE_CONNECTED
- USB_STORAGE_BLOCKED
- UNAPPROVED_DEVICE_DETECTED
- DISPLAY_CONFIGURATION_CHANGED
- PERIPHERAL_DISCONNECTED
- REMOTE_SESSION_DETECTED
- REMOTE_ACCESS_POLICY_CHANGED
- POLICY_TAMPER_DETECTED
- POLICY_VERIFICATION_FAILED
- POLICY_ROLLBACK_STARTED
- POLICY_ROLLBACK_COMPLETED

## 13.3 Event Schema

Conceptual example:

```json
{
  "event_id": "uuid",
  "device_id": "registered-device-id",
  "session_id": "optional-session-id",
  "policy_id": "policy-id",
  "policy_version": 2,
  "event_type": "USB_STORAGE_BLOCKED",
  "severity": "MEDIUM",
  "timestamp": "2026-01-01T10:00:00Z",
  "schema_version": 1,
  "details": {
    "device_category": "USB_STORAGE",
    "enforcement_status": "BLOCKED"
  }
}
```

Adapt the schema to the existing backend conventions.

## 13.4 Event Requirements

- Authenticated reporting.
- Device authorization.
- Event validation.
- Duplicate-event protection.
- Timestamp validation.
- Policy-version association.
- Event correlation.
- Offline queueing.
- Retry handling.
- Sensitive-data redaction.

Do not store unnecessary device identifiers or personal information.

## 13.5 Severity Model

| Severity | Meaning |
|---|---|
| INFO | Normal policy activity |
| LOW | Minor policy observation |
| MEDIUM | Restricted action attempted or device deviation |
| HIGH | Important security-policy failure |
| CRITICAL | Critical enforcement or integrity failure |

Severity must reflect actual evidence and impact.

---

# 14. P2.11 — Policy Recovery and Rollback

## 14.1 Objective

Ensure that system-level security policies can be recovered safely if application, Windows, or configuration failures occur.

## 14.2 Requirements

1. Record previous settings before applying changes.
2. Validate the new configuration.
3. Apply changes only after authorization.
4. Verify successful application.
5. Detect incomplete policy application.
6. Initiate rollback when the configured failure conditions require it.
7. Record rollback results.
8. Preserve administrator recovery.
9. Avoid restoring stale or unrelated system configurations.
10. Report any incomplete restoration.

## 14.3 Failure Scenarios

- Windows edition does not support the selected policy.
- Policy application fails.
- Required AssessX application becomes unavailable.
- Security Agent becomes unavailable.
- Application-control policy blocks an essential Windows component.
- USB policy blocks an essential input device.
- Display policy makes the examination interface unusable.
- Remote-access restrictions affect authorized maintenance.
- Windows restarts during policy application.
- Policy verification fails.

## 14.4 Recovery Principles

- Do not create an uncontrolled policy-reapplication loop.
- Do not automatically disable every restriction after a failure.
- Do not leave the candidate account with administrator access.
- Do not remove unrelated Windows policies.
- Preserve a separately authorized administrator recovery path.
- Log every recovery operation.
- Report partial rollback honestly.

---

# 15. Windows Compatibility and Deployment Strategy

## 15.1 Objective

Ensure Phase 2 restrictions are compatible with the actual Windows edition and deployment environment.

## 15.2 Compatibility Detection

The system must identify:

- Windows edition.
- Windows version and build.
- Available kiosk mechanisms.
- Available application-control mechanisms.
- Required policy capabilities.
- Required permissions.
- Existing policy conflicts.
- Whether the device is institution-managed or locally managed, where relevant.

## 15.3 Windows Edition Handling

Do not assume that Windows Home, Pro, Enterprise, Education, and IoT Enterprise provide identical security capabilities.

Some mechanisms have edition, licensing, management, or configuration requirements.

For each feature, maintain a compatibility result:

- SUPPORTED
- SUPPORTED_WITH_LIMITATIONS
- UNSUPPORTED
- REQUIRES_ADMINISTRATOR
- REQUIRES_MANAGED_DEVICE
- UNKNOWN

Do not claim a feature is supported simply because a registry key or command is available.

## 15.4 Deployment Models

Evaluate the following deployment environments:

**Locally managed device**

- Administrator explicitly configures the device.
- AssessX validates capabilities.
- Policies are applied through supported local Windows mechanisms.

**Institution-managed device**

- Existing institutional policies may be managed through approved IT administration systems.
- AssessX must detect conflicts rather than overwrite institutional policy.
- Integration with institutional management infrastructure should be designed separately if required.

## 15.5 Development Safety

All destructive or system-wide policy testing must occur on a Windows VM or separate test computer.

Do not test aggressive lockdown changes on the developer's daily-use Windows installation.

---

# 16. Phase 2 User Workflows

## 16.1 Administrator Policy Setup

1. Administrator opens the authorized AssessX configuration workflow.
2. AssessX checks Windows compatibility.
3. AssessX reads existing policy state.
4. Administrator selects the intended examination restrictions.
5. AssessX validates policy compatibility.
6. AssessX displays the policy summary and expected impact.
7. Administrator reviews and approves.
8. The policy manager records the previous state.
9. The authorized policy mechanism applies the configuration.
10. The system verifies the applied policy.
11. The Security Agent reports the result.
12. The device displays its updated security readiness.

## 16.2 Examination Startup

1. Windows starts the configured examination account.
2. AssessX starts through the Phase 1B secure-shell mechanism.
3. Security Agent establishes authenticated communication.
4. Device compliance is checked.
5. Active Phase 2 policy is identified.
6. Required Windows policies are verified.
7. Application-control status is checked.
8. Device and peripheral policies are checked.
9. Required restrictions are verified.
10. The examination readiness result is generated.

Possible results:

- READY
- READY_WITH_WARNINGS
- BLOCKED
- ERROR

The exact blocking rules must be configurable by institutional policy.

## 16.3 During an Examination

1. AssessX remains the primary examination interface.
2. The Security Agent monitors relevant policy state.
3. Windows enforcement mechanisms apply the configured restrictions.
4. Policy deviations are detected.
5. Security events are recorded.
6. Relevant events are sent to the backend.
7. The system continues safe operation during temporary network failure.
8. Critical failures follow the configured recovery policy.

## 16.4 Examination Completion

1. Examination session reaches its authorized completion state.
2. AssessX records the session result.
3. The device transitions out of active examination mode according to the configured workflow.
4. The applicable security policy remains in place or is released through an authorized process.
5. Restoration operations are recorded.

The complete administrator activation and exit-authorization workflow belongs to Phase 3.

---

# 17. Phase 2 Testing Strategy

Testing must verify actual Windows behaviour, not just the existence of configuration files or source code.

## 17.1 Application-Control Testing

- Approved application launches.
- Unauthorized application is restricted in enforcement mode.
- Audit mode records activity without blocking.
- Required Windows components remain available.
- Application update does not unexpectedly break allowlisting.
- Invalid policy is rejected.
- Policy rollback works.

## 17.2 Command and Utility Testing

- Candidate restrictions are applied.
- Administrator access is preserved.
- Required Windows services remain functional.
- Application recovery remains possible.
- Restrictions do not break essential system operation.

## 17.3 Shortcut and Navigation Testing

- Relevant shortcuts are restricted through supported mechanisms.
- Candidate remains within the intended environment.
- Accessibility functionality is preserved.
- Keyboard layouts work.
- Input devices continue functioning.
- Administrator recovery remains possible.

## 17.4 USB Testing

- USB storage detection works.
- Unauthorized storage is restricted.
- Approved devices remain functional.
- Keyboard and mouse are not accidentally blocked.
- Device removal is handled safely.
- Policy rollback works.

## 17.5 Display and Peripheral Testing

- Single-monitor configuration.
- Multiple-monitor configuration.
- Display connection and disconnection.
- Resolution changes.
- Camera disconnection.
- Microphone disconnection.
- Keyboard and mouse disconnection.
- Approved accessibility peripherals.

## 17.6 Remote-Access Testing

- Relevant remote-access configuration is detected.
- Known remote-session states are classified correctly.
- Authorized maintenance access remains possible.
- Policy restrictions are verified.
- False positives are evaluated.

## 17.7 Integration Testing

- Phase 1A provisioning remains functional.
- Phase 1B secure shell remains functional.
- Phase 1C Security Agent remains functional.
- Phase 2 policy state is visible to the agent.
- Compliance reporting works.
- Backend event reporting works.
- Offline behaviour works.
- Rollback and recovery work.

## 17.8 Regression Testing

Run existing tests for:

- Authentication and authorization.
- Admin workflows.
- Candidate workflows.
- Device registration.
- Device provisioning.
- Secure-shell startup.
- Session lifecycle.
- Security Agent.
- IPC.
- Proctoring.
- Examination workflows.
- Backend APIs.
- Database migrations.

Do not delete or weaken existing tests to make new functionality pass.

---

# 18. Phase 2 Implementation Workflow

Implementation must happen in stages.

Do not make all Windows restrictions active in one uncontrolled operation.

## STAGE 0 — Phase 1 Readiness Audit

Inspect the completed Phase 1 implementation.

Verify:

- Device provisioning.
- Candidate account.
- Device registration.
- Secure shell.
- Kiosk configuration.
- Startup and restoration.
- Native Security Agent.
- IPC.
- Compliance engine.
- Integrity verification.
- Backend event reporting.

Classify each requirement:

- IMPLEMENTED
- PARTIALLY_IMPLEMENTED
- MISSING
- NEEDS_REFACTORING
- NEEDS_VALIDATION

Do not start Phase 2 enforcement until the required Phase 1 foundation is understood.

## STAGE 1 — Windows Capability and Compatibility Assessment

Implement or verify:

- Windows edition detection.
- Available policy capabilities.
- Application-control support.
- Device-control support.
- Required privileges.
- Existing policy conflict detection.
- Recovery capability.

Generate a structured compatibility report.

## STAGE 2 — Central Policy Management

Implement:

- Policy schema.
- Policy versioning.
- Policy validation.
- Policy preview.
- Authorization.
- Change journal.
- Policy application state.
- Policy verification.
- Rollback coordination.

Do not yet enable all restrictions by default.

## STAGE 3 — Application Allowlisting

Implement audit mode first.

Verify application classification and required component compatibility.

After validation, implement enforcement mode using supported Windows application-control mechanisms.

## STAGE 4 — Command and System Utility Restrictions

Implement supported candidate-account restrictions.

Test administrator and system functionality.

Verify actual enforcement.

## STAGE 5 — Shortcut and Navigation Restrictions

Implement system-supported restrictions.

Verify keyboard, accessibility, and recovery behaviour.

## STAGE 6 — USB and Device Control

Implement removable-storage policies.

Verify approved input devices and peripheral functionality.

## STAGE 7 — Display and Peripheral Policies

Implement display topology and peripheral policy evaluation.

Integrate with existing readiness checks.

## STAGE 8 — Remote-Access Restrictions

Implement remote-session and remote-access policy evaluation.

Test authorized maintenance and false-positive scenarios.

## STAGE 9 — Security Agent Integration

Extend the existing Security Agent to:

- Verify policies.
- Monitor policy state.
- Detect policy changes.
- Generate security events.
- Report compliance.
- Coordinate recovery.

## STAGE 10 — Backend Integration

Extend existing APIs and database models only where necessary.

Implement:

- Policy status reporting.
- Security event reporting.
- Compliance reports.
- Policy version tracking.
- Event deduplication.

## STAGE 11 — Full System Testing

Run Windows VM or separate-device testing.

Verify all restrictions, compatibility, recovery, and regressions.

## STAGE 12 — Documentation and Final Review

Update:

- Technical architecture.
- Windows compatibility matrix.
- Policy documentation.
- Security event documentation.
- Installation and maintenance instructions.
- Recovery procedures.
- Test results.
- Known limitations.

---

# 19. Phase 2 Deliverables

The expected Phase 2 deliverables are:

1. Windows compatibility and capability assessment.
2. Central Security Policy Manager.
3. Application Allowlisting and Control Module.
4. PowerShell and CMD Restriction Module.
5. Task Manager and System Utility Restriction Module.
6. Shortcut and Navigation Restriction Module.
7. USB Storage Control Module.
8. Display Policy Module.
9. Peripheral Policy Module.
10. Remote-Access Security Module.
11. Security Agent Policy Verification Integration.
12. Policy Tamper Detection Integration.
13. Policy Change Journal.
14. Security Event Reporting Integration.
15. Policy Rollback and Recovery Integration.
16. Backend and database integration where required.
17. Automated tests.
18. Windows compatibility documentation.
19. Phase 2 implementation report.

These are logical deliverables. They do not require a separate package or service for every item.

---

# 20. Phase 2 Acceptance Criteria

Phase 2 is complete only when its applicable requirements have been implemented and verified.

## Application Allowlisting

- [ ] Application policies can be defined.
- [ ] Required AssessX components remain available.
- [ ] Unauthorized applications are restricted in enforcement mode.
- [ ] Audit mode works.
- [ ] Application updates are handled safely.
- [ ] Policy verification works.

## Command and System Restrictions

- [ ] Candidate command-interpreter restrictions work.
- [ ] Task Manager restrictions work where supported.
- [ ] Selected system utility restrictions work.
- [ ] Administrator recovery remains available.
- [ ] Required Windows functionality remains operational.

## Shortcut and Navigation

- [ ] Relevant navigation restrictions work.
- [ ] System-level enforcement is verified.
- [ ] Accessibility features remain functional.
- [ ] AssessX remains responsive.

## USB and Device Control

- [ ] USB storage policies work.
- [ ] Unauthorized storage is restricted.
- [ ] Approved input devices remain available.
- [ ] Device events are detected.
- [ ] Policy rollback works.

## Display and Peripheral Policies

- [ ] Display topology is evaluated.
- [ ] Unauthorized display changes are detected.
- [ ] Required peripherals are checked.
- [ ] Peripheral failures are handled safely.
- [ ] False positives are evaluated.

## Remote Access

- [ ] Relevant remote-access configuration is evaluated.
- [ ] Unauthorized remote-access capabilities are restricted where supported.
- [ ] Relevant remote sessions are detected.
- [ ] Authorized maintenance remains possible.

## Policy Management and Integration

- [ ] Central policy management works.
- [ ] Policy versioning works.
- [ ] Administrator authorization is enforced.
- [ ] Policy changes are journaled.
- [ ] Policy verification works.
- [ ] Rollback works.
- [ ] Security Agent integration works.
- [ ] Backend reporting works.
- [ ] Existing Phase 1 functionality remains operational.
- [ ] Regression tests pass.
- [ ] Windows compatibility documentation is complete.

A requirement that cannot be tested because of unavailable Windows editions, licensing, management infrastructure, or hardware must be marked NOT VERIFIED or BLOCKED.

Do not claim completion based only on source-code implementation.

---

# 21. Security and Safety Requirements

Phase 2 introduces system-level restrictions. These changes can affect the usability and recoverability of the entire Windows computer.

Mandatory rules:

1. Do not modify Windows shell settings without explicit authorization.
2. Do not silently change system-wide policies.
3. Do not disable Windows Defender or essential security features.
4. Do not disable UAC.
5. Do not disable the firewall.
6. Do not grant candidate administrator privileges.
7. Do not use broad process-killing mechanisms.
8. Do not block essential Windows services.
9. Do not block required keyboard, mouse, camera, or microphone devices accidentally.
10. Do not make a policy impossible to reverse.
11. Do not delete pre-existing user accounts.
12. Do not overwrite institutional policies without authorization.
13. Do not expose arbitrary policy execution through IPC.
14. Do not treat a policy event as automatic proof of cheating.
15. Do not store unnecessary personal or hardware information.
16. Do not claim a restriction is enforced unless actual OS-level verification confirms it.

All high-impact tests must use a Windows VM or separate test computer.

The developer's everyday computer must remain recoverable.

---

# 22. Scope Boundaries

Phase 2 includes:

- Comprehensive application allowlisting.
- Advanced PowerShell/CMD restrictions.
- Task Manager and system utility restrictions.
- Comprehensive shortcut and navigation restrictions.
- USB storage control.
- Advanced display and peripheral policies.
- Advanced remote-access restrictions.

The following are assigned to later phases:

| Feature | Planned phase |
|---|---|
| Administrator-controlled activation codes | Phase 3 |
| Administrator-controlled exit authorization | Phase 3 |
| Complete institutional admin dashboard | Phase 3 |
| Remote device policy management | Phase 3 |
| Advanced answer persistence and recovery | Phase 3 |
| Full penetration testing | Phase 4 |
| Independent security audit | Phase 4 |
| Institutional production rollout | Phase 4 |
| Linux version | Future optional expansion |

Do not implement these later-phase features as part of Phase 2 unless a clearly documented dependency requires a small integration foundation.

---

# 23. Definition of Done

Phase 2 is complete when a compatible Windows device can:

1. Be provisioned through Phase 1.
2. Launch AssessX through the secure-shell mechanism.
3. Run the native Security Agent.
4. Apply a validated Phase 2 security policy.
5. Restrict unauthorized application execution through supported Windows controls.
6. Restrict selected command interpreters and system utilities.
7. Restrict relevant navigation paths.
8. Control removable storage according to policy.
9. Evaluate display and peripheral configuration.
10. Evaluate relevant remote-access conditions.
11. Verify the active policy state.
12. Detect relevant policy modifications.
13. Report security events to the backend.
14. Recover safely from policy failures.
15. Preserve an authorized administrator recovery path.

**Final principle:** Phase 1 creates the secure Windows foundation. Phase 2 strengthens operating-system-level enforcement. Phase 3 introduces institutional and administrator control. Phase 4 validates the complete product for reliable deployment.

---

# 24. Instructions for Future AI Development Assistants

When implementing Phase 2:

1. Inspect the existing repository before editing.
2. Read the Phase 1 Knowledge Base.
3. Read the Phase 1A, 1B, and 1C implementation reports.
4. Inspect the existing Tauri, React, TypeScript, and Rust architecture.
5. Inspect the Security Agent.
6. Inspect existing Windows policies and kiosk configuration.
7. Inspect backend APIs and database models.
8. Identify existing functionality.
9. Avoid duplicate modules.
10. Prepare an implementation plan.
11. Implement one stage at a time.
12. Test each policy on a Windows VM or separate test machine.
13. Verify rollback and administrator recovery.
14. Run existing regression tests.
15. Update documentation.

Classify every requirement as:

- IMPLEMENTED
- PARTIALLY_IMPLEMENTED
- MISSING
- NEEDS_REFACTORING
- NEEDS_VALIDATION
- BLOCKED

For every implementation task, report:

- What was inspected.
- What already existed.
- What was implemented.
- Files added.
- Files modified.
- Why changes were necessary.
- Tests added.
- Tests executed.
- Actual test results.
- Known limitations.
- Remaining work.

Do not rebuild AssessX from scratch.

Do not replace working Phase 1 architecture without a documented technical reason.

Do not claim a Windows restriction is effective merely because a registry setting, configuration file, or UI toggle exists.

**Phase 2 must be implemented as a controlled extension of the existing AssessX Windows security architecture.**

