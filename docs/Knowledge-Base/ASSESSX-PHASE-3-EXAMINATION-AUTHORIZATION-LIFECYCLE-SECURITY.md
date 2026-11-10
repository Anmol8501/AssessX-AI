# ASSESSX
# PHASE 3 — EXAMINATION AUTHORIZATION & LIFECYCLE SECURITY
## Complete Knowledge Base & Technical Specification

**Project:** AssessX  
**Phase:** 3 of 4  
**Phase Name:** Examination Authorization & Lifecycle Security  
**Subphases:** Phase 3A, Phase 3B, Phase 3C  
**Platform:** Windows 10 / Windows 11  
**Desktop Stack:** Tauri + React + TypeScript + Rust  
**Native Security:** AssessX Security Agent  
**Backend:** FastAPI + Python  
**Database:** PostgreSQL (Supabase)  
**Architecture:** Existing Phase 1 and Phase 2 architecture must be extended, not replaced.

---

# 1. PHASE 3 OVERVIEW

## 1.1 Purpose

Phase 3 introduces the examination authorization and lifecycle management layer of AssessX.

Phase 1 established the Windows provisioning, secure shell, and native Security Agent foundation.

Phase 2 introduced advanced Windows security enforcement, including application control, system utility restrictions, navigation restrictions, USB storage control, display monitoring, peripheral policies, and remote-access detection.

Phase 3 connects these capabilities to a complete examination lifecycle.

The primary objective is to ensure that:

1. Only authorized candidates can start an examination.
2. Only approved and registered devices can enter an examination.
3. An examination cannot begin without successful readiness and authorization checks.
4. An active examination remains recoverable after crashes, network interruptions, or application restarts.
5. Candidate answers are saved reliably and cannot silently disappear.
6. Examination sessions cannot be terminated or exited without valid authorization.
7. Institutional administrators can manage examinations, devices, sessions, and security policies centrally.
8. Every critical authorization, policy change, recovery, and exit action is recorded in an auditable manner.

## 1.2 Three Subphases

### Phase 3A — Examination Activation & Start Authorization

Responsible for:
- Institution and administrator authorization.
- Candidate identity and eligibility verification.
- Device registration and authorization.
- Examination schedule validation.
- Secure examination activation.
- Pre-examination readiness validation.
- Cryptographically protected examination session creation.
- Prevention of unauthorized examination starts.

### Phase 3B — Session Continuity, Answer Persistence & Recovery

Responsible for:
- Continuous answer persistence.
- Autosave and synchronization.
- Crash and application restart recovery.
- Network interruption recovery.
- Session state preservation.
- Integrity verification.
- Duplicate-session prevention.
- Recovery authorization and audit logging.

### Phase 3C — Secure Exit, Completion & Institutional Administration

Responsible for:
- Authorized examination submission.
- Examination completion verification.
- Administrator-authorized exit.
- Secure shell restoration coordination.
- Institutional administrator dashboard.
- Remote policy management.
- Device and session administration.
- Centralized audit logs and security reporting.

---

# 2. ARCHITECTURAL PRINCIPLES

All Phase 3 implementation must follow these principles.

## 2.1 Extend Existing Architecture

The following existing components must be inspected and reused:

- Tauri desktop application.
- React and TypeScript frontend.
- Rust native modules.
- AssessX Security Agent.
- Named Pipe IPC: `\\.\pipe\AssessXSecurityAgent`.
- FastAPI backend.
- Supabase PostgreSQL database.
- Existing authentication and authorization mechanisms.
- Phase 1 secure shell and provisioning.
- Phase 2 application, utility, navigation, and peripheral control modules.

Do not create a second Security Agent, a duplicate policy engine, or another independent examination session framework.

## 2.2 Backend Authority

The backend is the authoritative source for:
- Examination authorization.
- Candidate eligibility.
- Examination schedule.
- Session issuance.
- Session status.
- Submission status.
- Administrative approval.
- Remote policy authorization.

The desktop application must not independently invent or approve an examination authorization.

Local cryptographically verifiable authorization artifacts may be used for offline resilience, but must follow server-issued expiry and policy rules.

## 2.3 Security by Design

- Use least privilege.
- Enforce authorization on the backend.
- Validate every critical state transition.
- Use short-lived credentials.
- Protect against replay attacks.
- Use idempotent operations.
- Keep administrative credentials separate from candidate credentials.
- Do not expose API secrets in the frontend.
- Do not trust frontend-only validation.
- Maintain an auditable event history.
- Preserve a tested administrator recovery route.

## 2.4 Reliability

The system must handle:
- Unexpected application termination.
- Windows restart.
- Backend downtime.
- Internet disconnection.
- Delayed synchronization.
- Duplicate requests.
- Power interruption.
- Security Agent disconnection.
- Device readiness failures.

A temporary failure must not automatically result in candidate answer loss or an unauthorized examination termination.

---

# 3. PHASE 3A — EXAMINATION ACTIVATION & START AUTHORIZATION

## 3.1 Objective

Phase 3A creates the secure examination start and activation mechanism.

A candidate must not be allowed to start an examination simply because they can open the AssessX desktop application or access an examination screen.

The system must verify the candidate, examination, institution, device, schedule, and security readiness before issuing a valid examination session.

## 3.2 Institutional Authorization

The system must support institution-controlled examination authorization.

An authorized institutional administrator should be able to:
- Create or configure an examination.
- Assign candidates.
- Assign examination dates and times.
- Assign permitted devices or device groups.
- Define examination duration.
- Configure examination policies.
- Activate or deactivate an examination.
- View the authorization status.
- Review failed activation attempts.

Administrative privileges must be checked by the backend.

The desktop application must never be allowed to grant itself institutional administrative privileges.

## 3.3 Candidate Verification

Before examination activation, verify:

1. Candidate account authentication.
2. Candidate identity and institutional association.
3. Candidate examination assignment.
4. Examination availability.
5. Examination start and end schedule.
6. Attempt eligibility.
7. Whether another active session already exists.
8. Whether the candidate account is suspended or blocked.

If the existing project includes identity verification or an approved institutional SSO mechanism, reuse it.

Do not introduce unnecessary biometric identity verification or collect additional personal information without a defined institutional requirement.

## 3.4 Device Authorization

Every examination device must pass device authorization.

Required checks:

- Device registration.
- Device identifier validation.
- Institution-device association.
- Device approval status.
- Device compatibility.
- Security Agent availability.
- Security Agent version and health.
- Phase 1 provisioning readiness.
- Phase 2 policy readiness.
- Existing active session detection.
- Device revocation status.

A device identifier must not be treated as a secret or as sufficient proof of device identity.

Use authenticated device registration and appropriate cryptographic device credentials.

## 3.5 Examination Readiness Validation

Before activation, the desktop application must run a readiness check.

Readiness categories:

| Category | Validation |
|---|---|
| Candidate | Authenticated and eligible |
| Examination | Assigned and within allowed schedule |
| Device | Registered and approved |
| Secure shell | Operational |
| Security Agent | Connected and healthy |
| Application control | Required policy active |
| System restrictions | Required restrictions verified |
| Navigation control | Required policies verified |
| Peripheral control | Required policies verified |
| Camera/microphone | Ready if required by exam |
| Network | Meets configured requirements |
| Backend | Authorization service available |

Each check should return a structured result:

- READY
- NOT_READY
- WARNING
- UNSUPPORTED
- VERIFICATION_FAILED

Do not report a security policy as active merely because its configuration exists. Require actual verification through the relevant native enforcement mechanism.

## 3.6 Examination Activation Workflow

Recommended workflow:

1. Candidate opens AssessX.
2. Candidate authenticates.
3. Candidate selects an assigned examination.
4. Backend validates candidate eligibility.
5. Backend validates examination schedule.
6. Backend validates device registration.
7. Desktop performs device and security readiness checks.
8. Security Agent confirms its health and required policy state.
9. Desktop submits the readiness report.
10. Backend evaluates the complete authorization request.
11. Backend issues a short-lived examination activation authorization.
12. Desktop verifies the authorization.
13. Secure examination session is created.
14. Examination policies are bound to the session.
15. Candidate enters the examination environment.

Any failed mandatory validation must prevent examination activation.

Warnings may be permitted only where the institution's configured policy explicitly allows them.

## 3.7 Secure Session Creation

Every examination attempt must receive a unique session identifier.

The session should include:

- Session ID.
- Candidate ID.
- Examination ID.
- Institution ID.
- Device ID.
- Authorization ID.
- Session creation time.
- Examination start time.
- Authorized expiry time.
- Attempt number.
- Session status.
- Applied policy version.
- Security Agent version.
- Authorization metadata.

Suggested session states:

- PENDING_AUTHORIZATION
- AUTHORIZED
- STARTING
- ACTIVE
- INTERRUPTED
- RECOVERY_PENDING
- SUBMISSION_PENDING
- SUBMITTED
- COMPLETED
- EXIT_PENDING
- CLOSED
- REVOKED
- EXPIRED
- TERMINATED

All state transitions must be validated by the backend.

The client must not be able to directly change its session status to ACTIVE, COMPLETED, or CLOSED.

## 3.8 Session Authorization Security

Use:
- Short-lived access tokens.
- Server-side authorization.
- Session-bound credentials.
- Secure refresh mechanisms.
- TLS communication.
- Replay protection.
- Nonce or request identifier validation where appropriate.
- Token revocation.
- Device-session binding.

Do not store long-lived administrator credentials in the desktop client.

Do not embed signing keys or backend secrets in the React frontend or distributed desktop binary.

## 3.9 Phase 3A UI

Required candidate screens:

**A. Examination Selection**
- Assigned examinations.
- Examination date and time.
- Duration.
- Examination status.
- Start eligibility.

**B. Readiness Verification**
- Candidate verification.
- Device verification.
- Security Agent status.
- Security policy status.
- Camera and microphone status where required.
- Backend connectivity.
- Clear failure explanations.

**C. Authorization Screen**
- Examination name.
- Candidate details.
- Institution.
- Authorized device.
- Examination instructions.
- Start examination action.

**D. Examination Activation**
- Secure session creation status.
- Policy activation status.
- Examination startup progress.

Required admin capabilities:
- Examination activation.
- Candidate assignment.
- Device assignment.
- Session authorization overview.
- Failed activation reports.

## 3.10 Phase 3A Backend/API

Inspect existing APIs before introducing new routes.

Potential API capabilities:

- Retrieve assigned examinations.
- Validate candidate eligibility.
- Validate device registration.
- Submit readiness results.
- Request examination authorization.
- Issue examination session.
- Retrieve session status.
- Revoke authorization.
- Retrieve activation audit history.

Possible route structure:

- `GET /api/v1/examinations/assigned`
- `POST /api/v1/examinations/{exam_id}/eligibility`
- `POST /api/v1/devices/{device_identifier}/readiness`
- `POST /api/v1/examinations/{exam_id}/authorize`
- `POST /api/v1/sessions`
- `GET /api/v1/sessions/{session_id}`
- `POST /api/v1/sessions/{session_id}/revoke`

These are proposed capabilities, not instructions to duplicate existing endpoints.

## 3.11 Phase 3A Database

Inspect existing database models and migrations.

Potential entities:

- ExaminationAuthorization
- ExaminationSession
- DeviceAuthorization
- CandidateExamAssignment
- ReadinessReport
- AuthorizationAuditEvent

Use foreign keys, appropriate uniqueness constraints, indexes, and transactional state changes.

Do not create duplicate candidate, examination, or device tables if equivalent models already exist.

## 3.12 Phase 3A Acceptance Criteria

- Only eligible candidates can request examination authorization.
- Only approved devices can be authorized.
- Examination schedule is validated server-side.
- Mandatory readiness checks cannot be bypassed through frontend manipulation.
- Security Agent health is verified.
- A unique examination session is created.
- Duplicate active sessions are prevented unless explicitly allowed.
- Authorization expires and can be revoked.
- All important authorization actions are audited.
- Existing authentication and examination workflows continue working.

---

# 4. PHASE 3B — SESSION CONTINUITY, ANSWER PERSISTENCE & RECOVERY

## 4.1 Objective

Phase 3B ensures that an authorized examination remains reliable and recoverable throughout its entire duration.

A candidate should not lose answers because of:
- Desktop application crashes.
- Temporary internet disconnection.
- Backend interruption.
- Unexpected Windows restart.
- Power failure.
- Temporary Security Agent disconnection.
- Browser or rendering failure.

The system must preserve examination progress while preventing unauthorized restoration or session duplication.

## 4.2 Answer Persistence Architecture

The answer persistence system must support:

- Automatic answer saving.
- Periodic synchronization.
- Save-on-question-navigation.
- Save-on-answer-change with controlled debounce.
- Save-on-section-change.
- Explicit submission.
- Local temporary persistence where permitted.
- Backend acknowledgment.
- Retry after network restoration.

The system must never rely only on React component state or browser memory for answer storage.

## 4.3 Autosave Mechanism

Every answer update should generate a controlled save operation.

Recommended answer metadata:

- Answer ID.
- Session ID.
- Question ID.
- Candidate ID.
- Answer payload.
- Client revision number.
- Server revision number.
- Client update timestamp.
- Server acknowledgment timestamp.
- Synchronization status.
- Integrity metadata.

Possible synchronization states:

- LOCAL_PENDING
- SYNCING
- SYNCED
- RETRY_PENDING
- CONFLICT
- FAILED

The UI should clearly communicate whether answers have been saved.

Example:

- All answers saved.
- Saving answer...
- Internet connection interrupted.
- Answers saved locally; awaiting synchronization.
- Synchronization failed; retrying.

Do not display "Saved successfully" before the server acknowledges the save, unless the interface explicitly says the answer is saved locally and not yet synchronized.

## 4.4 Reliable Synchronization

The synchronization mechanism should support:

1. Unique answer update identifiers.
2. Idempotent requests.
3. Revision tracking.
4. Duplicate request handling.
5. Retry with exponential backoff and jitter.
6. Conflict detection.
7. Server-side validation.
8. Acknowledgment tracking.
9. Synchronization after network recovery.

The backend should reject:
- Answers belonging to another session.
- Answers belonging to another candidate.
- Updates after authorized submission or expiry.
- Invalid question identifiers.
- Unauthorized revision changes.

Do not silently overwrite newer server data with an older local revision.

## 4.5 Local Answer Persistence

Local persistence is required for temporary network failures, subject to the examination's security and privacy policies.

Recommended architecture:

- Encrypted local database or secure storage.
- Session-scoped answer records.
- Protected local synchronization queue.
- Integrity metadata.
- Expiry and cleanup rules.
- Secure deletion after the applicable retention period.

Do not store answers in plaintext files.

Do not store encryption keys alongside encrypted answer files.

Where practical, protect device-side encryption keys using Windows-supported credential protection mechanisms.

The local cache must be accessible only to the authorized AssessX application and operating-system security context.

Local persistence must not become a way to bypass exam expiry or submission rules.

## 4.6 Crash Detection and Recovery

The application must detect unexpected termination and support controlled recovery.

Recovery workflow:

1. Application restarts.
2. Desktop checks for an existing local examination session.
3. Desktop verifies the session identifier.
4. Desktop retrieves the backend session status.
5. Backend validates candidate, device, and authorization.
6. Security Agent health is checked.
7. Current examination policy state is verified.
8. Pending local answers are inspected.
9. Local answers are synchronized using revision validation.
10. The backend authorizes recovery.
11. Examination state is restored.
12. Candidate resumes from the last valid saved state.

Recovery must never be approved solely from local storage.

## 4.7 Network Interruption Handling

The system must distinguish:

- Temporary network interruption.
- Backend service outage.
- Invalid session token.
- Revoked authorization.
- Examination expiry.
- Device disconnection.
- Security Agent failure.

For temporary network interruption:

- Preserve locally permitted answers.
- Display connectivity status.
- Retry synchronization.
- Avoid unnecessary examination termination.
- Enforce the configured offline grace period.
- Require server revalidation before resuming protected operations where necessary.

Offline continuation must be an explicit institution-controlled policy.

The application must not allow unlimited offline examination access.

## 4.8 Session Continuity and Heartbeats

The desktop application and Security Agent should report relevant health and session information.

Possible heartbeat fields:

- Session ID.
- Device ID.
- Agent health.
- Desktop application health.
- Policy verification status.
- Last synchronization time.
- Network status.
- Current session state.
- Timestamp.

Use bounded heartbeat intervals and sensible timeout policies.

Temporary heartbeat delays should not automatically be classified as cheating.

A session can enter INTERRUPTED or RECOVERY_PENDING based on policy.

## 4.9 Session Integrity

The system should protect against:
- Session ID substitution.
- Candidate switching.
- Device switching.
- Replay of old answer requests.
- Duplicate active sessions.
- Unauthorized session restoration.
- Local answer manipulation.
- Unauthorized changes to examination duration.
- Unauthorized examination state transitions.

Use server-side validation, cryptographic integrity mechanisms, authorization checks, and immutable audit events.

Do not treat client-generated timestamps as authoritative.

## 4.10 Recovery Dashboard

Administrators should be able to view:

- Active sessions.
- Interrupted sessions.
- Recovery-pending sessions.
- Last heartbeat.
- Last answer synchronization.
- Device health.
- Security Agent status.
- Recovery attempts.
- Failed recovery reasons.

Where appropriate, administrators may authorize or deny a recovery request.

Every manual recovery decision must include an administrator identity, timestamp, reason, and audit record.

## 4.11 Phase 3B UI

Candidate interface:

- Autosave indicator.
- Synchronization status.
- Connection status.
- Recovery status.
- Last saved time.
- Clear interruption warning.
- Resume examination workflow.

Admin interface:

- Session monitoring.
- Recovery requests.
- Last synchronized answer time.
- Device and agent health.
- Interrupted session classification.
- Recovery authorization.

## 4.12 Phase 3B Backend/API

Potential API capabilities:

- Save answer.
- Retrieve answer state.
- Synchronize pending answers.
- Retrieve session progress.
- Report heartbeat.
- Request session recovery.
- Authorize session recovery.
- Report application interruption.
- Retrieve synchronization status.

Possible route structure:

- `PUT /api/v1/sessions/{session_id}/answers/{question_id}`
- `GET /api/v1/sessions/{session_id}/answers`
- `POST /api/v1/sessions/{session_id}/answers/sync`
- `POST /api/v1/sessions/{session_id}/heartbeat`
- `POST /api/v1/sessions/{session_id}/interrupt`
- `POST /api/v1/sessions/{session_id}/recover`
- `GET /api/v1/sessions/{session_id}/recovery-status`

Inspect the existing exam and answer APIs before creating these routes.

## 4.13 Phase 3B Database

Potential entities:

- SessionAnswer
- AnswerRevision
- AnswerSyncRecord
- SessionHeartbeat
- SessionRecoveryRequest
- SessionInterruptionEvent
- SessionIntegrityEvent

Prefer existing answer and examination models wherever possible.

Maintain a clear separation between:
- Current answer state.
- Answer revision history.
- Synchronization history.
- Security events.

## 4.14 Phase 3B Acceptance Criteria

- Answers are automatically persisted.
- Server acknowledgment is correctly represented in the UI.
- Temporary network interruptions do not silently lose permitted local answers.
- Duplicate synchronization requests are handled safely.
- Stale answer revisions cannot silently overwrite newer versions.
- Crash recovery requires backend authorization.
- Recovery cannot cross candidate, session, or device boundaries.
- Session expiry and revocation are enforced.
- Recovery events are auditable.
- Existing examination functionality remains intact.

---

# 5. PHASE 3C — SECURE EXIT, COMPLETION & INSTITUTIONAL ADMINISTRATION

## 5.1 Objective

Phase 3C completes the examination lifecycle.

It ensures that an examination cannot be considered completed simply because the candidate closes the application, terminates a process, or exits the secure shell.

It also introduces institutional-level administrative capabilities for managing examinations, devices, sessions, and policies.

## 5.2 Examination Submission

The submission process must support:

- Candidate-initiated submission.
- Automatic submission at examination expiry.
- Institution-authorized submission.
- Submission after recovery.
- Submission when network connectivity is temporarily unavailable, where permitted.

Before accepting submission, the backend must validate:

1. Session authenticity.
2. Candidate identity.
3. Examination identity.
4. Session status.
5. Examination expiry rules.
6. Answer synchronization state.
7. Submission eligibility.
8. Existing submission status.

The submission operation must be idempotent.

Repeated submission requests must not create duplicate final submissions.

## 5.3 Submission Workflow

Recommended workflow:

1. Candidate selects Submit Examination.
2. Desktop displays a confirmation screen.
3. Candidate confirms submission.
4. Desktop synchronizes pending answers.
5. Backend validates the session.
6. Backend verifies the final answer state.
7. Backend creates the final submission record.
8. Backend confirms successful submission.
9. Session transitions to SUBMITTED.
10. Completion audit event is recorded.
11. Exit authorization is requested.
12. Authorized restoration begins.

If synchronization fails, the system must follow the institution's configured submission policy.

It must not silently discard pending answers.

## 5.4 Examination Expiry

At examination expiry:

- Desktop receives or calculates the displayed expiry time.
- Backend independently enforces the authoritative expiry.
- Further answer updates are rejected according to the configured deadline policy.
- Pending answers are synchronized where possible.
- Automatic submission is triggered when configured.
- Expiry is recorded in the audit history.

A modified desktop clock must not extend examination duration.

Use server-authoritative timestamps and bounded clock-drift handling.

## 5.5 Exit Authorization

Exiting the examination environment must be treated as a separate authorization process.

Possible exit reasons:

- Normal submission.
- Automatic submission.
- Authorized administrator intervention.
- Institution-authorized cancellation.
- Approved emergency recovery.
- Device failure requiring controlled restoration.

Suggested exit states:

- EXIT_NOT_REQUESTED
- EXIT_REQUESTED
- EXIT_VALIDATION_PENDING
- EXIT_AUTHORIZED
- RESTORATION_IN_PROGRESS
- RESTORATION_VERIFICATION_PENDING
- RESTORED
- EXIT_DENIED
- RESTORATION_FAILED

The candidate must not be able to mark the session as RESTORED through frontend manipulation.

## 5.6 Secure Shell Restoration

After valid exit authorization:

1. Backend confirms the final examination state.
2. Desktop receives an authenticated exit authorization.
3. Security Agent verifies the authorization.
4. Required examination policies are restored using the existing Phase 1 and Phase 2 restoration mechanisms.
5. Restoration is verified.
6. Normal Windows environment availability is confirmed.
7. Device/session state is updated.
8. Final audit event is recorded.

The restoration mechanism must preserve:
- Original administrator accounts.
- Original system configuration.
- Original device provisioning.
- Institutional configuration.
- User data.
- Existing Windows recovery routes.

Do not automatically delete candidate accounts or disable security controls without explicit policy and administrator authorization.

If restoration fails, the system must provide a safe, documented administrator recovery path.

## 5.7 Emergency Exit and Recovery

The system must distinguish a legitimate emergency from an ordinary unauthorized exit.

Possible scenarios:

- Hardware failure.
- Power failure.
- Windows crash.
- Security Agent failure.
- Medical or safety emergency.
- Institution-authorized cancellation.

Emergency exit must use a controlled, auditable process.

Where server connectivity is unavailable, only explicitly preauthorized emergency recovery rules may apply.

Do not make the examination application impossible to recover from a critical system failure.

## 5.8 Institutional Admin Dashboard

Phase 3C introduces or extends the centralized institutional administration interface.

The dashboard should provide the following modules.

### A. Institution Overview

- Total registered candidates.
- Total registered devices.
- Scheduled examinations.
- Active examinations.
- Active sessions.
- Interrupted sessions.
- Completed examinations.
- Pending recovery requests.
- Security alerts.

### B. Examination Management

- Create and configure examinations.
- Assign candidates.
- Schedule examinations.
- Activate or deactivate examinations.
- Configure examination duration.
- Configure permitted devices.
- Configure examination policies.
- Review submission status.

### C. Candidate Management

- Candidate registration and status.
- Examination assignment.
- Eligibility status.
- Session history.
- Authorized device associations.
- Examination completion history.

### D. Device Management

- Registered devices.
- Device approval and revocation.
- Security Agent health.
- Windows compatibility.
- Phase 2 policy status.
- Active session association.
- Last heartbeat.
- Device audit history.

### E. Live Session Monitoring

- Active examination sessions.
- Candidate and device information.
- Examination progress.
- Last heartbeat.
- Answer synchronization status.
- Security Agent health.
- Interruption state.
- Recovery status.

Monitoring must follow institutional authorization and privacy requirements.

### F. Recovery Management

- Pending recovery requests.
- Interrupted sessions.
- Recovery reasons.
- Last synchronized answer.
- Device status.
- Administrator authorization.
- Recovery history.

### G. Security Audit Logs

- Examination authorization.
- Device authorization.
- Session creation.
- Policy changes.
- Session interruption.
- Recovery decisions.
- Examination submission.
- Exit authorization.
- Restoration completion.
- Failed authorization attempts.

## 5.9 Remote Policy Management

Institutional administrators should be able to manage approved examination security policies remotely.

The system should support:

- Policy creation.
- Policy versioning.
- Policy assignment.
- Policy approval.
- Policy distribution.
- Policy verification.
- Policy rollback.
- Policy revocation.
- Policy audit history.

Remote policy changes must never bypass local native security enforcement.

### Policy Distribution Workflow

1. Administrator creates or selects a policy.
2. Backend validates administrator permission.
3. Backend validates policy schema.
4. Policy receives a unique version.
5. Administrator approves the policy.
6. Backend publishes the approved policy.
7. Registered device retrieves the policy.
8. Device verifies policy authenticity and scope.
9. Security Agent evaluates policy compatibility.
10. Policy is applied using the existing Phase 1 and Phase 2 mechanisms.
11. Device verifies actual enforcement.
12. Device reports policy status.
13. Backend records the result.

### Policy Security Requirements

- Digitally authenticated policy packages.
- Version control.
- Device and institution binding.
- Policy expiry where appropriate.
- Replay protection.
- Rollback support.
- Administrator approval.
- Compatibility validation.
- Complete audit trail.

Never distribute executable code or unrestricted commands as ordinary policy payloads.

Do not allow a remote administrator to silently disable essential Windows security features.

A policy update that could interrupt an active examination must follow an explicit institution-controlled policy. Prefer deferring disruptive updates until the session ends.

## 5.10 Remote Device Administration

Authorized administrators should be able to:

- View registered device status.
- View Security Agent health.
- View policy compliance.
- Revoke device authorization.
- Assign examination policies.
- Review device events.
- Request controlled diagnostics.
- Review device recovery status.

Remote administration must not mean unrestricted remote desktop access or hidden control of a candidate's device.

No secret camera activation, arbitrary file access, or unrestricted command execution.

## 5.11 Phase 3C Backend/API

Inspect and reuse existing backend routes.

Potential capabilities:

- Submit examination.
- Validate final submission.
- Request exit authorization.
- Authorize exit.
- Report restoration status.
- Retrieve institutional dashboard data.
- Manage device authorization.
- Publish policy versions.
- Retrieve policy assignments.
- Report policy compliance.
- Retrieve audit history.

Possible route structure:

- `POST /api/v1/sessions/{session_id}/submit`
- `POST /api/v1/sessions/{session_id}/exit-request`
- `POST /api/v1/sessions/{session_id}/exit-authorize`
- `POST /api/v1/sessions/{session_id}/restoration-status`
- `GET /api/v1/institutions/{institution_id}/dashboard`
- `GET /api/v1/institutions/{institution_id}/sessions`
- `GET /api/v1/institutions/{institution_id}/devices`
- `POST /api/v1/devices/{device_identifier}/revoke`
- `POST /api/v1/policies`
- `POST /api/v1/policies/{policy_id}/approve`
- `GET /api/v1/devices/{device_identifier}/policies`
- `POST /api/v1/devices/{device_identifier}/policy-status`

These are proposed route capabilities, not mandatory new endpoints.

## 5.12 Phase 3C Database

Potential entities:

- ExaminationSubmission
- ExitAuthorization
- RestorationRecord
- InstitutionPolicy
- InstitutionPolicyVersion
- DevicePolicyAssignment
- PolicyVerificationRecord
- AdministrativeAuditEvent

Reuse existing institutional, examination, candidate, device, and audit models wherever possible.

## 5.13 Phase 3C Acceptance Criteria

- Examination submission is backend-authoritative.
- Duplicate submissions are handled safely.
- Examination expiry cannot be extended by modifying the local clock.
- Exit requires valid authorization.
- Restoration uses existing Phase 1 and Phase 2 mechanisms.
- Restoration completion is verified.
- Emergency recovery is documented and auditable.
- Institutional administrators can view authorized examination and device information.
- Remote policies require authorization and version verification.
- Active examination sessions are protected from disruptive policy changes.
- Administrative actions are recorded.
- Existing functionality remains intact.

---

# 6. COMPLETE PHASE 3 LIFECYCLE

The combined workflow should be:

1. Institution configures examination.
2. Administrator assigns candidates and permitted devices.
3. Examination is activated.
4. Candidate authenticates.
5. Candidate selects assigned examination.
6. Device authorization is validated.
7. Phase 1 readiness is verified.
8. Phase 2 security policies are verified.
9. Backend authorizes examination activation.
10. Secure session is created.
11. Candidate starts examination.
12. Answers are continuously persisted.
13. Desktop and Security Agent report session health.
14. Interruptions are detected and classified.
15. Authorized recovery restores the examination where necessary.
16. Candidate submits the examination or expiry triggers configured submission.
17. Backend validates and stores the final submission.
18. Exit authorization is issued.
19. Security Agent coordinates controlled restoration.
20. Restoration is verified.
21. Session is closed.
22. Institutional audit history is finalized.

---

# 7. PHASE 3 SECURITY ARCHITECTURE

## 7.1 Component Responsibilities

| Component | Responsibility |
|---|---|
| React frontend | Candidate and administrator interfaces |
| Tauri application | Desktop lifecycle and secure application integration |
| Rust modules | Native session, storage, and system operations |
| Security Agent | Health, policy verification, IPC, and authorized native operations |
| Named Pipe IPC | Authenticated local communication |
| FastAPI backend | Authorization and session authority |
| Supabase PostgreSQL | Persistent examination, device, session, and audit records |
| Institutional dashboard | Centralized administrative control |

## 7.2 Trust Boundaries

The following components must not be trusted equally:

- Frontend input is untrusted.
- Local session data is untrusted until verified.
- Device identity requires cryptographic authentication.
- Backend authorization is authoritative.
- Security Agent reports require authenticated IPC and appropriate validation.
- Policy packages require cryptographic verification.
- Administrative actions require server-side permission checks.

## 7.3 Audit Logging

Every important operation must create an audit event.

Recommended fields:

- Event ID.
- Institution ID.
- Candidate ID where applicable.
- Device ID.
- Session ID.
- Actor type.
- Actor ID.
- Event type.
- Event timestamp.
- Result.
- Failure reason.
- Policy version.
- Correlation ID.
- Relevant non-sensitive metadata.

Audit records must be protected against unauthorized modification.

Do not log passwords, access tokens, signing secrets, or complete sensitive answer payloads unnecessarily.

---

# 8. PHASE 3 TESTING STRATEGY

## 8.1 Phase 3A Tests

- Eligible candidate authorization.
- Ineligible candidate rejection.
- Unauthorized device rejection.
- Device revocation.
- Invalid examination schedule.
- Duplicate session prevention.
- Expired authorization.
- Invalid token.
- Security Agent unavailable.
- Phase 2 policy verification failure.
- Backend authorization failure.
- Concurrent authorization attempts.

## 8.2 Phase 3B Tests

- Autosave.
- Server acknowledgment.
- Duplicate answer updates.
- Out-of-order answer revisions.
- Network interruption.
- Backend downtime.
- Desktop crash.
- Windows restart.
- Power interruption simulation.
- Security Agent interruption.
- Session recovery.
- Unauthorized session recovery.
- Local answer corruption.
- Duplicate recovery requests.
- Examination expiry during recovery.

## 8.3 Phase 3C Tests

- Candidate submission.
- Automatic expiry submission.
- Duplicate submission.
- Submission with pending answers.
- Unauthorized exit request.
- Authorized exit.
- Expired exit authorization.
- Restoration failure.
- Emergency restoration.
- Administrator permission enforcement.
- Policy version verification.
- Policy rollback.
- Device revocation.
- Audit log completeness.
- Concurrent administrative operations.

## 8.4 Regression Testing

After each subphase:

- Run the relevant Rust tests.
- Run the complete Rust workspace test suite.
- Run desktop unit tests.
- Run TypeScript compilation.
- Run desktop linting.
- Run backend tests.
- Run backend linting.
- Verify migrations.
- Test API integration.
- Test existing authentication.
- Test examination creation and management.
- Test Phase 1 secure shell.
- Test Phase 2A–2D security integrations.

Do not dismiss a failing pre-existing test without identifying it, documenting its cause, and determining whether it is affected by the new changes.

## 8.5 Windows Testing

Use a Windows VM or a separate test machine for aggressive examination security testing.

Do not experiment with kiosk, registry, shell restoration, or destructive security policies on the developer's daily Windows machine.

Test supported Windows editions separately.

Record:
- Windows edition.
- Windows build.
- Administrative permissions.
- Policy support.
- Actual enforcement result.
- Restoration result.

---

# 9. IMPLEMENTATION ORDER

Phase 3 must be developed in this order.

## Phase 3A
1. Repository and architecture audit.
2. Existing authentication audit.
3. Existing examination and candidate model audit.
4. Device authorization.
5. Examination eligibility.
6. Readiness verification.
7. Activation authorization.
8. Secure session creation.
9. Admin and candidate UI.
10. Integration and regression testing.

## Phase 3B
1. Existing answer storage audit.
2. Answer revision model.
3. Autosave implementation.
4. Synchronization engine.
5. Local persistence.
6. Heartbeat integration.
7. Interruption detection.
8. Recovery authorization.
9. Recovery UI.
10. Integration and regression testing.

## Phase 3C
1. Existing submission workflow audit.
2. Submission validation.
3. Exit authorization.
4. Secure restoration integration.
5. Emergency recovery.
6. Institutional dashboard.
7. Remote policy management.
8. Audit reporting.
9. End-to-end examination testing.
10. Full regression and final verification.

---

# 10. SCOPE BOUNDARIES

Phase 3 is focused on examination authorization, lifecycle continuity, submission, exit, and institutional administration.

It must not become an unrelated redesign of the AssessX platform.

The following must be preserved:
- Existing project architecture.
- Existing authentication.
- Existing examination creation.
- Existing candidate management.
- Existing desktop security features.
- Existing Security Agent.
- Existing backend APIs.
- Existing database relationships.
- Existing Phase 1 and Phase 2 implementation.
- Existing working-tree changes and unstaged files.

Do not:
- Replace the Security Agent.
- Create a duplicate session manager.
- Replace the existing backend framework.
- Rewrite existing UI unnecessarily.
- Delete working modules.
- Reset the database.
- Remove existing migrations.
- Force-push Git history.
- Disable Windows Defender, UAC, or Firewall.
- Introduce hidden remote access.
- Claim implementation without evidence.

---

# 11. PHASE 3 DELIVERABLES

Expected documentation:

- `PHASE-3-KNOWLEDGE-BASE.md`
- `PHASE-3A-IMPLEMENTATION-REPORT.md`
- `PHASE-3B-IMPLEMENTATION-REPORT.md`
- `PHASE-3C-IMPLEMENTATION-REPORT.md`
- `PHASE-3-COMPLETE-AUDIT-AND-VERIFICATION-REPORT.md`

Expected architecture documentation:

- Examination Authorization Architecture.
- Session Lifecycle State Machine.
- Answer Persistence and Recovery Architecture.
- Secure Exit and Restoration Workflow.
- Institutional Policy Management Architecture.
- Phase 3 API Documentation.
- Phase 3 Database Schema and Migration Notes.

---

# 12. PHASE 3 DEFINITION OF DONE

Phase 3 is complete only when all three subphases satisfy their acceptance criteria.

The final system must demonstrate:

1. An institution can authorize an examination.
2. An eligible candidate can authenticate and start it on an approved device.
3. The backend controls examination authorization.
4. The desktop and Security Agent verify the required security state.
5. Answers are saved reliably.
6. Interrupted sessions can be recovered through authorized procedures.
7. Duplicate or unauthorized sessions are prevented.
8. Examination submission is validated and persisted.
9. Examination exit requires valid authorization.
10. Secure Windows restoration is verified.
11. Institutional administrators can manage authorized examinations, sessions, devices, and policies.
12. Critical actions have auditable histories.
13. Phase 1 and Phase 2 functionality continues to work.
14. Full regression and Windows environment testing have been completed.
15. All known failures and limitations are documented honestly.

**Important:** A completed implementation report is not proof of production readiness. Phase 3 must distinguish automated test success, integration verification, Windows OS-level verification, and independent security validation.

---

# 13. FUTURE PHASE 4

Phase 4 is reserved for final security assurance and production readiness.

Expected scope:

- Independent security audit.
- Penetration testing.
- Windows policy bypass assessment.
- Authentication and authorization testing.
- Session manipulation testing.
- API security testing.
- Device identity testing.
- Local data protection review.
- Recovery and restoration stress testing.
- Privacy and data-retention review.
- Institutional deployment validation.
- Production rollout and operational monitoring.

Phase 4 must validate the complete system rather than simply add more security restrictions.

---

# FINAL PROJECT DIRECTION

AssessX should become a complete Windows-first examination environment with:

- Phase 1: Device Provisioning, Secure Shell and Security Agent.
- Phase 2: Advanced Windows Security Enforcement.
- Phase 3: Examination Authorization and Lifecycle Security.
- Phase 4: Security Audit, Validation and Production Readiness.

The architecture must remain modular, maintainable, auditable, and recoverable.

The primary objective is not merely to prevent candidates from leaving an examination screen. It is to build a reliable, institution-controlled examination workstation that securely manages the entire examination lifecycle without losing candidate work or compromising legitimate system recovery.

