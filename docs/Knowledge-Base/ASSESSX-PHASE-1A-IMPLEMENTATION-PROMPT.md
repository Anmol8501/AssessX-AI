# ANTIGRAVITY MASTER IMPLEMENTATION PROMPT
## AssessX — Phase 1A: Windows Environment & Device Provisioning

**Saved:** 2026-11-05  
**Status:** Planned — Stage 0 (Repository Audit) in progress  
**Do not commit until explicitly instructed.**

---

# 1. CRITICAL PROJECT PRESERVATION RULES

These rules have the highest priority.

## 1.1 Never rebuild AssessX

AssessX is an existing project. Do not create a new application, replace the current architecture, rewrite the frontend or backend, or remove existing modules. Work inside the existing AssessX project.

## 1.2 Preserve existing features

Existing functionality must continue working after all changes, including: student/admin authentication, examination workflows, proctoring, camera/microphone, screen monitoring, AI proctoring events, focus monitoring, fullscreen, clipboard/context-menu/print/developer-tools restrictions, screen-capture exclusion, multi-monitor detection, RDP detection, existing process readiness checks, keyboard shortcut restrictions, device readiness, WebRTC, backend APIs, database models/migrations, existing security mechanisms.

## 1.3 No destructive changes

Never delete directories, source files, database tables, reset the database, rewrite migrations, replace env config, overwrite config files, rewrite Git history, reset/force-push branches, change Windows shell config on the primary dev machine, or create/delete Windows accounts without explicit approval.

## 1.4 Preserve existing user changes

Before editing: inspect Git status, identify modified and untracked files, do not discard existing user changes.

---

# 2. PROJECT TECHNOLOGY AND ARCHITECTURE

- **Desktop application:** Tauri + React + TypeScript + Rust
- **Backend:** FastAPI + Python + Pydantic + SQLAlchemy + Alembic
- **Database:** Supabase PostgreSQL
- **Deployment:** Cloudflare Workers (landing page), Render (backend), Supabase (database)

Verify against actual repository before implementation.

---

# 3. STAGE 0 — REPOSITORY AUDIT (First Task)

Before coding, perform a full repository audit:

1. Inspect project structure (root, frontend, Tauri config, Rust source, backend, DB models, API routes, migrations, Windows-specific scripts, installer config, tests, docs, build/deploy config).
2. Read all documentation (PRD, TRD, Knowledge Base, PROJECT-CONTEXT.md, CLAUDE.md, README, Windows security docs, existing implementation plans).
3. Create a feature audit table (status: IMPLEMENTED_AND_TESTED / IMPLEMENTED_BUT_UNVERIFIED / PARTIALLY_IMPLEMENTED / MISSING / NEEDS_REFACTORING) for: Windows compatibility detection, Hardware readiness, Camera readiness, Microphone readiness, Windows security readiness, Administrator verification, Candidate account provisioning, Device identity, Device registration, Configuration validation, Diagnostics, Rollback.
4. Run baseline tests where practical (frontend tests, TypeScript, lint, frontend build, Rust tests, Rust build, backend tests, backend lint/type checks).
5. Produce audit report before implementation begins.

---

# 4. PHASE 1A — MODULES TO IMPLEMENT

## MODULE 1 — Windows Compatibility Detection
- Detect: Windows edition, version, OS build, architecture, compatibility status.
- Use Windows APIs / WMI; avoid brittle registry parsing.
- Return structured JSON result.
- Do not change Windows settings.

## MODULE 2 — Hardware Readiness Scanner
- CPU, Memory, Storage, Camera, Microphone, Display, Network, Input devices.
- Extend existing camera/microphone readiness; do not duplicate.
- Distinguish detected vs. accessible vs. tested hardware.
- Status values: PASS / WARNING / FAIL / UNKNOWN / NOT_TESTED.

## MODULE 3 — Windows Security Readiness Checker
- Secure Boot, TPM, Microsoft Defender, Windows Firewall, current user privilege level.
- Do not change any security settings, disable Defender/Firewall, or modify BIOS/UEFI.

## MODULE 4 — Administrator Privilege Verification
- Detect current context, administrator/elevated status.
- Use standard Windows elevation; do not force entire app to run as admin.
- Prefer narrowly scoped privileged helper or installer workflow.

## MODULE 5 — Candidate Account Provisioning Foundation
- Start with safe account management foundation: existence detection, type detection, permission validation, provisioning plan generation, administrator approval, operation logging, rollback planning.
- Actual account creation/modification requires explicit administrator approval.
- Never delete existing accounts automatically.
- No plaintext passwords or hardcoded credentials.

## MODULE 6 — Device Identity Foundation
- Cryptographically random identifier; stable across restarts.
- Do not rely exclusively on MAC addresses.
- Store securely; support future revocation.
- Avoid embedding backend secrets in the desktop app.

## MODULE 7 — Backend Device Registration
- Inspect existing auth, device APIs, DB models, institution models, API conventions.
- Reuse existing endpoints and structures wherever possible.
- Authenticated registration with institution association.
- Do not put Supabase service-role credentials in the desktop app.

## MODULE 8 — Configuration Validation
- Check: AssessX installation, app version, security config files, Windows service status, required components, config schema/version, file integrity, device registration state.
- Structured output; no automatic modification of existing settings; no false success.

## MODULE 9 — Installation Diagnostics Report
- Include: Device ID, Windows info, hardware checks, security checks, account status, device registration status, config validation, warnings, failures, timestamp, diagnostic reference ID.
- Sensitive information redaction; integrate into existing AssessX UI.

## MODULE 10 — Safe Rollback Foundation
- Change journal before every change.
- Remove only resources created by current provisioning transaction.
- Never delete pre-existing user accounts; never remove unrelated apps.
- For initial implementation: change journal and rollback planning framework only.

---

# 5. UI INTEGRATION REQUIREMENTS

- Add a "Device Setup / Device Readiness" section to the existing admin dashboard.
- Inspect existing navigation, dashboard, device readiness screens, components and styling before adding UI.
- Reuse existing components and design tokens; maintain responsive behaviour.
- Administrator workflow: Open Device Readiness → Start scan → View results → Generate report.
- Every new control must have a real, tested action.

---

# 6. ARCHITECTURE AND CODE QUALITY

- Rust/Tauri: narrow, typed commands and validated inputs; no arbitrary command execution through Tauri.
- TypeScript: strict typing, reuse existing types, avoid `any`, handle loading/error states.
- Backend: reuse existing FastAPI conventions, auth, DB models; add migrations only when necessary.
- Windows APIs: document API used, required privileges, supported editions, failure conditions.

---

# 7. TESTING REQUIREMENTS

## Unit tests
Windows info parsing, hardware readiness results, security status, compatibility decisions, device ID generation, registration response validation, configuration validation, rollback journal logic.

## Integration tests
Tauri command integration, Rust-to-TypeScript data flow, backend device registration, existing device readiness integration, diagnostic report generation.

## Windows-specific tests
Test on actual Windows: supported version, standard-user execution, administrator execution, missing camera/microphone, TPM unavailable, Secure Boot disabled, backend unavailable, device registration failure, interrupted provisioning.

## Regression tests
Application startup, student login, admin login, examination workflow, camera/microphone, proctoring, existing device readiness, backend communication, existing security restrictions, frontend build, Rust build.

---

# 8. IMPLEMENTATION STAGES

| Stage | Name | Scope |
|---|---|---|
| 0 | Repository Audit | Inspect, read docs, run baseline, produce audit report |
| 1 | Compatibility and Readiness | Modules 1–4 + existing device readiness UI integration |
| 2 | Device Provisioning Foundation | Modules 5–7: account inspection, device identity, registration |
| 3 | Diagnostics and Rollback | Modules 8–10: validation, reports, change journal |
| 4 | Integration and Regression | Full integration, existing app verification, regression tests, documentation |

---

# 9. CHANGE MANAGEMENT RULES

Before each stage: identify files to modify, explain why, identify existing functionality affected, potential risks, rollback strategy.

After each stage: list files created/modified, explain changes, list tests executed with results, identify limitations, confirm existing features remain intact, identify next stage.

---

# 10. DEFINITION OF DONE — PHASE 1A

- Windows compatibility detected reliably.
- Hardware readiness evaluated.
- Windows security readiness evaluated.
- Administrator privileges verified.
- Candidate account status can be inspected.
- Device identity is persistent and secure.
- Device registration works through existing backend.
- Configuration validation works.
- Diagnostic reports generated.
- Provisioning changes tracked.
- Safe rollback available for validated operations.
- Windows-specific behaviour tested on appropriate environment.
- Existing AssessX functionality remains operational.
- Documentation updated.
- All relevant regression tests pass, or pre-existing failures clearly documented.

