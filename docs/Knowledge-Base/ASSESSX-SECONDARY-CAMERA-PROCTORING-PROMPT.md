# ANTIGRAVITY IMPLEMENTATION PROMPT — ASSESSX SECONDARY CAMERA PROCTORING

## Feature: QR-Based Mobile Phone Secondary Camera for Home-Based Assessments

You are working on the existing **AssessX** project.

Your task is to introduce a new, optional feature called **Secondary Camera Proctoring**. This feature allows an administrator to enable an additional mobile-phone camera for selected assessments, especially assessments conducted remotely from candidates' homes.

**CRITICAL REQUIREMENT: DO NOT MODIFY, REWRITE, REPLACE, REMOVE, OR BREAK ANY EXISTING CODE OR FUNCTIONALITY.**

This is an additive feature only. Preserve the existing AssessX application, architecture, UI, authentication, examination workflows, proctoring system, APIs, database structure, and security controls.

---

# 1. PRIMARY OBJECTIVE

Add a new proctoring configuration option while creating or editing an assessment.

The administrator should be able to select:

1. Standard Proctoring
   - Uses the existing AssessX proctoring system.
   - Existing camera, microphone, screen monitoring, and other enabled checks continue working exactly as they do currently.

2. Proctoring + Secondary Camera
   - Uses all existing standard proctoring features.
   - Additionally requires the candidate to connect a second camera using their mobile phone.
   - The mobile phone connects to the examination session through a QR code.
   - The mobile camera provides a live secondary view of the candidate and their examination environment.

The secondary camera must be optional and configurable separately for each assessment.

Do not make secondary camera functionality mandatory for every assessment.

# 2. ADMIN DASHBOARD — ASSESSMENT CONFIGURATION

When an administrator creates a new assessment, introduce a new section:

**Proctoring Configuration**

Display two selectable options.

### Option A: Standard Proctoring

Description:
"Use the standard AssessX proctoring system with the candidate's computer camera and existing monitoring features."

### Option B: Standard Proctoring + Secondary Camera

Description:
"Require candidates to connect an additional mobile phone camera to monitor their examination environment from a second angle."

When the administrator selects Option B, reveal additional settings.

### Secondary Camera Settings

- Enable secondary camera: ON/OFF.
- Mandatory mobile camera connection: ON/OFF.
- Connection method: QR Code.
- Required camera orientation: Landscape (preferred).
- Camera quality: Adaptive based on network and device capability.
- Minimum camera readiness: Configurable if supported.
- Connection grace period: Configurable.
- Reconnection allowed: Yes.
- Show secondary camera instructions to candidates: Yes.
- Secondary camera positioning guide: Enabled.
- Secondary camera connection verification: Enabled.

Do not introduce settings that the existing assessment model cannot safely support without first inspecting its schema.

The administrator should be able to save the assessment with these settings.

For existing assessments, preserve their current behavior and default them to Standard Proctoring. Never silently enable secondary camera requirements for previously created assessments.

# 3. MOBILE PHONE CONNECTION THROUGH QR CODE

The mobile phone should act as a secondary camera, not as a separate examination device.

When a candidate starts an assessment requiring secondary camera proctoring:

1. Candidate logs in through the existing AssessX desktop application.
2. Candidate opens the assigned assessment.
3. Existing pre-examination checks run.
4. AssessX detects that the assessment requires a secondary camera.
5. The desktop application displays a QR code.
6. Candidate scans the QR code using their mobile phone.
7. The mobile browser opens a secure AssessX secondary-camera connection page.
8. Candidate grants camera permission.
9. The phone establishes a secure live connection with the desktop examination session.
10. Desktop application verifies that the mobile camera is connected and streaming.
11. Candidate receives a confirmation that both camera views are ready.

The QR code must be:

- Unique to the examination session.
- Short-lived.
- Single-use.
- Securely generated.
- Impossible to reuse for another candidate or assessment.
- Invalidated when the examination session ends.
- Protected against unauthorized session joining.

Never put permanent authentication tokens, passwords, or unrestricted session credentials directly into a QR code.

Use a secure, short-lived pairing mechanism with server-side validation.

# 4. MOBILE CAMERA POSITIONING — MOST IMPORTANT REQUIREMENT

The secondary camera must provide a useful view of the candidate's physical examination environment.

The objective is to capture:

- Candidate's upper body.
- Candidate's face and general posture.
- Computer monitor and desk area, where physically possible.
- Keyboard and mouse area.
- Chair and surrounding examination workspace.
- Nearby accessible surroundings that are relevant to exam integrity.

The camera should be positioned at an angle that provides a broad view of the candidate and their workstation.

### Recommended positioning

The candidate should:

1. Place the mobile phone on a stable stand or holder.
2. Position it diagonally to the side or behind the candidate, based on the room layout.
3. Ensure the camera captures the candidate's seating position and workstation.
4. Ensure the candidate's upper body, chair, desk, and computer area are visible as much as reasonably possible.
5. Avoid placing the phone too close to the candidate.
6. Avoid pointing the camera directly into bright light.
7. Keep the mobile phone stationary throughout the examination.
8. Connect the phone to a charger when possible.

The interface must provide a positioning guide with a sample illustration and a live camera preview.

**Important:** Do not claim that one camera angle can guarantee visibility of the entire room. Actual visibility depends on room layout, camera placement, lens, and field of view.

### Candidate positioning screen

After connecting the mobile camera, show:

- Live secondary-camera preview.
- Camera connection status.
- Camera permission status.
- Video streaming status.
- Positioning instructions.
- Retake/reposition guidance.
- Confirm camera placement button.

The candidate should be able to verify the camera view before starting the assessment.

The administrator should be able to configure whether camera placement approval is required before the exam starts.

# 5. MOBILE CAMERA INTERFACE

Create a lightweight, responsive mobile web interface.

The mobile interface must be designed specifically for a phone screen.

It should include:

- AssessX branding.
- Assessment session status.
- Camera permission request.
- Front/rear camera selection where supported.
- Live camera preview.
- Connection status.
- Network status.
- Battery warning where browser/device capabilities allow it.
- Screen rotation guidance.
- Reconnection status.
- Clear instructions not to close the browser or switch away during the exam.

The mobile page should be simple and focused.

Do not provide examination questions, answers, assessment navigation, or candidate exam controls on the mobile device.

The phone is strictly a secondary camera device.

Do not request unnecessary permissions such as contacts, location, or file access.

# 6. REAL-TIME VIDEO CONNECTION

Implement the secondary camera stream using an architecture appropriate for the existing AssessX technology.

First inspect the current backend and real-time communication infrastructure.

Preferred approach:

- WebRTC for live video transmission.
- Existing backend or a dedicated signaling service for connection negotiation.
- Secure session-specific signaling.
- Authenticated desktop and mobile participants.
- STUN/TURN configuration where required.
- Reconnection handling.
- Connection heartbeat.
- Stream health monitoring.

Do not assume that a direct peer-to-peer connection will work across every network.

If TURN infrastructure is required, identify the deployment and operational requirements before implementation.

Do not transmit video through ordinary REST polling.

Avoid storing continuous video recordings by default. Use the existing recording and evidence policies if available. If a new recording capability is proposed, keep it separately configurable and require explicit administrative policy and appropriate candidate notice.

# 7. DESKTOP EXAMINATION INTERFACE

When secondary camera mode is enabled, the desktop application should display:

**Secondary Camera Status**

- Not connected.
- QR code displayed.
- Pairing in progress.
- Connected.
- Streaming.
- Connection interrupted.
- Reconnecting.
- Disconnected.

Before the assessment starts, the candidate must complete the required camera readiness checks.

During the assessment:

- The desktop application should continue its existing proctoring behavior.
- The secondary camera must remain connected when required.
- The application should detect stream interruptions.
- The application should detect when the mobile device disconnects.
- The application should attempt safe reconnection.
- The candidate should receive clear connection warnings.

Do not let the candidate bypass a mandatory secondary camera requirement.

However, do not automatically terminate an examination merely because of a temporary network interruption. Follow a configurable policy:

- Show warning.
- Attempt reconnection.
- Start a configurable grace period.
- Log the interruption.
- Notify the administrator/proctor where appropriate.
- Apply the assessment's configured policy after the grace period expires.

Never silently discard an exam response or lose the candidate's progress.

# 8. ADMIN LIVE PROCTORING VIEW

Where the existing administrator/proctor interface supports live monitoring, add a secondary camera view for assessments that have this feature enabled.

The proctor should be able to view:

- Primary computer camera.
- Secondary mobile camera.
- Candidate identity.
- Assessment name.
- Session ID.
- Connection status of both cameras.
- Last successful heartbeat.
- Network/stream health.
- Camera interruption events.

The secondary camera should be visually distinguishable from the primary camera.

Do not redesign the entire existing proctoring dashboard.

Add the secondary camera view within the existing layout and design system.

If the current interface does not support live proctor viewing, implement only the necessary additive view after auditing the existing architecture.

# 9. AI PROCTORING INTEGRATION

The secondary camera should provide an additional evidence source for the existing proctoring system.

Do not create an entirely separate AI proctoring engine.

First inspect how AssessX currently processes camera frames, events, and proctoring evidence.

If the existing architecture supports additional camera sources, integrate the secondary camera into that pipeline.

Potential observations may include:

- Another person visibly entering the examination area.
- Repeated suspicious interactions with objects.
- Candidate repeatedly looking away from the examination workspace.
- Mobile camera being covered or deliberately repositioned.
- Camera stream being interrupted.
- Candidate leaving the visible examination area.

Important AI safeguards:

- Never automatically label a candidate as cheating based on one visual event.
- Do not treat ordinary posture, disability-related movement, lighting, or camera limitations as proof of misconduct.
- Use confidence thresholds and event evidence.
- Log observations with timestamps.
- Allow a human proctor to review flagged events.
- Distinguish technical camera failures from suspected misconduct.
- Avoid unsupported claims about what the camera can see.

The AI should produce reviewable observations, not final disciplinary decisions.

# 10. BACKEND AND DATABASE INTEGRATION

Before implementing anything, inspect the current database models, migrations, API routes, authentication, examination session model, and proctoring event model.

Add only the minimum necessary fields and tables.

Possible data concepts:

- Secondary camera enabled.
- Secondary camera mandatory.
- Camera pairing session.
- Pairing token hash.
- Pairing expiration.
- Camera device/session identifier.
- Connection status.
- Stream status.
- Connection timestamps.
- Disconnection events.
- Reconnection events.
- Camera readiness status.

These are conceptual requirements, not mandatory table or column names.

Follow the existing project naming conventions.

Do not duplicate existing assessment, candidate, or examination session records.

Use backward-compatible database migrations.

Do not delete or rename existing columns, tables, endpoints, or models.

Do not modify existing assessment behavior for records that do not have secondary camera enabled.

# 11. SECURITY REQUIREMENTS

Treat the mobile camera connection as a sensitive examination resource.

Implement:

- Secure pairing.
- Short-lived pairing tokens.
- Server-side authorization.
- Candidate and assessment ownership verification.
- Session isolation.
- Token expiration.
- Token invalidation after pairing.
- Protection against QR replay.
- Rate limiting for pairing attempts.
- Secure signaling.
- HTTPS/WSS in production.
- Input validation.
- Audit logging.
- Protection against unauthorized camera viewing.
- Protection against one mobile device joining multiple unrelated sessions.

Never expose API keys, backend secrets, TURN credentials, or permanent access tokens in frontend code.

Do not allow a mobile device to connect merely because it knows an assessment ID.

# 12. PRIVACY AND CANDIDATE CONSENT

Before camera activation, clearly explain:

- Why the secondary camera is required.
- What the camera is expected to capture.
- When video streaming begins.
- Whether video is recorded or only streamed.
- Who may access the live feed or recordings.
- Applicable retention policy.
- How to get help if the connection fails.

Show a clear camera permission and readiness flow.

Do not secretly activate the mobile camera.

Do not record or stream before the candidate has been informed and the relevant permission has been granted.

Follow the existing AssessX privacy and retention policies. Do not invent a retention period.

# 13. NETWORK AND DEVICE RELIABILITY

The mobile camera must be usable on ordinary home Wi-Fi and supported mobile networks.

Handle:

- Weak Wi-Fi.
- Network switching.
- Mobile browser refresh.
- Temporary phone disconnection.
- Battery-saving restrictions.
- Phone overheating warnings where detectable.
- Camera permission denial.
- Camera already in use by another application.
- Browser incompatibility.
- Low bandwidth.
- Poor video quality.
- Desktop application restart.
- Mobile page accidentally closed.

Use adaptive video quality and avoid unnecessarily high resolution or frame rates.

Do not let the secondary camera consume so much bandwidth that the primary examination session becomes unstable.

Display useful troubleshooting instructions instead of generic error messages.

# 14. ASSESSMENT RESULT AND PROCTORING REPORT

For assessments using secondary camera mode, include relevant information in the existing proctoring report:

- Whether the secondary camera was required.
- Whether pairing succeeded.
- Connection start and end times.
- Total disconnection duration.
- Number of interruptions.
- Reconnection attempts.
- Camera readiness status.
- Human-reviewed proctoring observations, if applicable.

Do not expose sensitive video or evidence to users who are not authorized to access it.

Preserve the existing assessment results and reporting behavior.

# 15. USER EXPERIENCE AND DESIGN

Maintain the current AssessX visual language.

The feature should feel like a native part of AssessX rather than a separate product.

Admin experience:
- Clear secondary-camera toggle.
- Simple explanation.
- Expandable configuration.
- Assessment summary showing whether the feature is enabled.

Candidate experience:
- Clear setup instructions.
- QR code pairing.
- Simple mobile camera page.
- Live positioning preview.
- Camera readiness confirmation.
- Clear connection status during the exam.

Use responsive layouts and accessible controls.

Do not redesign unrelated pages or change the existing dashboard.

# 16. IMPLEMENTATION STRATEGY — STRICTLY INCREMENTAL

Implement in the following stages.

### Stage 0 — Repository and Architecture Audit

Before changing any code:

- Inspect the full repository.
- Inspect Git status and current branch.
- Identify existing assessment creation/editing components.
- Identify current proctoring configuration.
- Identify primary camera implementation.
- Identify examination session lifecycle.
- Identify backend APIs and database models.
- Identify WebRTC or other real-time infrastructure, if any.
- Identify the current proctoring dashboard.
- Identify existing tests.

Create a short impact report.

Do not modify files during this audit.

### Stage 1 — Assessment Configuration

Add the optional Standard Proctoring / Standard + Secondary Camera selection.

Verify that existing assessments retain their previous behavior.

### Stage 2 — Secure QR Pairing

Implement session-specific QR generation and mobile pairing.

Verify token expiry, single-use behavior, and session isolation.

### Stage 3 — Mobile Camera Interface

Implement the mobile browser interface and camera preview.

Verify supported browser behavior and permissions.

### Stage 4 — Real-Time Streaming

Implement secure WebRTC signaling and video streaming.

Verify desktop-mobile communication and reconnection.

### Stage 5 — Examination Integration

Integrate secondary camera readiness into the existing examination startup flow.

Preserve existing exam behavior when secondary camera is disabled.

### Stage 6 — Admin Monitoring

Add the secondary camera feed and status to the existing monitoring interface.

### Stage 7 — Proctoring Events and Reporting

Integrate relevant events with the existing proctoring architecture.

### Stage 8 — Security and Regression Testing

Test the new feature and the entire existing assessment workflow.

Do not move to the next stage if the current stage introduces regressions.

# 17. TESTING REQUIREMENTS

Test at minimum:

1. Standard Proctoring assessment still works exactly as before.
2. Existing assessments do not unexpectedly require secondary cameras.
3. Admin can enable secondary camera for a new assessment.
4. Admin can disable it.
5. QR code is generated for the correct candidate session.
6. Correct mobile device can pair.
7. Wrong or expired QR code is rejected.
8. Reusing a QR code is rejected.
9. Another candidate cannot join the session.
10. Mobile camera permission denial is handled.
11. Camera preview works on supported mobile browsers.
12. Live video reaches the correct desktop session.
13. Network interruption is detected.
14. Reconnection works where possible.
15. Exam progress is not lost during camera interruptions.
16. Admin sees correct connection status.
17. Unauthorized users cannot view the feed.
18. Existing AI proctoring and primary camera functionality remain intact.
19. Existing exam creation, editing, publishing, and submission remain intact.
20. Existing tests continue passing.

Test on actual Android and iOS devices where available. Do not claim universal mobile browser support without testing it.

# 18. ABSOLUTE NON-NEGOTIABLE RULES

- Do not rebuild AssessX.
- Do not rewrite existing modules.
- Do not replace the existing proctoring system.
- Do not remove existing features.
- Do not change existing authentication.
- Do not change existing assessment workflows unnecessarily.
- Do not redesign the complete admin dashboard.
- Do not break existing API contracts.
- Do not delete or reset database records.
- Do not overwrite environment configuration.
- Do not introduce hardcoded secrets.
- Do not make secondary camera mandatory globally.
- Do not publish untested changes.
- Do not claim a feature is complete if it has not been tested.

Use new modules and components wherever practical, and integrate through the smallest safe changes.

If a change to an existing file is unavoidable, make the smallest possible modification and explain why.

If a proposed implementation conflicts with an existing system, stop and report the conflict instead of forcing a rewrite.

# 19. FINAL DELIVERY REPORT

After implementation, provide:

1. Architecture audit findings.
2. Files created.
3. Existing files modified.
4. Database migrations added.
5. New API endpoints.
6. QR pairing implementation details.
7. Mobile browser compatibility tested.
8. WebRTC implementation details.
9. Security measures implemented.
10. Tests executed and their results.
11. Existing functionality regression results.
12. Known limitations.
13. Environment variables or infrastructure required.
14. Exact steps to run and test the feature locally.

**FINAL INSTRUCTION: Add Secondary Camera Proctoring as an isolated, optional extension to the existing AssessX application. Protect all existing functionality. Inspect first, implement incrementally, test continuously, and never sacrifice existing working code to add this feature.**
