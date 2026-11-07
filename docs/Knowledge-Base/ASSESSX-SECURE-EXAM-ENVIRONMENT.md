# ASSESSX SECURE EXAM ENVIRONMENT
## Four-Phase Product Knowledge Base & Feature Specification

**Project:** AssessX  
**Product:** AssessX Secure Exam Environment  
**Platform:** Windows-first  
**Document Type:** Product Knowledge Base / Feature Specification  
**Status:** Planned Development  
**Scope:** Four major phases extending the existing AssessX application and its completed security and deployment work through Phase 8.

---

# 1. PRODUCT VISION

AssessX Secure Exam Environment aims to transform an ordinary supported Windows computer into a dedicated, restricted examination terminal.

During an active examination, the candidate should only be able to interact with the AssessX examination interface and explicitly authorised functionality.

The system must restrict access to:
- PowerShell
- Command Prompt
- Task Manager
- File Explorer
- Windows Settings
- Unauthorised browsers
- Unauthorised applications
- Unauthorised scripts and executables
- Unauthorised USB storage
- Normal desktop functionality
- Unauthorised system navigation and switching

The administrator must retain authorised control over:
- Device enrolment
- Exam activation
- Exam termination
- Security policies
- Device monitoring
- Recovery
- Application updates
- Device release

## 1.1 Core Product Principles

1. Security must be enforced through Windows system-level controls, not just frontend restrictions.
2. AssessX must not rely exclusively on fullscreen mode.
3. Candidates must not have administrator privileges.
4. Security policies must be centrally manageable.
5. Exam sessions must be recoverable after unexpected failures.
6. All sensitive administrator actions must be authenticated and logged.
7. Only authorised software should execute during an examination.
8. Security controls must not unnecessarily damage or disable Windows.
9. The system must support institutional deployment on existing compatible computers.
10. Security must be independently tested before production claims are made.

---

# 2. PHASE 1 — WINDOWS SECURE ENVIRONMENT FOUNDATION

> **Detailed Technical Specification:** See [ASSESSX-PHASE-1-WINDOWS-SECURE-FOUNDATION.md](./ASSESSX-PHASE-1-WINDOWS-SECURE-FOUNDATION.md) for the complete Phase 1 implementation guide, architecture diagrams, module breakdown, IPC contracts, and testing strategy.

## Objective

Build the foundation that allows AssessX to operate as a dedicated Windows examination environment rather than an ordinary desktop application.

## Feature 1.1 — Supported Windows Environment

- Support approved Windows editions and versions.
- Establish a hardware compatibility matrix.
- Detect Windows edition and build number.
- Verify system architecture and required dependencies.
- Check Secure Boot status.
- Check TPM availability where required.
- Check administrator privileges and device configuration.
- Detect unsupported or non-compliant system configurations.
- Prevent exam activation when mandatory requirements are not satisfied.

## Feature 1.2 — Dedicated Examination Account

- Create or provision a dedicated standard Windows examination account.
- Ensure the candidate does not receive administrator privileges.
- Separate examination access from institutional administrator access.
- Restrict unnecessary account switching.
- Protect administrator credentials.
- Define account lifecycle and cleanup procedures.
- Prevent candidates from modifying security configurations.

## Feature 1.3 — Dedicated AssessX Examination Shell

- Automatically launch AssessX when the examination environment starts.
- Configure Windows Assigned Access or Shell Launcher according to the selected deployment model and supported Windows edition.
- Prevent normal desktop access during the active examination.
- Restrict access to the Windows Start menu and normal desktop interface.
- Hide unnecessary system navigation.
- Launch the approved AssessX examination interface.
- Provide a controlled transition into and out of exam mode.
- Handle application crashes and unexpected closures.

## Feature 1.4 — Native Windows Security Agent

Develop a dedicated native Windows service responsible for security-related operations.

Responsibilities:
- Monitor AssessX security-service health.
- Verify examination-session status.
- Check device compliance.
- Detect unauthorised configuration changes.
- Report security events.
- Communicate with the AssessX examination client.
- Communicate with the backend through authenticated APIs.
- Support authorised recovery.
- Maintain service health and diagnostic logs.

The security agent must use appropriate Windows service permissions and must not provide candidates with privileged command execution.

## Feature 1.5 — Application and Security Module Separation

Separate the existing application into logical components:

- AssessX Exam Client
- AssessX Windows Security Agent
- AssessX Session Controller
- AssessX Device Manager
- AssessX Admin Console
- AssessX Backend Services

Keep examination logic separate from Windows-specific lockdown functionality.

## Feature 1.6 — Secure Startup

- Start the examination environment using approved Windows configuration.
- Verify the integrity and signature of AssessX components.
- Check device compliance before allowing an examination.
- Prevent normal candidate access before the exam environment is ready.
- Handle failed startup safely.
- Provide an authorised recovery path.

### Phase 1 Acceptance Criteria

Phase 1 is complete when:

1. A supported, provisioned Windows computer can enter the AssessX examination environment.
2. The normal student desktop is unavailable during the configured examination session.
3. AssessX launches automatically.
4. The candidate operates under a non-administrator account.
5. The native security service operates reliably.
6. Device compliance is checked before examination activation.
7. Application failures do not permanently lock the computer.
8. An authorised administrator can recover the device.

---

# 3. PHASE 2 — SYSTEM-WIDE LOCKDOWN AND APPLICATION CONTROL

## Objective

Implement Windows-enforced restrictions so that candidates cannot use unauthorised applications, operating-system utilities or system functionality during examinations.

This phase is the core security layer of AssessX.

## Feature 2.1 — Application Allowlisting

Implement Windows Defender Application Control (WDAC) or AppLocker, according to supported editions, policy requirements and deployment constraints.

Capabilities:
- Define approved application policies.
- Allow signed AssessX components.
- Allow required Windows system components.
- Block unauthorised executables.
- Restrict unauthorised script execution.
- Restrict unauthorised installers.
- Prevent execution from prohibited locations.
- Apply policies before examinations begin.
- Verify policy integrity.
- Support controlled policy updates.

Application allowlisting must be enforced by Windows security mechanisms rather than relying on AssessX to repeatedly terminate unwanted processes.

## Feature 2.2 — System Utility Restrictions

The following restrictions must be implemented and validated.

| System component | Required policy |
|---|---|
| PowerShell | Block unauthorised candidate access and execution |
| PowerShell ISE | Block |
| Command Prompt | Block |
| Task Manager | Restrict |
| Registry Editor | Restrict |
| File Explorer | Restrict during exam |
| Windows Settings | Restrict |
| Control Panel | Restrict |
| Run dialog | Restrict |
| Unauthorised browsers | Block |
| Unauthorised installers | Block |
| Remote desktop tools | Block or restrict |
| Unauthorised scripts | Block |
| Unauthorised applications | Block |

Essential Windows security, service and recovery components must remain available to the operating system.

## Feature 2.3 — Desktop and Navigation Restrictions

- Restrict access to the normal desktop.
- Restrict unauthorised application switching.
- Restrict Start menu access.
- Restrict Windows key combinations where supported.
- Restrict Alt+Tab and other application-switching paths.
- Restrict access to the notification area and system navigation.
- Restrict unauthorised taskbar interaction.
- Restrict access to Windows system interfaces.
- Detect unexpected changes in the examination shell.

Restrictions must be tested individually. Not every system-level shortcut can be reliably disabled by an ordinary application.

## Feature 2.4 — USB and External Device Control

- Detect newly connected USB devices.
- Identify USB storage devices.
- Restrict unauthorised storage devices using Windows device-control policies.
- Allow approved examination peripherals.
- Maintain an authorised device list.
- Record USB connection and disconnection events.
- Detect unauthorised device changes during examinations.

Do not indiscriminately disable keyboards, mice, cameras or other required peripherals.

## Feature 2.5 — Multi-Monitor and Display Security

- Detect connected displays.
- Record display configuration.
- Detect monitor changes during examinations.
- Apply institution-defined display policies.
- Restrict unsupported remote-display configurations where possible.
- Detect display topology changes and generate security events.

## Feature 2.6 — Network and Remote Access Restrictions

- Detect remote desktop sessions.
- Detect known unauthorised remote-control software.
- Apply approved network restrictions.
- Restrict unauthorised network communication.
- Protect AssessX backend communication.
- Detect unexpected network changes.
- Support secure reconnection after network interruptions.

## Feature 2.7 — Screen Capture and Recording Protection

- Use supported Windows and application-level protections.
- Prevent or restrict ordinary screen-capture methods where supported.
- Detect known screen-recording applications.
- Record suspicious screen-capture attempts where observable.
- Clearly document limitations against external cameras and hardware capture devices.

## Feature 2.8 — Security Policy Integrity

- Protect approved security configurations.
- Verify policy versions.
- Verify application signatures.
- Detect unauthorised policy modifications.
- Detect security-service tampering.
- Record security violations.
- Report device compliance to the backend.

### Phase 2 Acceptance Criteria

Phase 2 is complete when:

1. Unauthorised applications cannot execute under the tested examination policies.
2. PowerShell, CMD and Task Manager are inaccessible to the candidate.
3. Normal desktop access is restricted.
4. Unauthorised storage devices are blocked according to policy.
5. Approved peripherals continue functioning.
6. Application-switching and system navigation restrictions are validated.
7. Security policy modifications are detected.
8. Security violations are recorded.
9. Windows remains stable and its essential services continue operating.

---

# 4. PHASE 3 — ADMINISTRATOR CONTROL, SECURE ENTRY AND RECOVERY

## Objective

Develop complete administrator-controlled examination sessions and centralised device management.

The administrator must control when a device enters examination mode, which policies apply and when it can be released.

## Feature 3.1 — Device Registration and Enrolment

- Register examination computers with AssessX.
- Assign devices to institutions.
- Assign devices to examination centres.
- Generate unique device identifiers.
- Authenticate registered devices.
- Store device configuration and compliance information.
- Track device status.
- Support device revocation.
- Prevent unregistered devices from joining managed examinations.

## Feature 3.2 — Secure Exam Activation

- Administrator creates or schedules an examination.
- Backend generates a cryptographically random activation credential.
- Activation credential is short-lived.
- Credential is single-use.
- Credential is bound to the candidate, examination and registered device.
- Candidate enters the activation code or receives authorised activation.
- Device verifies the activation request with the backend.
- Device validates its security configuration.
- Secure Exam Mode activates only after successful verification.

## Feature 3.3 — Secure Exam Exit

- Candidates cannot independently release the managed device.
- Administrator can authorise examination termination.
- Backend generates a secure exit authorisation.
- Exit authorisation is short-lived and single-use.
- Exit request is bound to the registered device and active session.
- Device validates the exit authorisation.
- AssessX closes the examination session safely.
- Normal Windows environment is restored according to the approved device configuration.
- Exit actions are recorded in the audit log.

## Feature 3.4 — Administrator Dashboard

The administrator must have a central dashboard containing:

- Registered devices.
- Online and offline devices.
- Active examination sessions.
- Candidate information.
- Device compliance status.
- Security violations.
- Application health.
- Security-agent health.
- Exam activation status.
- Exam exit status.
- Device recovery status.
- Last communication time.

## Feature 3.5 — Role-Based Access Control

Create separate administrator roles.

**Super Administrator**
- Manage institutions.
- Manage system-wide configurations.
- Manage administrator accounts.
- Manage security policies.
- Manage device registration.
- Access audit records.

**Institution Administrator**
- Manage institutional examinations.
- Manage candidates.
- Manage examination devices.
- Configure institution-level policies.
- View reports.

**Examination Administrator / Invigilator**
- Start assigned examinations.
- Monitor candidates.
- View security alerts.
- Authorise permitted examination actions.
- Request or initiate authorised device release according to permissions.

All sensitive actions must require authentication and be recorded.

## Feature 3.6 — Remote Device Management

- Push security policies.
- Synchronise device configuration.
- Monitor device compliance.
- Revoke device access.
- Update examination settings.
- View security-agent health.
- Receive device status updates.
- Track configuration changes.
- Support bulk device management.

## Feature 3.7 — Crash and Power-Failure Recovery

- Detect unexpected AssessX termination.
- Detect security-service failures.
- Recover examination sessions after application restart.
- Resume from a validated saved state.
- Preserve confirmed answer submissions.
- Support safe recovery after system restart.
- Prevent unauthorised access during recovery.
- Record recovery events.
- Notify administrators of serious failures.

## Feature 3.8 — Answer Persistence

- Save answers through authenticated backend APIs.
- Use appropriate local persistence for temporary offline conditions.
- Encrypt sensitive local examination data.
- Track answer versions.
- Prevent duplicate submissions.
- Synchronise pending answers after reconnection.
- Maintain server-side submission acknowledgements.
- Avoid treating an unconfirmed save as a successful submission.

## Feature 3.9 — Offline and Network Recovery

- Detect network disconnection.
- Preserve locally authorised examination state.
- Retry backend communication safely.
- Queue permitted events.
- Synchronise after reconnection.
- Prevent duplicate answer submissions.
- Notify the administrator of prolonged disconnection.
- Apply institution-defined offline examination policies.

Offline exam delivery must be implemented as a separate, validated capability; it must not be assumed merely because local caching exists.

## Feature 3.10 — Signed Updates

- Deliver signed update packages.
- Verify package authenticity.
- Verify application integrity.
- Support controlled deployment.
- Support version compatibility checks.
- Record update status.
- Recover from failed updates.
- Prevent unauthorised software replacement.

## Feature 3.11 — Audit Logging

Record:
- Device enrolment.
- Candidate login.
- Exam activation.
- Exam termination.
- Exit authorisation.
- Security violations.
- Device disconnections.
- Service failures.
- Recovery actions.
- Administrator actions.
- Policy changes.
- Application updates.

Audit records must be protected against unauthorised modification.

### Phase 3 Acceptance Criteria

Phase 3 is complete when:

1. Administrators can register and manage examination devices.
2. Secure activation and exit work reliably.
3. Candidates cannot independently release managed devices.
4. All administrator permissions are enforced.
5. Device status is available centrally.
6. Security policies can be distributed and verified.
7. Examination sessions recover safely from tested failures.
8. Confirmed answers are preserved.
9. Device and administrator actions are auditable.
10. Signed updates can be deployed and recovered safely.

---

# 5. PHASE 4 — SECURITY VALIDATION, RELIABILITY AND INSTITUTIONAL DEPLOYMENT

## Objective

Validate the complete AssessX Secure Exam Environment under realistic examination conditions and prepare it for institutional production deployment.

## Feature 4.1 — Security Testing

Test the following attack and failure scenarios:

- Attempt to open PowerShell.
- Attempt to open Command Prompt.
- Attempt to open Task Manager.
- Attempt to launch File Explorer.
- Attempt to open Windows Settings.
- Attempt to launch unauthorised executables.
- Attempt to run unauthorised scripts.
- Attempt to switch applications.
- Attempt to close AssessX.
- Attempt to terminate the security agent.
- Attempt to modify security policies.
- Attempt to access administrative functionality.
- Attempt to use unauthorised USB storage.
- Attempt to access remote-control software.
- Attempt to restart or shut down the computer.
- Attempt to bypass restrictions through normal recovery and boot paths.

Document every result, including unsuccessful and partially successful attacks.

## Feature 4.2 — System Reliability Testing

- Long-duration examination tests.
- Multiple consecutive examination sessions.
- Unexpected application crashes.
- Security-service crashes.
- Sudden power failure.
- Unexpected restart.
- Network loss.
- Backend unavailability.
- Camera disconnection.
- Microphone disconnection.
- Storage exhaustion.
- Failed update installation.
- Device reconnection.

## Feature 4.3 — Hardware Compatibility

Validate:
- Different computer manufacturers.
- Intel and AMD processors.
- Supported memory configurations.
- Different SSD configurations.
- Integrated and external cameras.
- Different microphone configurations.
- Keyboard and mouse compatibility.
- Multiple monitor configurations.
- Supported Wi-Fi and Ethernet adapters.
- Secure Boot and TPM configurations.

Maintain a documented compatibility matrix.

## Feature 4.4 — Performance Testing

- Startup time.
- Exam environment launch time.
- Security-agent resource consumption.
- Memory usage.
- CPU utilisation.
- Network utilisation.
- AI proctoring performance.
- Backend response time.
- Answer-saving latency.
- Recovery time.
- Multi-device load testing.

## Feature 4.5 — Security Audit

- Review security architecture.
- Review Windows security policies.
- Review native Rust and service code.
- Review authentication and authorisation.
- Review local data protection.
- Review update mechanisms.
- Review backend APIs.
- Conduct independent penetration testing.
- Address identified vulnerabilities.
- Maintain a security findings register.

## Feature 4.6 — Production Installer and Provisioning

Build an institutional installation package that supports:

- System compatibility checks.
- Secure installation.
- Device enrolment.
- Required Windows configuration.
- Security policy deployment.
- Application signature verification.
- Administrator account setup.
- Examination account provisioning.
- Rollback and recovery.
- Installation diagnostics.
- Uninstallation through authorised administration.

Do not silently alter or destroy an institution's existing Windows installation.

## Feature 4.7 — Institutional Deployment

- Institution onboarding.
- Device onboarding.
- Administrator onboarding.
- Examination centre configuration.
- Security policy templates.
- Bulk device provisioning.
- Central monitoring.
- Software update management.
- IT administrator documentation.
- Technical support procedures.

## Feature 4.8 — Production Monitoring

- Device health reporting.
- Security-service health.
- Backend health.
- Failed examination sessions.
- Recovery events.
- Policy compliance.
- Update compliance.
- Security alerts.
- System performance.
- Audit reporting.

## Feature 4.9 — Pilot Testing

Conduct a controlled institutional pilot.

Measure:
- Successful device enrolment.
- Successful examination activation.
- Successful examination completion.
- Failed activation rate.
- Unexpected application crashes.
- Recovery success rate.
- Answer persistence.
- Security-policy compliance.
- Administrator usability.
- Candidate usability.

### Phase 4 Acceptance Criteria

Phase 4 is complete when:

1. Documented security tests have passed their defined acceptance criteria.
2. Critical and high-severity vulnerabilities are resolved or formally mitigated.
3. Recovery scenarios have been successfully tested.
4. Supported hardware configurations are documented.
5. Performance is acceptable under realistic examination loads.
6. Independent security assessment has been completed.
7. Installation and provisioning are repeatable.
8. Institutional pilot testing is successful.
9. Monitoring and technical support procedures are operational.
10. Production release has been approved.

---

# 6. CROSS-PHASE TECHNICAL ARCHITECTURE

The following components must remain logically separated.

## 6.1 AssessX Core Platform

Responsibilities:
- Candidate management.
- Examination delivery.
- Question rendering.
- Answer management.
- Exam session management.
- AI proctoring.
- Security event processing.
- Results and reporting.

## 6.2 Windows Security Layer

Responsibilities:
- Windows kiosk configuration.
- Application allowlisting.
- System restrictions.
- Device controls.
- Security-agent operations.
- Policy verification.
- Security monitoring.
- Controlled recovery.

## 6.3 AssessX Session Controller

Responsibilities:
- Activation authorisation.
- Exit authorisation.
- Session validation.
- Device-session binding.
- Session state management.
- Recovery coordination.

## 6.4 AssessX Admin Platform

Responsibilities:
- Institution management.
- Administrator accounts.
- Device enrolment.
- Examination management.
- Security policies.
- Remote device monitoring.
- Audit logs.
- Licensing.

## 6.5 AssessX Backend

Retain the existing FastAPI and PostgreSQL foundation where appropriate.

Responsibilities:
- Authentication.
- Authorisation.
- Examination APIs.
- Device APIs.
- Session APIs.
- Policy distribution.
- Security event processing.
- Audit storage.
- Licence management.
- Update metadata.

Do not introduce additional infrastructure such as Redis or message brokers without a demonstrated architectural requirement.

---

# 7. SECURITY AND ENGINEERING REQUIREMENTS

## 7.1 Windows Security Requirements

- Use supported Windows lockdown and kiosk technologies.
- Use application control rather than process-killing as the primary execution restriction.
- Use standard-user candidate accounts.
- Protect privileged administrative operations.
- Maintain essential Windows security and recovery services.
- Validate all security policies before deployment.
- Test policies on every supported Windows edition.
- Use Secure Boot and firmware restrictions where supported.
- Maintain controlled recovery procedures.

## 7.2 Authentication Requirements

- Secure administrator authentication.
- Multi-factor authentication for privileged roles.
- Short-lived activation and exit authorisations.
- Device-bound session validation.
- Replay protection.
- Rate limiting.
- Server-side authorisation.
- Secure credential storage.

## 7.3 Data Protection Requirements

- Encrypt sensitive local examination data.
- Protect credentials and tokens.
- Use TLS for network communication.
- Apply least-privilege database access.
- Protect audit records.
- Establish retention and deletion policies.
- Do not collect unnecessary personal data.

## 7.4 Reliability Requirements

- No silent loss of confirmed answers.
- No unauthorised examination release after application failure.
- No permanent device lockout after recoverable errors.
- No automatic destructive recovery.
- No unverified software updates.
- No assumption that network connectivity will always be available.

---

# 8. FEATURES OUTSIDE THE INITIAL SCOPE

The following must not be represented as completed capabilities without separate implementation and validation:

- A completely new Windows operating system.
- A custom Windows kernel.
- Absolute protection against every possible attack.
- Guaranteed prevention of firmware-level attacks.
- Guaranteed prevention of external camera recording.
- Guaranteed blocking of every Windows shortcut.
- Guaranteed prevention of physical hardware tampering.
- Fully autonomous offline examination delivery.
- Production-grade remote recovery without validation.
- Universal support for every Windows edition and device.
- Complete protection against vulnerabilities in Windows itself.

These limitations must be documented honestly.

---

# 9. FINAL PRODUCT DEFINITION

AssessX Secure Exam Environment is a managed Windows examination solution that transforms supported computers into restricted examination terminals.

It combines:

1. Windows-managed kiosk and lockdown configuration.
2. Application allowlisting and system restrictions.
3. Native security monitoring.
4. Administrator-controlled activation and exit.
5. Centralised device management.
6. Secure examination execution.
7. Crash recovery and answer persistence.
8. Signed updates.
9. Security auditing.
10. Institutional deployment and monitoring.

The system is considered production-ready only after its security, compatibility, reliability and recovery requirements have been demonstrated through documented testing.

**Final product objective:**

A candidate should be able to use only the authorised AssessX examination interface during an active examination, while the institution retains secure, auditable administrative control over the device and examination lifecycle.

