# AssessX — Phase 1 Knowledge Base
## Windows Secure Environment Foundation

**Project:** AssessX  
**Phase:** 1 of 4  
**Phase Name:** Windows Secure Environment Foundation  
**Platform:** Windows  
**Primary Stack:** Tauri + React + TypeScript + Rust  
**Backend:** FastAPI + PostgreSQL (Supabase)  
**Document Type:** Technical Knowledge Base / Implementation Specification

---

# 1. Phase 1 — Overview

## 1.1 Purpose

Phase 1 establishes the foundation required to transform a compatible Windows computer into an AssessX-managed examination device.

The objective is to prepare an existing Windows computer to run AssessX in a controlled examination environment without replacing or damaging its existing Windows installation.

Phase 1 focuses on three major engineering areas:

1. **Windows Environment & Device Provisioning**
2. **AssessX Secure Shell & Examination Startup**
3. **Native Security Agent & System Integration**

These three parts form the foundation for the more advanced lockdown, administrator control, and institutional deployment capabilities planned for subsequent phases.

## 1.2 Product Vision

AssessX should provide institutions with a way to convert their existing compatible Windows computers into dedicated examination devices.

During a secured examination session:

- The candidate should interact with AssessX as the primary examination interface.
- The normal Windows desktop should be restricted according to the configured security policy.
- Unauthorised applications and system utilities should be restricted through supported Windows security mechanisms.
- The examination environment should be monitored by a native security component.
- Only an authorised administrator should be able to release the device from examination mode.

**Important:** Phase 1 establishes the foundation. It does not claim to deliver every system-wide restriction. Advanced application control, administrator activation and exit workflows, and extensive security validation belong to later phases.

## 1.3 Core Design Principles

### A. Windows-first development

The first complete product will target Windows.

Linux support is not part of the current implementation scope. It may be considered as a separate future expansion after the Windows product is successfully completed.

### B. Preserve existing Windows installation

AssessX must not replace Windows or silently modify critical operating-system components.

All provisioning operations must be:

- Explicitly authorised.
- Reversible wherever technically possible.
- Logged.
- Validated before execution.
- Accompanied by a recovery procedure.

### C. Least privilege

The candidate must not receive unnecessary administrator privileges.

The examination account should normally be a dedicated standard Windows user. Administrative operations must be performed through an appropriately authorised administrator context.

### D. Native Windows security

Use supported Windows features and policies wherever possible instead of relying only on application-level restrictions.

A normal desktop application cannot guarantee that every Windows shortcut, system utility, or recovery path is blocked.

### E. Reliability before aggressive lockdown

A failed security configuration must not leave a computer unusable.

AssessX should prioritise predictable startup, recovery, and restoration over attempting to disable every Windows function.

---

# 2. Phase 1 Architecture

## 2.1 High-Level Architecture

The three parts work together as follows:

**Part 1 — Provisioning**
- Checks the Windows environment.
- Checks hardware and security readiness.
- Creates or verifies the candidate account.
- Registers the device.
- Prepares the required configuration.

**Part 2 — Secure Shell**
- Starts AssessX in the examination environment.
- Integrates with supported Windows kiosk or shell mechanisms.
- Controls the examination session lifecycle.
- Provides recovery and authorised restoration workflows.

**Part 3 — Native Security Agent**
- Runs as a Windows service.
- Monitors device and session health.
- Communicates securely with the AssessX application.
- Reports security and compliance events.
- Coordinates recovery and diagnostics.

## 2.2 Architecture Diagram

```text
                 INSTITUTION / ADMINISTRATOR
                           |
                           |
                    AssessX Backend
                           |
                 Device Registration
                           |
                  Device Configuration
                           |
        ---------------------------------------
        |                                     |
        |             WINDOWS DEVICE           |
        |                                     |
        |    PART 1: PROVISIONING              |
        |    -----------------------           |
        |    Compatibility Checker            |
        |    Hardware Readiness Scanner        |
        |    Security Readiness Checker        |
        |    Candidate Account Setup           |
        |    Device Registration               |
        |    Configuration Validation          |
        |                                     |
        |                  |                  |
        |                  v                  |
        |                                     |
        |    PART 2: SECURE SHELL              |
        |    -----------------------           |
        |    Windows Kiosk Integration        |
        |    AssessX Secure Shell              |
        |    Examination Startup               |
        |    Session Lifecycle Manager        |
        |    Crash / Startup Recovery          |
        |                                     |
        |                  |                  |
        |                  v                  |
        |                                     |
        |    PART 3: SECURITY AGENT            |
        |    -----------------------           |
        |    Native Windows Service            |
        |    Secure IPC                        |
        |    Device Compliance Engine          |
        |    Integrity Verification            |
        |    Security Event Reporter           |
        |    Diagnostic / Recovery Interface   |
        |                                     |
        ---------------------------------------
```

## 2.3 Important Architecture Separation

AssessX should maintain a clear separation between:

| Component | Responsibility |
|---|---|
| AssessX Desktop Application | User interface and examination experience |
| Provisioning Module | Initial device preparation |
| Windows Kiosk Integration | Supported Windows shell and kiosk configuration |
| Security Agent | Background monitoring and system integration |
| Backend | Device registration, configuration and institutional records |
| Administrator Interface | Authorised device and examination management |

The desktop application must not independently perform every privileged system operation.

Privileged operations should be handled by a narrowly scoped, authenticated service or installer component.

---

# 3. PART 1 — Windows Environment & Device Provisioning

## 3.1 Objective

Prepare a compatible Windows computer for AssessX Secure Exam Mode.

This part verifies that the computer meets the necessary requirements, prepares the candidate account, registers the device, and establishes the initial configuration.

The system must perform these tasks without damaging the user's existing Windows installation.

## 3.2 Features and Requirements

### P1.1 — Windows Compatibility Detection

**Purpose:** Determine whether the computer is running a Windows version supported by AssessX.

The compatibility checker should identify:

- Windows edition.
- Windows version.
- OS build number.
- System architecture.
- Installed updates where relevant.
- Whether the OS is supported by the current AssessX release.

Example information:

```text
Operating System: Windows 11
Edition: Windows 11 Pro
Version: 24H2
Architecture: x64
Build: Detected OS Build
Compatibility: Supported / Unsupported
```

**Implementation considerations:**

Use Windows APIs and supported system interfaces to retrieve OS information.

Possible sources include:

- Windows Version APIs.
- Windows Management Instrumentation (WMI).
- Windows system information interfaces.

Do not rely only on manually parsing the Windows registry when a supported API is available.

**Expected result:**

The application produces a compatibility result and explains unsupported configurations.

### P1.2 — Hardware Readiness Detection

**Purpose:** Verify that the computer has sufficient hardware resources for AssessX.

The scanner should check:

| Component | Information |
|---|---|
| Processor | CPU model and available capabilities |
| RAM | Total and available memory |
| Storage | Available disk space |
| Camera | Camera presence and accessibility |
| Microphone | Microphone presence and accessibility |
| Display | Resolution and connected displays |
| Network | Available network connectivity |
| Input devices | Keyboard and mouse availability |

The hardware requirements should be configurable according to the actual needs of AssessX.

For example, AI-based proctoring may require more resources than a basic examination interface.

**Important:** Detecting a camera or microphone does not prove that it works correctly. The readiness scanner should distinguish between:

- Device detected.
- Device accessible.
- Device permission available.
- Device successfully tested.

**Expected result:**

A hardware readiness report showing passed, warning, and failed checks.

### P1.3 — Windows Security Readiness

**Purpose:** Check whether important Windows security capabilities are available and configured.

Potential checks:

- Secure Boot status.
- TPM availability and readiness.
- Windows Defender / Microsoft Defender status.
- Windows Firewall status.
- Windows account privileges.
- Relevant operating-system security capabilities.

The system should distinguish between:

- Available.
- Enabled.
- Disabled.
- Unsupported.
- Unable to determine.

Do not automatically change BIOS or UEFI settings.

If Secure Boot or TPM is required by a future deployment policy, explain the requirement and ask an administrator to configure it through an approved process.

**Expected result:**

A security readiness report.

### P1.4 — Administrator Verification

**Purpose:** Ensure that provisioning operations are executed with appropriate permissions.

Some operations require administrator privileges, such as:

- Installing a Windows service.
- Creating or configuring Windows accounts.
- Applying supported machine-level policies.
- Installing signed application components.
- Configuring supported kiosk settings.

The installer should check whether it has the required privileges before beginning such operations.

If elevation is required:

1. Explain why administrator permission is needed.
2. Request elevation through the standard Windows mechanism.
3. Recheck permissions after elevation.
4. Continue only if the required permissions are available.

Never silently bypass Windows access controls.

### P1.5 — Candidate Account Provisioning

**Purpose:** Prepare a dedicated Windows account for examination use.

The candidate account should be separate from the institution's administrator account.

Recommended properties:

- Dedicated to AssessX examinations.
- Standard-user privileges by default.
- No unnecessary administrative permissions.
- Restricted access according to the selected Windows policy.
- Configured for the intended AssessX startup workflow.

Account provisioning should check whether the account already exists before creating it.

The module must safely handle:

- Account already exists.
- Account creation failure.
- Invalid account configuration.
- Insufficient privileges.
- Account already in use.
- Rollback after partial provisioning.

**Security rule:** Do not store account passwords in plaintext, source code, logs, or ordinary application configuration files.

### P1.6 — Administrator Account Separation

**Purpose:** Keep institutional administrative operations separate from candidate activity.

The administrator account is responsible for authorised management operations.

The candidate account is responsible for examination interaction.

| Capability | Candidate | Administrator |
|---|---|---|
| Start AssessX | Yes | Yes |
| Take examination | Yes | No, unless separately authorised |
| Change device configuration | No | Yes |
| Install system services | No | Yes |
| Modify security policies | No | Yes |
| Authorise device restoration | No | Yes |
| Manage device registration | No | Yes |

Actual permissions must be enforced by Windows security boundaries and authenticated administrator workflows, not just by hiding buttons in the UI.

### P1.7 — Device Identity and Registration Foundation

**Purpose:** Give every enrolled computer a unique AssessX device identity.

The device identity will be used by the backend to recognise and manage registered devices.

The registration workflow should include:

1. Generate a cryptographically random device identifier.
2. Create a device registration request.
3. Associate the device with an institution.
4. Authenticate the registration request.
5. Receive the registration result.
6. Store the resulting device identity securely.
7. Verify the registration status.

Example conceptual device record:

```json
{
  "device_id": "assessx-device-generated-id",
  "institution_id": "institution-id",
  "device_status": "registered",
  "platform": "windows",
  "architecture": "x64",
  "registration_status": "active"
}
```

This is an illustrative data structure, not a final API contract.

**Security requirements:**

- Do not use a MAC address as the only device identity.
- Do not expose backend secrets in the desktop application.
- Authenticate device registration.
- Support device revocation in the future.
- Protect locally stored credentials.
- Avoid collecting unnecessary hardware identifiers.

### P1.8 — Configuration Validation

**Purpose:** Verify that the required AssessX components and configuration are present.

Checks may include:

- AssessX installation files.
- Application version.
- Security Agent installation status.
- Required Windows services.
- Required configuration files.
- Configuration integrity.
- Application signing status.
- Supported Windows components.
- Required account configuration.

The validation engine should return a structured result rather than a single pass/fail message.

Example:

```text
AssessX Installation       PASS
Windows Compatibility     PASS
Candidate Account          PASS
Device Registration        PASS
Security Agent             WARNING
Kiosk Configuration        NOT CONFIGURED
```

### P1.9 — Installation Diagnostics and Readiness Report

**Purpose:** Provide a clear record of the computer's readiness.

The report should contain:

- Device identifier, if registered.
- Windows edition and version.
- Hardware readiness.
- Security readiness.
- Account provisioning result.
- Application installation status.
- Configuration validation results.
- Warnings and failures.
- Timestamp.
- Diagnostic reference identifier.

The report should avoid exposing passwords, authentication tokens, or unnecessary sensitive information.

Possible report statuses:

- READY.
- READY_WITH_WARNINGS.
- NOT_READY.
- PROVISIONING_FAILED.

### P1.10 — Safe Rollback

**Purpose:** Restore changes made by AssessX when provisioning fails or is cancelled.

The provisioning system should maintain a record of every change it makes.

Example:

| Operation | Rollback behaviour |
|---|---|
| Create candidate account | Remove it only if created by this provisioning transaction and safe to remove |
| Install AssessX service | Stop and uninstall the service if installation was part of the failed transaction |
| Create configuration file | Restore previous version or remove the newly created file |
| Apply policy | Restore the recorded previous configuration where supported |
| Register device | Mark registration as incomplete or request server-side cancellation |

**Important implementation rules:**

- Never delete a pre-existing user account automatically.
- Never remove unrelated applications.
- Never overwrite existing policies without recording their previous state.
- Do not assume every Windows configuration can be reversed automatically.
- If rollback is incomplete, report exactly what remains and provide administrator recovery instructions.

## 3.3 Part 1 — Technical Components

Recommended logical modules:

```text
provisioning/
│
├── compatibility/
│   ├── windows_detector
│   └── edition_validator
│
├── hardware/
│   ├── cpu_scanner
│   ├── memory_scanner
│   ├── storage_scanner
│   ├── camera_scanner
│   ├── microphone_scanner
│   └── display_scanner
│
├── security/
│   ├── secure_boot_checker
│   ├── tpm_checker
│   └── security_status_checker
│
├── accounts/
│   ├── administrator_validator
│   └── candidate_account_manager
│
├── device/
│   ├── device_identity
│   └── registration_client
│
├── configuration/
│   ├── configuration_validator
│   └── configuration_manager
│
├── diagnostics/
│   └── readiness_report
│
└── rollback/
    ├── change_journal
    └── rollback_manager
```

This is a proposed logical structure. Adapt it to the existing AssessX repository rather than creating duplicate modules.

## 3.4 Part 1 — Expected User Workflow

1. Administrator downloads and launches the AssessX installer.
2. Installer checks whether administrator privileges are available.
3. Compatibility checker examines the Windows environment.
4. Hardware scanner checks the device.
5. Security readiness checker examines relevant security capabilities.
6. Installer displays the readiness report.
7. Administrator reviews and approves provisioning.
8. AssessX prepares the candidate account.
9. AssessX registers the device.
10. Configuration validator checks the installation.
11. Installer confirms successful provisioning.
12. A diagnostic report is generated.

If a critical operation fails, the installer should stop safely and initiate or offer the appropriate rollback process.

## 3.5 Part 1 — Deliverables

- Windows Compatibility Checker.
- Hardware Readiness Scanner.
- Windows Security Readiness Checker.
- Administrator Privilege Validator.
- Candidate Account Provisioning Module.
- Device Identity and Registration Foundation.
- Configuration Validation Engine.
- Installation Diagnostics Report.
- Safe Rollback Mechanism.

## 3.6 Part 1 — Completion Criteria

Part 1 is complete when:

- Supported Windows versions can be identified correctly.
- Unsupported Windows configurations are reported clearly.
- Hardware readiness can be evaluated.
- Security capabilities can be detected.
- Administrator privileges are verified.
- Candidate account provisioning works safely.
- Administrator and candidate roles are separated.
- Device registration works.
- Configuration validation produces reliable results.
- Provisioning failures are handled safely.
- Rollback is tested.
- A complete installation report is generated.

---

# 4. PART 2 — AssessX Secure Shell & Examination Startup

## 4.1 Objective

Create the dedicated examination environment in which AssessX becomes the primary interface during an examination session.

The goal is to prevent the candidate from simply leaving the AssessX interface and accessing the normal Windows desktop during a secured examination.

This part introduces the Windows kiosk or shell integration foundation.

## 4.2 Important Windows Concepts

### Windows Kiosk Mode

Windows provides kiosk-related capabilities that can configure a device to run selected applications in a restricted user experience.

Depending on Windows edition, application type, and deployment configuration, options include:

- Assigned Access.
- Shell Launcher.
- Other supported Windows policy mechanisms.

These mechanisms are not interchangeable.

**Assigned Access** provides supported kiosk and restricted-user configurations for supported Windows editions and application scenarios.

**Shell Launcher** can replace the default Windows shell with a specified application or shell. Its availability is edition-dependent and is generally associated with Enterprise, Education, and IoT Enterprise editions.

AssessX must verify the supported configuration for each targeted Windows edition before selecting a mechanism.

Do not assume that every Windows Home or Pro computer supports every kiosk feature.

## 4.3 Features and Requirements

### P2.1 — Windows Kiosk Integration

**Purpose:** Integrate AssessX with supported Windows kiosk capabilities.

The integration layer should:

- Detect whether the selected kiosk mechanism is supported.
- Validate required Windows edition and configuration.
- Prepare the appropriate kiosk configuration.
- Apply the configuration only after administrator approval.
- Verify whether the configuration was successfully applied.
- Record the result.
- Provide a restoration procedure.

The application should not pretend that kiosk mode is active merely because it has entered fullscreen.

### P2.2 — Automatic Examination Startup

**Purpose:** Start AssessX automatically in the examination account according to the configured Windows startup mechanism.

Expected workflow:

1. Device is provisioned.
2. Candidate signs in to the dedicated examination account, or the institution's configured sign-in mechanism is used.
3. Windows applies the configured kiosk or shell policy.
4. AssessX starts.
5. Security Agent status is checked.
6. AssessX validates the device and session.
7. Examination access is made available only after required checks pass.

Startup should be deterministic and should not depend on a user manually opening multiple applications.

### P2.3 — Dedicated AssessX Secure Shell

**Purpose:** Make AssessX the primary examination interface.

The shell should include:

- AssessX application window.
- Examination launch interface.
- Session status.
- Device status.
- Connection status.
- Camera and microphone status.
- Security Agent status.
- Recovery/error interface.

The secure shell should not expose unnecessary operating-system navigation.

The shell must remain responsive and recover gracefully from application errors.

### P2.4 — Fullscreen Examination Interface

**Purpose:** Display the examination interface in a controlled fullscreen experience.

Requirements:

- Fullscreen launch.
- Correct display selection.
- Resolution handling.
- Multi-monitor awareness.
- Window focus monitoring.
- Controlled window-state changes.
- Safe handling of display changes.

Fullscreen is a presentation feature, not a complete security boundary.

System-wide restrictions must be enforced separately using supported Windows controls.

### P2.5 — Desktop Restriction

**Purpose:** Restrict access to the normal Windows desktop during an examination.

The restrictions should be implemented through the selected Windows kiosk or shell configuration.

Expected behaviour:

- Normal desktop should not be available as the candidate's ordinary working interface.
- Unauthorised navigation should be restricted according to the applied policy.
- Candidate should remain within the configured AssessX environment.
- Administrator recovery must remain possible.

Do not rely solely on JavaScript keyboard event handlers or fullscreen mode to secure the operating system.

### P2.6 — Examination Startup Validation

**Purpose:** Verify that the device is ready before an examination session begins.

Checks should include:

- AssessX application integrity.
- Security Agent availability.
- Device registration status.
- Windows kiosk configuration.
- Candidate account status.
- Camera and microphone readiness, when required.
- Network availability, when required.
- Device compliance status.

The result should be one of:

- READY.
- READY_WITH_WARNINGS.
- BLOCKED.
- ERROR.

The exact rules for blocking an examination should be configurable by institutional policy.

### P2.7 — Application Crash Handling

**Purpose:** Prevent an application crash from leaving the device in an unsafe or confusing state.

Expected behaviour:

1. AssessX stops responding or exits unexpectedly.
2. The Security Agent or supported recovery mechanism detects the failure.
3. The system records the failure.
4. The configured recovery process attempts to restart AssessX.
5. Session state is recovered where possible.
6. If recovery fails, the device remains in the configured restricted state or enters an authorised recovery workflow.

Do not expose the normal desktop simply because AssessX crashes.

However, do not create an endless restart loop. Use a bounded restart policy and a clear administrator recovery path.

### P2.8 — Startup Recovery

**Purpose:** Recover from incomplete or interrupted startup.

Examples:

- Windows restarts during startup.
- AssessX fails to launch.
- Security Agent is unavailable.
- Kiosk configuration is incomplete.
- Backend is unreachable.
- Application update is interrupted.

Recovery must distinguish between:

- First-time provisioning.
- Normal device startup.
- Active examination recovery.
- Failed update recovery.
- Administrator maintenance mode.

### P2.9 — Normal-Mode Restoration

**Purpose:** Allow an authorised administrator to restore normal Windows usage when the examination environment is no longer required.

Restoration should:

- Verify administrator authorisation.
- End or safely close the active examination session.
- Restore the configured Windows shell or kiosk settings.
- Verify that normal Windows startup works.
- Preserve AssessX installation and device registration unless explicitly requested otherwise.
- Record the restoration operation.

Normal restoration must not require reinstalling Windows.

### P2.10 — Shell Health Monitoring

**Purpose:** Monitor whether the secure examination interface is operating correctly.

Monitor:

- Application process availability.
- Application responsiveness.
- Active session state.
- Window state.
- Security Agent communication.
- Kiosk configuration status.
- Unexpected application exit.
- Recovery attempts.

Health monitoring should use a reliable heartbeat or status protocol.

It should not repeatedly restart a healthy application due to temporary network or backend delays.

## 4.4 Part 2 — Session Lifecycle

The examination environment should follow a clear lifecycle.

```text
             DEVICE STARTUP
                   |
                   v
          WINDOWS USER SESSION
                   |
                   v
          ASSESSX SECURE SHELL
                   |
                   v
          SECURITY VALIDATION
                   |
          ---------------------
          |                   |
          v                   v
        FAILED               PASSED
          |                   |
          v                   v
    RECOVERY / ADMIN      SESSION READY
                              |
                              v
                      EXAMINATION ACTIVE
                              |
                    ---------------------
                    |                   |
                    v                   v
                  EXIT             INTERRUPTION
                    |                   |
                    v                   v
             AUTHORISED EXIT       RECOVERY CHECK
                    |                   |
                    v                   v
             RESTORE WINDOWS       RESUME / ADMIN
```

This lifecycle is the foundation for later activation and administrator-controlled exit workflows.

## 4.5 Part 2 — Technical Components

Recommended logical modules:

```text
secure_shell/
│
├── kiosk/
│   ├── kiosk_capability_detector
│   ├── assigned_access_manager
│   └── shell_launcher_manager
│
├── startup/
│   ├── startup_manager
│   ├── startup_validator
│   └── startup_recovery
│
├── shell/
│   ├── secure_shell_controller
│   ├── fullscreen_manager
│   └── display_manager
│
├── session/
│   ├── session_lifecycle
│   ├── session_state
│   └── session_health
│
├── crash_recovery/
│   ├── crash_detector
│   ├── restart_policy
│   └── recovery_controller
│
├── restoration/
│   ├── admin_authorisation
│   └── windows_restoration
│
└── monitoring/
    └── shell_health_monitor
```

Again, this is a proposed logical design. Reuse existing AssessX components wherever possible.

## 4.6 Part 2 — Expected User Workflow

### Initial setup

1. Administrator opens AssessX provisioning.
2. AssessX checks kiosk compatibility.
3. Administrator selects the supported kiosk configuration.
4. AssessX validates the configuration.
5. Administrator approves the changes.
6. Windows kiosk or shell configuration is applied.
7. Configuration is verified.
8. AssessX startup is tested.
9. Administrator confirms that normal Windows restoration works.

### Examination startup

1. Device starts.
2. Windows loads the configured examination account.
3. AssessX launches automatically.
4. Security Agent communicates with the application.
5. Device readiness is validated.
6. The application displays its secure examination interface.
7. The device is ready for the next authorised examination workflow.

## 4.7 Part 2 — Deliverables

- Windows Kiosk Capability Detector.
- Assigned Access Integration, where supported.
- Shell Launcher Integration, where supported.
- AssessX Secure Shell.
- Automatic Examination Startup.
- Session Lifecycle Manager.
- Fullscreen and Display Manager.
- Crash Detection and Recovery.
- Startup Recovery.
- Administrator-Controlled Windows Restoration.
- Shell Health Monitor.

## 4.8 Part 2 — Completion Criteria

Part 2 is complete when:

- Kiosk capability is detected correctly.
- Unsupported Windows editions are handled clearly.
- Supported kiosk configuration can be applied.
- AssessX starts automatically in the configured environment.
- Secure shell works reliably.
- Examination startup validation works.
- Application crashes are detected.
- Recovery is bounded and predictable.
- Normal Windows restoration works.
- Administrator restoration is protected.
- The system does not leave the computer unusable after a failure.

---

# 5. PART 3 — Native Security Agent & System Integration

## 5.1 Objective

Develop a native Windows background service responsible for monitoring and coordinating the AssessX secure environment.

This component will be called:

**AssessX Security Agent**

The Security Agent is a core system component. It should operate independently of the React user interface and communicate with the AssessX desktop application through a secure local communication mechanism.

## 5.2 Why a Native Security Agent Is Required

A normal desktop interface is not suitable for every system-level responsibility.

For example:

- Monitoring whether the AssessX application is running.
- Checking device compliance.
- Maintaining a background health status.
- Reporting unexpected application exits.
- Coordinating recovery.
- Verifying installed component integrity.
- Collecting security events.

A native Windows service is better suited to these responsibilities.

The service must not become an unrestricted administrator backdoor. Its privileges should be limited to the exact operations it needs.

## 5.3 Features and Requirements

### P3.1 — Native Windows Service

**Purpose:** Create a Windows service that runs independently of the AssessX user interface.

Recommended implementation language:

**Rust**, because the existing AssessX application already uses Tauri and Rust.

The service should:

- Install through an authorised installer.
- Start according to the configured service policy.
- Run under an appropriately restricted service account.
- Support controlled shutdown.
- Report service health.
- Recover from unexpected service failure according to a defined policy.
- Uninstall cleanly through an authorised procedure.

Do not automatically grant LocalSystem privileges unless a specific operation genuinely requires them.

### P3.2 — Service Lifecycle Management

The service must have a predictable lifecycle.

Required states:

- NOT_INSTALLED.
- STOPPED.
- STARTING.
- RUNNING.
- DEGRADED.
- STOPPING.
- FAILED.

The application should be able to determine the service state without needing unrestricted access to service-control operations.

### P3.3 — Secure IPC Between Agent and AssessX

**Purpose:** Establish secure communication between the Windows service and the desktop application.

IPC means Inter-Process Communication.

Possible Windows mechanisms include:

- Named Pipes.
- Authenticated local RPC.
- Other appropriate local Windows communication mechanisms.

For the initial implementation, Windows Named Pipes are a reasonable option to evaluate.

Security requirements:

- Restrict pipe access using Windows security descriptors.
- Authenticate the connecting process or user context.
- Validate every request.
- Use explicit message schemas.
- Apply message size limits.
- Reject unknown commands.
- Prevent unauthorised clients from invoking privileged operations.
- Avoid passing secrets through ordinary command-line arguments.

Example conceptual message:

```json
{
  "message_type": "HEALTH_CHECK",
  "request_id": "random-request-id",
  "timestamp": "2026-01-01T10:00:00Z"
}
```

Example response:

```json
{
  "message_type": "HEALTH_RESPONSE",
  "request_id": "random-request-id",
  "service_status": "RUNNING",
  "agent_version": "1.0.0"
}
```

These examples describe the message concept, not a final protocol definition.

### P3.4 — Examination Session Monitoring

**Purpose:** Monitor the state of the active AssessX examination environment.

The agent should monitor:

- AssessX process availability.
- Active session status.
- Application heartbeat.
- Kiosk or shell configuration status.
- Device registration status where available.
- Security component health.
- Unexpected process termination.
- Relevant Windows session changes.

The agent should distinguish between:

- Normal application shutdown.
- Unexpected application termination.
- Temporary unresponsiveness.
- Service communication failure.
- Actual security-policy violation.

Not every application failure should automatically be classified as cheating.

### P3.5 — Device Compliance Engine

**Purpose:** Determine whether the device continues to satisfy the required examination security conditions.

Potential checks:

- Supported Windows configuration.
- Candidate account status.
- Security Agent status.
- AssessX application integrity.
- Kiosk configuration status.
- Required security capabilities.
- Approved peripheral configuration.
- Required network connectivity.

The compliance engine should return structured results.

Example:

```json
{
  "device_id": "device-id",
  "compliance_status": "COMPLIANT",
  "checks": [
    {
      "name": "security_agent",
      "status": "PASS"
    },
    {
      "name": "kiosk_configuration",
      "status": "PASS"
    },
    {
      "name": "application_integrity",
      "status": "PASS"
    }
  ]
}
```

Possible overall statuses:

- COMPLIANT.
- NON_COMPLIANT.
- WARNING.
- UNKNOWN.

The compliance rules should be versioned so that the institution and backend can identify which policy was applied.

### P3.6 — Component Integrity Verification

**Purpose:** Verify that critical AssessX components have not been unexpectedly modified.

Components to verify may include:

- AssessX executable.
- Security Agent executable.
- Required configuration files.
- Approved security policy files.
- Update packages.
- Relevant signed components.

Use:

- Authenticode signature validation where applicable.
- Trusted publisher verification.
- Cryptographic hashes.
- Signed manifests.
- Version verification.

A hash alone does not establish trust if an attacker can modify both the file and the expected hash. The trusted manifest or verification key must be protected.

The verification process should report:

- VALID.
- INVALID_SIGNATURE.
- HASH_MISMATCH.
- UNKNOWN_PUBLISHER.
- MISSING_COMPONENT.
- VERIFICATION_ERROR.

### P3.7 — Tamper Detection

**Purpose:** Detect unexpected changes to AssessX's security-related components and configuration.

Potential events:

- Security Agent unexpectedly stopped.
- AssessX executable modified.
- Critical configuration modified.
- Kiosk configuration changed.
- Service configuration changed.
- Unexpected service removal.
- IPC authentication failure.

The agent should record and report events without making unsupported assumptions about user intent.

**Important:** Detection is not the same as prevention. Some tampering may require operating-system-enforced policies or administrator-managed protections introduced in later phases.

### P3.8 — Security Event Reporting

**Purpose:** Send relevant device events to the AssessX backend.

Example event categories:

- AGENT_STARTED.
- AGENT_STOPPED.
- APPLICATION_STARTED.
- APPLICATION_CRASHED.
- DEVICE_NON_COMPLIANT.
- INTEGRITY_CHECK_FAILED.
- KIOSK_CONFIGURATION_CHANGED.
- IPC_AUTHENTICATION_FAILED.
- RECOVERY_STARTED.
- RECOVERY_COMPLETED.

Each event should contain:

- Event ID.
- Device ID.
- Event type.
- Timestamp.
- Severity.
- Session ID, where applicable.
- Relevant diagnostic details.
- Event schema version.

Events should be sent through authenticated backend APIs.

The service must not include passwords, private keys, access tokens, or unnecessary personal data in diagnostic events.

### P3.9 — Authenticated Backend Integration

**Purpose:** Allow the Security Agent to report device health and relevant security events to the backend.

Requirements:

- Authenticated communication.
- TLS-protected network requests.
- Secure credential storage.
- Token rotation or renewal where appropriate.
- Request validation.
- Retry handling.
- Timeout handling.
- Duplicate-event protection.
- Offline event queueing.

The agent should not contain a Supabase service-role key or other backend administrator secret.

The backend should validate that the device is registered and authorised before accepting device reports.

### P3.10 — Diagnostic Logging

**Purpose:** Maintain useful operational and security logs.

Log categories:

- Service lifecycle.
- IPC communication.
- Device compliance.
- Integrity verification.
- Session monitoring.
- Backend communication.
- Recovery operations.
- Errors and exceptions.

Logging requirements:

- Structured logs.
- Timestamps.
- Severity levels.
- Event correlation IDs.
- Rotation and storage limits.
- Restricted access.
- Sensitive-data redaction.

Do not log passwords, authentication tokens, private keys, or examination answers.

### P3.11 — Recovery Coordination

**Purpose:** Coordinate recovery when AssessX or one of its critical components fails.

Examples:

- AssessX process exits unexpectedly.
- Agent loses communication with the desktop application.
- Required component fails an integrity check.
- Device compliance changes.
- Backend connection is temporarily lost.

The agent should:

1. Detect the failure.
2. Record the event.
3. Determine the appropriate recovery policy.
4. Attempt only authorised recovery operations.
5. Report the result.
6. Escalate to administrator recovery when automatic recovery is unsuccessful.

The agent must not enter an uncontrolled restart loop.

### P3.12 — Least-Privilege Design

**Purpose:** Ensure that the Security Agent has only the permissions required for its duties.

Requirements:

- Use a restricted service identity where possible.
- Separate privileged operations from monitoring operations.
- Validate all IPC requests.
- Restrict service-control permissions.
- Restrict access to configuration and log files.
- Protect cryptographic material.
- Avoid arbitrary command execution.
- Avoid unrestricted shell or PowerShell execution.
- Do not provide a generic remote command interface.

The service should expose a small, explicitly defined set of operations.

## 5.4 Part 3 — Technical Components

Recommended logical modules:

```text
security_agent/
│
├── service/
│   ├── service_entry
│   ├── service_lifecycle
│   └── service_configuration
│
├── ipc/
│   ├── pipe_server
│   ├── authentication
│   ├── message_schema
│   └── request_validator
│
├── monitoring/
│   ├── process_monitor
│   ├── session_monitor
│   ├── heartbeat_monitor
│   └── shell_monitor
│
├── compliance/
│   ├── compliance_engine
│   ├── policy_evaluator
│   └── compliance_report
│
├── integrity/
│   ├── signature_verifier
│   ├── hash_verifier
│   └── manifest_validator
│
├── tamper_detection/
│   ├── configuration_monitor
│   ├── service_monitor
│   └── event_classifier
│
├── backend/
│   ├── api_client
│   ├── authentication
│   ├── event_sender
│   └── offline_queue
│
├── diagnostics/
│   ├── structured_logger
│   └── log_rotation
│
└── recovery/
    ├── recovery_controller
    └── recovery_policy
```

The final structure should be adapted to the existing Rust workspace and repository.

## 5.5 Part 3 — Agent Communication Flow

```text
            ASSESSX DESKTOP APPLICATION
                       |
                       |
                 Secure IPC
                       |
                       v
             ASSESSX SECURITY AGENT
                       |
          -----------------------------
          |             |             |
          v             v             v
       MONITOR       COMPLIANCE     INTEGRITY
          |             |             |
          -----------------------------
                       |
                       v
                EVENT PROCESSOR
                       |
                       v
                SECURE API CLIENT
                       |
                       v
                 ASSESSX BACKEND
                       |
                       v
              INSTITUTION / ADMIN
```

## 5.6 Part 3 — Expected Operational Workflow

1. Windows starts the Security Agent according to its configured service policy.
2. Agent validates its own configuration.
3. Agent checks required AssessX components.
4. AssessX desktop application starts.
5. Application establishes authenticated IPC communication.
6. Agent reports its health status.
7. Device compliance checks are performed.
8. Relevant events are generated.
9. Events are sent to the backend when connectivity is available.
10. Agent maintains diagnostic records.
11. If a critical failure occurs, the agent coordinates the configured recovery procedure.

## 5.7 Part 3 — Deliverables

- AssessX Native Windows Security Agent.
- Windows Service Installer and Lifecycle Manager.
- Secure IPC Communication Module.
- Session Monitoring Module.
- Device Compliance Engine.
- Component Integrity Verification.
- Tamper Detection Foundation.
- Security Event Reporter.
- Authenticated Backend Client.
- Structured Diagnostic Logging.
- Recovery Coordination Module.
- Least-Privilege Service Configuration.

## 5.8 Part 3 — Completion Criteria

Part 3 is complete when:

- Security Agent installs successfully.
- Service starts and stops predictably.
- Service operates under an appropriately restricted identity.
- AssessX and the agent communicate securely.
- Unauthenticated IPC requests are rejected.
- Device compliance checks work.
- Component integrity checks work.
- Relevant tampering events are detected.
- Security events reach the backend securely.
- Temporary network failures do not cause uncontrolled failure.
- Diagnostic logs are generated safely.
- Recovery operations work as designed.
- The service does not expose unrestricted privileged operations.

---

# 6. Integration Between All Three Parts

The three parts must not be developed as unrelated modules.

They form a single system.

## 6.1 Integration Sequence

| Sequence | Component | Result |
|---|---|---|
| 1 | Part 1 — Compatibility | Device support established |
| 2 | Part 1 — Hardware and security checks | Readiness established |
| 3 | Part 1 — Account provisioning | Candidate account prepared |
| 4 | Part 1 — Registration | Device identity established |
| 5 | Part 1 — Configuration validation | Installation validated |
| 6 | Part 2 — Kiosk integration | Secure shell configuration prepared |
| 7 | Part 2 — Startup | AssessX launches in configured environment |
| 8 | Part 3 — Security Agent | Background service starts |
| 9 | Part 3 — Secure IPC | Application and agent communicate |
| 10 | Part 3 — Compliance | Device status evaluated |
| 11 | Part 3 — Event reporting | Device events reach backend |

## 6.2 Combined Device State

The system should maintain a clear device state.

Suggested states:

- UNPROVISIONED.
- PROVISIONING.
- PROVISIONING_FAILED.
- PROVISIONED.
- CONFIGURATION_PENDING.
- SECURE_SHELL_READY.
- AGENT_READY.
- COMPLIANT.
- NON_COMPLIANT.
- MAINTENANCE.
- RECOVERY_REQUIRED.

These states should have documented transition rules.

A device should not be marked COMPLIANT merely because the AssessX application opened successfully.

## 6.3 Combined Readiness Decision

Before the device is considered ready for an examination workflow, the system should evaluate:

```text
Windows Compatibility
        +
Hardware Readiness
        +
Security Readiness
        +
Candidate Account
        +
Device Registration
        +
Secure Shell Configuration
        +
Security Agent Health
        +
Device Compliance
        |
        v
  DEVICE READINESS RESULT
```

The institution should be able to identify which check failed and why.

---

# 7. Security and Reliability Requirements

## 7.1 Security Requirements

- No plaintext passwords.
- No hardcoded backend administrator secrets.
- No unrestricted privileged IPC.
- No arbitrary remote command execution.
- No unauthorised Windows policy modification.
- No unnecessary administrator privileges.
- No unverified executable updates.
- No automatic deletion of pre-existing user data.
- No silent disabling of Windows security features.
- No assumption that fullscreen equals secure kiosk mode.

## 7.2 Reliability Requirements

- Provisioning must be repeatable.
- Installation failures must be diagnosable.
- Rollback must be tested.
- Service failures must be recoverable.
- Application crashes must not cause uncontrolled restart loops.
- Temporary backend failure must be handled.
- Device status must not become misleading during network outages.
- Normal Windows restoration must be tested.
- Security policies must not be applied without a recovery plan.

## 7.3 Privacy Requirements

Collect only the information needed for device readiness, security monitoring, and examination operation.

The Security Agent should not collect arbitrary personal files, passwords, unrelated user activity, or unnecessary device information.

Diagnostic logs should be designed to avoid storing examination answers or sensitive authentication material.

---

# 8. Testing Strategy

Every part must be tested independently before full integration.

## 8.1 Part 1 Testing

| Test | Expected result |
|---|---|
| Supported Windows edition | Correctly identified |
| Unsupported edition | Clearly reported |
| Hardware scanner | Detects required hardware |
| Camera unavailable | Warning or failure according to policy |
| Microphone unavailable | Warning or failure according to policy |
| TPM unavailable | Correctly reported |
| Secure Boot disabled | Correctly reported |
| Non-admin launch | Requests required elevation |
| Candidate account creation | Account created correctly |
| Existing account | No duplicate or destructive action |
| Device registration | Successful authenticated registration |
| Backend unavailable | Clear failure or pending state |
| Provisioning interruption | Safe recovery |
| Rollback | Previous configuration restored where supported |

## 8.2 Part 2 Testing

| Test | Expected result |
|---|---|
| Supported kiosk configuration | Successfully applied |
| Unsupported Windows edition | Clear compatibility result |
| Automatic startup | AssessX launches |
| Fullscreen | Correct display behaviour |
| Application crash | Recovery initiated |
| Repeated crash | Bounded recovery and admin escalation |
| Startup failure | Safe recovery workflow |
| Kiosk configuration failure | Device does not falsely report readiness |
| Administrator restoration | Normal Windows mode restored |
| Restart | Configured startup behaviour retained |

## 8.3 Part 3 Testing

| Test | Expected result |
|---|---|
| Agent installation | Successful |
| Agent startup | Service reaches RUNNING |
| Agent shutdown | Controlled shutdown |
| IPC connection | Authenticated communication |
| Unauthorised IPC client | Request rejected |
| Invalid message | Rejected safely |
| Application crash | Event detected |
| Agent crash | Service recovery policy works |
| Integrity mismatch | Event generated |
| Configuration change | Relevant change detected |
| Backend unavailable | Events queued or failure reported |
| Backend reconnects | Pending events handled safely |
| Log rotation | Storage remains controlled |

## 8.4 Integration Testing

Test the complete lifecycle:

1. Fresh compatible Windows computer.
2. AssessX installation.
3. Provisioning.
4. Candidate account preparation.
5. Device registration.
6. Kiosk configuration.
7. Device restart.
8. Automatic AssessX startup.
9. Security Agent startup.
10. IPC communication.
11. Compliance validation.
12. Simulated application crash.
13. Recovery.
14. Administrator restoration.
15. Normal Windows operation.

---

# 9. Windows Compatibility and Development Environment

## 9.1 Windows Edition Considerations

Not all Windows editions expose the same kiosk and management capabilities.

The implementation must maintain a documented compatibility matrix.

| Capability | Compatibility requirement |
|---|---|
| OS detection | Supported Windows editions |
| Hardware scanning | Supported Windows editions |
| Candidate account management | Permission and edition dependent |
| Assigned Access | Validate supported edition and scenario |
| Shell Launcher | Validate supported edition; generally Enterprise/Education/IoT Enterprise |
| Windows service | Validate installation permissions and service configuration |
| Application control | Advanced policy and edition requirements to be evaluated in Phase 2 |

Do not claim that every Windows Home, Pro, or Enterprise computer supports identical secure-shell capabilities.

## 9.2 Development and Testing Environment

Use a staged test environment.

Recommended:

- Development machine for ordinary application development.
- Separate Windows virtual machine for provisioning tests.
- Separate supported Windows edition for kiosk and shell integration testing.
- A dedicated physical test computer for hardware and real-world validation.

**Do not experiment with aggressive kiosk or shell replacement settings on the primary development computer.**

Maintain a recovery administrator account and a tested restoration procedure.

---

# 10. Implementation Order

The recommended implementation order is:

## Part 1

1. Inspect existing AssessX repository and architecture.
2. Identify existing readiness and device-detection features.
3. Create or update the Windows compatibility checker.
4. Implement hardware readiness checks.
5. Implement security readiness checks.
6. Implement administrator privilege validation.
7. Implement candidate account management.
8. Implement device identity and registration.
9. Implement configuration validation.
10. Implement diagnostic reporting.
11. Implement rollback.
12. Test on supported Windows environments.

## Part 2

1. Inspect existing fullscreen and kiosk-related code.
2. Document supported Windows editions and kiosk mechanisms.
3. Implement kiosk capability detection.
4. Implement the selected kiosk integration.
5. Implement automatic startup.
6. Build the secure shell lifecycle.
7. Implement startup validation.
8. Implement crash detection and recovery.
9. Implement administrator restoration.
10. Test startup, failure, recovery, and restoration.

## Part 3

1. Inspect existing Rust and Tauri architecture.
2. Define Security Agent boundaries.
3. Implement Windows service lifecycle.
4. Implement restricted service identity.
5. Define IPC message schemas.
6. Implement authenticated IPC.
7. Implement session monitoring.
8. Implement compliance checks.
9. Implement component integrity verification.
10. Implement tamper event detection.
11. Implement backend event reporting.
12. Implement diagnostic logging.
13. Implement recovery coordination.
14. Test security boundaries and reliability.

---

# 11. Phase 1 Final Acceptance Criteria

Phase 1 is considered complete only when the following requirements have been tested.

## Part 1 — Provisioning

- [ ] Windows compatibility detection works.
- [ ] Hardware readiness scanning works.
- [ ] Security readiness scanning works.
- [ ] Administrator privilege verification works.
- [ ] Candidate account provisioning works.
- [ ] Administrator and candidate roles are separated.
- [ ] Device identity is generated securely.
- [ ] Device registration works.
- [ ] Configuration validation works.
- [ ] Diagnostic report is generated.
- [ ] Rollback is tested.

## Part 2 — Secure Shell

- [ ] Kiosk capability detection works.
- [ ] Supported kiosk configuration can be applied.
- [ ] Unsupported configurations are reported.
- [ ] AssessX starts automatically in the configured environment.
- [ ] Secure shell operates correctly.
- [ ] Examination startup validation works.
- [ ] Application crash is detected.
- [ ] Recovery is bounded and predictable.
- [ ] Administrator restoration works.
- [ ] Normal Windows operation is restored successfully.

## Part 3 — Security Agent

- [ ] Native Windows service installs successfully.
- [ ] Service lifecycle is reliable.
- [ ] Service uses appropriate privileges.
- [ ] Secure IPC works.
- [ ] Unauthorised IPC requests are rejected.
- [ ] Session monitoring works.
- [ ] Device compliance engine works.
- [ ] Component integrity verification works.
- [ ] Tamper events are detected.
- [ ] Backend event reporting works.
- [ ] Diagnostic logs are generated.
- [ ] Recovery coordination works.

## Overall Phase 1

**Phase 1 is complete when a compatible existing Windows computer can be provisioned, configured to launch AssessX through a supported secure-shell mechanism, monitored by the native Security Agent, and safely restored by an authorised administrator.**

This does not mean that every possible Windows bypass has been eliminated. System-wide application restrictions, advanced lockdown policies, administrator activation and exit codes, and broader penetration testing remain separate deliverables in later phases.

---

# 12. Scope Boundaries — What Phase 1 Does Not Include

To prevent scope confusion, the following should not be treated as Phase 1 completion requirements.

| Feature | Planned phase |
|---|---|
| Comprehensive application allowlisting | Phase 2 |
| Advanced PowerShell/CMD restrictions | Phase 2 |
| Task Manager and system utility restrictions | Phase 2 |
| Comprehensive shortcut and navigation restrictions | Phase 2 |
| USB storage control | Phase 2 |
| Advanced display and peripheral policies | Phase 2 |
| Advanced remote-access restrictions | Phase 2 |
| Administrator-controlled activation codes | Phase 3 |
| Administrator-controlled exit authorisation | Phase 3 |
| Complete institutional admin dashboard | Phase 3 |
| Remote device policy management | Phase 3 |
| Advanced answer persistence and recovery | Phase 3 |
| Full penetration testing | Phase 4 |
| Independent security audit | Phase 4 |
| Institutional production rollout | Phase 4 |
| Linux version | Future optional expansion, not current scope |

---

# 13. Instructions for AI Development Assistants

This section is important when using Claude or another AI coding assistant.

## 13.1 Existing Project Must Be Preserved

AssessX is an existing project.

Do not rebuild it from scratch.

Before making changes:

1. Inspect the complete repository structure.
2. Read the existing project documentation.
3. Read the PRD, TRD, Knowledge Base, and project context files.
4. Inspect the current Tauri, React, TypeScript, and Rust architecture.
5. Inspect existing backend APIs and database models.
6. Identify already implemented functionality.
7. Identify incomplete or partially implemented functionality.
8. Identify tests and existing security mechanisms.
9. Prepare an implementation plan before editing files.

## 13.2 Avoid Duplicate Implementations

Existing AssessX functionality may already cover some requirements.

For example, existing code may include:

- Fullscreen management.
- Focus monitoring.
- Clipboard restrictions.
- Context-menu restrictions.
- Print restrictions.
- Developer-tools restrictions.
- Screen-capture exclusion.
- Multi-monitor detection.
- RDP detection.
- Process readiness checks.
- Some shortcut restrictions.
- Device readiness checks.
- Windows kiosk configuration scripts.

Do not create duplicate implementations without first examining the existing code.

Classify every feature as:

- IMPLEMENTED.
- PARTIALLY_IMPLEMENTED.
- MISSING.
- NEEDS_REFACTORING.
- NEEDS_VALIDATION.

A feature should not be marked complete solely because a corresponding source file exists. Verify its actual behaviour and tests.

## 13.3 Development Rules

- Preserve the current application architecture unless a justified change is necessary.
- Keep TypeScript and Rust responsibilities clearly separated.
- Use typed interfaces and validated message schemas.
- Use secure Windows APIs.
- Avoid unnecessary administrator privileges.
- Avoid hardcoded secrets.
- Do not use broad process-killing mechanisms.
- Do not disable essential Windows security features.
- Do not silently modify Windows configuration.
- Add tests for new functionality.
- Maintain backward compatibility where practical.
- Document Windows edition requirements.
- Document every privileged operation.
- Keep recovery and rollback in scope for every configuration change.

## 13.4 Required Development Reporting

After completing each implementation task, report:

1. What was inspected.
2. What already existed.
3. What was implemented.
4. Which files were changed.
5. Why each change was necessary.
6. Which tests were added or updated.
7. Which tests were executed.
8. Test results.
9. Known limitations.
10. Remaining work.

Do not report a feature as complete unless it has been implemented and validated.

---

# 14. Phase 1 Definition of Done

The final outcome of Phase 1 should be a reliable Windows foundation for AssessX.

A compatible computer should be able to:

1. Pass the AssessX compatibility and readiness checks.
2. Be provisioned with a dedicated candidate account.
3. Be registered as an AssessX-managed device.
4. Apply a supported Windows kiosk or shell configuration.
5. Start AssessX automatically in the configured examination environment.
6. Run the native AssessX Security Agent.
7. Establish authenticated communication between the application and agent.
8. Report device compliance and relevant security events.
9. Recover safely from expected application and service failures.
10. Return to normal Windows operation through an authorised restoration workflow.

**Final principle:** Phase 1 builds the foundation. Phase 2 strengthens operating-system lockdown, Phase 3 adds institutional and administrator control, and Phase 4 validates the complete product for reliable deployment.

