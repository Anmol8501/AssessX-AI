# Final release security checklist

One line per control: where it lives, what proves it, and its status. **Done** means implemented and
covered by a passing automated test in this working tree. **Owner** means a step only the operator can do
(see `FINAL-PRODUCTION-ACTIONS.md`). **Accepted** means a known limit, documented, not fixed in this
release.

Backend tests are in `backend/tests/`, desktop tests in `apps/desktop/src/**/*.test.ts(x)`, and Rust
tests in `apps/desktop/src-tauri/src/`.

## Release manifest

`[x]` is implemented and verified in this working tree. `[ ]` needs an owner step
(`FINAL-PRODUCTION-ACTIONS.md`); the status column says which.

| | Item | Implementation | Proven by | Status |
|---|---|---|---|---|
| [x] | Authentication hardened | `services/auth.py`, `services/login_throttle.py`, `services/challenges.py` | `test_security_hardening.py` (throttling, challenges, sessions), `test_auth.py`, e2e `auth`, `account-security` | Done |
| [x] | Authorization hardened | role dependencies in `api/deps.py` on every route | `test_route_authz.py` (route table fully covered), `test_authorization.py` | Done |
| [x] | IDOR/BOLA tested | ownership checks in services and repositories | `test_probing_another_candidates_attempt_is_blocked_and_alerts_when_repeated`, `test_another_candidate_can_never_upload_to_or_fail_a_clip`, `test_admins_reach_a_clip_only_through_its_own_attempt`, e2e `publishing` (own assignments only) | Done |
| [x] | Rate limiting complete | sign-in, challenges, code runs, sockets, evidence views, report downloads (`services/rate_limit.py`, `realtime/security.py`) | throttle tests, `test_run_limits_are_per_attempt`, `test_a_user_cannot_hold_more_sockets_than_allowed`, `test_evidence_views_are_rate_limited_per_admin` | Done |
| [x] | WebSocket security complete | single-use tickets, frame and rate limits, revocation, 6 sockets per user | socket tests in `test_security_hardening.py` and `test_security_operations.py` | Done |
| [x] | Code-run abuse protection complete | `services/coding/execution.py` | `test_run_limits_are_per_attempt`, `test_coding_hardening.py` | Done |
| [x] | Pagination complete | `api/paging.py`; desktop `usePagedList`, candidate search | `test_large_lists_are_bounded_and_paged`, `test_my_exams_and_results_are_paged_and_still_scoped`, `test_admin_finds_a_candidate_by_name_email_or_roll_number` | Done |
| [x] | Database/RLS verified | migration 0026 (`core/db_security.py`), 0028 for the new tables | `test_every_table_has_rls_and_the_runtime_policy`, `test_a_role_without_a_policy_sees_nothing_even_with_a_grant` | Done; the production read-only check is step 8 |
| [ ] | Least privilege verified | `assessx_runtime` role (no DDL, append-only audit) | `test_the_runtime_role_works_but_cannot_change_the_schema_or_history` | Verified in development. Production still connects as the owner until the optional step 8 §3 is done |
| [x] | Secrets audit clean | `.gitignore`, `.gitleaksignore` (reviewed fake test tokens only) | gitleaks: history and working tree | Done |
| [x] | Dependency audit clean | `requirements.lock` (hashed), lockfiles | pip-audit, npm audit (desktop, web), cargo audit: 0 vulnerabilities | Done |
| [ ] | CI security configured | `.github/workflows/ci.yml` (lint, tests, build bundle check, audits), `dependabot.yml`, pinned actions | actionlint clean | Written; first run, branch rules and push protection are step 7 |
| [ ] | Monitoring configured | security events, `/health`, Render logs | security-event tests | Done in code; the uptime check is step 12 |
| [ ] | Alerting configured | `services/security_events.notify` | `test_alerts_go_to_the_webhook_without_ids_or_secrets` | Done in code; `ALERT_WEBHOOK_URL` is step 2 |
| [x] | Security event taxonomy complete | `security_events.TAXONOMY` (26 types), `RULES` (20) | `test_security_operations.py` | Done |
| [ ] | Admin MFA complete | `services/mfa.py`, `SecondFactorStep.tsx` | MFA tests (7) | Done in code; enrolment is steps 4–5 |
| [x] | Admin session security complete | 12 h admin sessions, never remembered, new-IP notice | `test_admin_sessions_are_short_and_never_remembered` | Done |
| [x] | AI prompt injection hardened | `services/interview/prompts.py`, `evaluation.py` | injection tests (3) | Done. Detection is pattern-based; humans decide |
| [x] | Unicode/control-character defence complete | `sanitize_answer` (NFKC; strips Cc/Cf/Co/Cs) | `test_instruction_like_answers_are_detected_and_neutralised` | Done |
| [x] | Evidence security complete | `services/evidence_clips/` | `test_evidence_clips.py`, `test_evidence_api.py`, e2e `evidence-clips` | Done; storage setup is optional step 13 |
| [x] | Evidence retention complete | `_expire_clips`, review holds | `test_retention_deletes_the_video_keeps_the_record_and_holds_open_reviews` | Done |
| [x] | Data retention defined | `services/retention.py`, `docs/DATA-RETENTION.md` | retention tests (2) | Done. Account erasure is manual (documented) |
| [x] | Audit viewer complete | Admin → Security → Audit trail | `test_admins_read_the_audit_log_paged_and_the_read_is_audited` | Done |
| [x] | Audit integrity protection complete | hash chain (migration 0028), `services/audit_chain.py` | `test_the_chain_verifies_and_detects_tampering` | Done (tamper-evident, not tamper-proof) |
| [ ] | Backup tooling complete | `infrastructure/backup/`, `backup.yml` | `test_a_missing_backup_is_detected`; workflow drill | Done in code; GitHub secrets are step 6 |
| [x] | Recovery procedure complete | `docs/DISASTER-RECOVERY.md`, `restore.py` | monthly restore drill in `backup.yml` | Done |
| [x] | Incident response complete | `docs/INCIDENT-RESPONSE.md` | — (procedure) | Done |
| [x] | Desktop security reviewed | CSP, kiosk, no remote content, bundle check | Rust tests (26), vitest (241), bundle check | Done |
| [x] | Token storage secured | `credentials.rs`, `tokenStorage.ts` | Rust credential tests, vitest | Done |
| [x] | Release security reviewed | `docs/security/REPOSITORY-AND-RELEASE-SECURITY.md`, `RELEASING.md` | signed updater manifests, checksums | Done; key backup is step 10 |
| [ ] | Installer/release signing readiness reviewed | updater signing in place; Authenticode not | — | Authenticode is step 14 (paid, optional). It is **not** faked |
| [x] | Production configuration reviewed | `core/config.py` production checks (MFA, webhook https, token length, evidence) | `test_production_refuses_to_run_without_admin_mfa`, `test_production_refuses_unsafe_evidence_configuration`, `test_production_publishes_no_api_description` | Done |
| [x] | Full tests passed | — | backend, vitest, Rust, e2e (see the release report) | Done |
| [x] | Large-data tests passed | paging in SQL | `test_large_lists_are_bounded_and_paged` (451 rows); e2e against the development database with 2,200+ assessments | Done |
| [x] | No production secrets in repository | — | gitleaks; `git ls-files` review | Done |
| [x] | No candidate data in repository | — | `git ls-files` review (fixtures use `example.org` / `test.local`) | Done |
| [x] | No evidence media in repository | `.gitignore` (`*.webm`, `*.mp4`, `*.mkv`, `backend/var/`) | `git ls-files` review | Done |
| [x] | No database dumps in repository | `.gitignore` (`*.dump`, `*.dump.gpg`) | `git ls-files` review | Done |
| [x] | No private keys in repository | `.gitignore` (`*.key`, `*.pem`, `*.p12`, `*.pfx`, `id_*`) | gitleaks; `git ls-files` review | Done |

## Phase 8C findings

| ID | Control | Implementation | Test | Status |
|---|---|---|---|---|
| CX-01 | 8A/8B/8 final fixes live in production | — | — | **Owner**: review, commit, merge, deploy (steps 1–3) |
| CX-02 | Security events, threshold alerts, webhook | `services/security_events.py`, `models/security_event.py`, migration 0028 | `test_security_operations.py`: sign-in spray, probing, webhook payload, alerts list/acknowledge | Done; webhook URL is **Owner** (step 2) |
| CX-03 | Authorization failures recorded; trusted client IP and request id in logs, audit rows and events | `core/logging.py` (`observe_response`), `repositories/audit.py` | `test_a_candidate_on_an_admin_route_is_refused_and_recorded`, `test_the_client_address_comes_from_the_trusted_header_only`, `test_a_hostile_request_id_is_replaced`, `test_audit_rows_carry_where_they_came_from` | Done; `CLIENT_IP_HEADER` is **Owner** (step 2) |
| CX-04 | Bounded paging (default 50, max 200, applied in SQL) | `api/paging.py`, list routes and repositories; desktop `usePagedList`, `LoadMore` | `test_large_lists_are_bounded_and_paged`, `test_my_exams_and_results_are_paged_and_still_scoped`, `test_admin_finds_a_candidate_by_name_email_or_roll_number`, e2e `account-security`, `publishing` | Done. The Candidates page has a server-side search (bounded, wildcards literal), so a row beyond the first page can be reached |
| CX-05 | Code-run flooding: 10/min, 2 in flight per attempt, 300 per attempt, queue cap 500 | `services/coding/execution.py` | `test_run_limits_are_per_attempt`, `test_coding_hardening.py` | Done |
| CX-06 | Daily encrypted backup off the database host, monthly restore drill, missing-backup alert | `infrastructure/backup/`, `.github/workflows/backup.yml`, `services/retention.check_backups` | `test_a_missing_backup_is_detected`; restore drill runs in the workflow | Done; GitHub secrets are **Owner** (step 6) |
| CX-07 | Admin TOTP MFA (anti-replay, throttled, recovery codes, sealed secret); 12 h admin sessions, never remembered; new-IP notice; MFA reset by another admin or the CLI | `services/mfa.py`, `api/deps.py`, `api/v1/auth.py`, `SecondFactorStep.tsx` | `test_mfa_enrolment_verification_replay_and_recovery`, `test_mfa_is_throttled_after_repeated_failures`, `test_when_mfa_is_required_an_admin_must_enrol_before_anything_else`, `test_admin_sessions_are_short_and_never_remembered`, `test_another_admin_resets_a_lost_second_factor`, `test_the_mfa_secret_is_sealed_and_tamper_evident`, `test_production_refuses_to_run_without_admin_mfa` | Done; enrolment is **Owner** (steps 4–5) |
| CX-08 | AI interview: NFKC, invisible and control characters stripped, role/tool tags neutralised, injection flagged to the reviewer, scores bounded | `services/interview/prompts.py`, `evaluation.py`, `runner.py` | `test_instruction_like_answers_are_detected_and_neutralised`, `test_ordinary_answers_are_left_alone`, `test_an_injection_attempt_is_flagged_for_the_reviewer_and_scores_stay_bounded` | Done. Detection is pattern-based, so a determined rewording can avoid the flag; the human review decides |
| CX-09 | Remembered desktop token in Windows Credential Manager; session-only tokens in memory/sessionStorage; legacy token migrated | `src-tauri/src/credentials.rs`, `features/session/tokenStorage.ts` | Rust `credentials` tests (a real round trip outside CI), vitest | Done. Script injected into the running app could still call the API with the live session; CSP and no remote content limit that |
| CX-10 | Written retention; automatic, audited purge; holds for open reviews | `services/retention.py`, `docs/DATA-RETENTION.md` | `test_retention_purges_old_data_but_holds_reviews`, `test_attempts_past_retention_are_deleted` | Done. **Accepted:** no account-deletion or pseudonymisation feature (deactivate, then the documented manual step) |
| CX-11 | Admin audit viewer (itself audited); hash-chained, append-only audit log; chain verification | `api/v1/admin_security.py`, migration 0028, `services/audit_chain.py`, Admin → Security | `test_admins_read_the_audit_log_paged_and_the_read_is_audited`, `test_the_chain_verifies_and_detects_tampering` | Done. The chain shows tampering but can't prevent a database owner rewriting the whole chain; the maintenance run logs the head hash outside the database to check against |
| CX-12 | 6 sockets per user; evidence views and report downloads capped at 120 per hour per admin | `realtime/security.py`, `services/rate_limit.enforce_hourly` | `test_a_user_cannot_hold_more_sockets_than_allowed`, `test_evidence_views_are_rate_limited_per_admin` | Done |
| CX-13 | 26-type security-event taxonomy with severities; 20 rules | `services/security_events.TAXONOMY`, `RULES`; `GET /admin/security/taxonomy` | `test_normal_proctoring_observations_are_never_security_events` and the tests above | Done |
| CX-14 | Retention, evidence sweep, chain verification and backup check run hourly even while Render sleeps | `.github/workflows/maintenance.yml` → token-protected `POST /internal/maintenance` | `test_the_maintenance_endpoint_is_off_or_token_protected` | Done; `MAINTENANCE_TOKEN` is **Owner** (steps 2 and 6) |
| CX-15 | Dependency audits clean; CI workflow; signed updates; Authenticode | `.github/workflows/`, `requirements.lock` | pip-audit, npm audit, cargo audit: 0 vulnerabilities | Done except **Owner**: first CI run, repository rules (step 7), and Authenticode (step 14, paid) |
| CX-16 | Single-organisation admin model; capture is client-side; Windows lockdown detects rather than prevents | `docs/SECURITY.md` | — | **Accepted**, documented |

## Earlier controls re-verified in this pass

| Control | Test | Status |
|---|---|---|
| Sign-in throttling per account and per client; spray detection; no `X-Forwarded-For` trust | `test_security_hardening.py` (throttle tests) | Done |
| Body-size limit, security headers, no API description in production | `test_an_oversized_body_is_refused_before_it_is_read`, `test_api_responses_carry_security_headers`, `test_production_publishes_no_api_description` | Done |
| Session revocation (password change, sign out everywhere, deactivation, single-use reset codes) | `test_security_hardening.py` session tests | Done |
| WebSocket single-use tickets, frame and flood limits, close on revocation | `test_security_hardening.py` socket tests | Done |
| Every route has a role guard and requires a token | `test_route_authz.py` (route table fully covered) | Done |
| Row-level security on every table; the runtime role can't change the schema or history | `test_every_table_has_rls_and_the_runtime_policy`, `test_the_runtime_role_works_but_cannot_change_the_schema_or_history` | Done; production checks are **Owner** (step 8) |
| Evidence clips: server-owned, hashed, private storage, strict keys, per-attempt access, audited views and deletes, retention | `test_evidence_clips.py`, `test_evidence_api.py` | Done |
| Exam integrity: takeover blocked, frozen settings, audited key changes | `test_security_hardening.py`, `test_exam_integrity.py` | Done |
| Desktop production bundle contains no test hooks, local API addresses or secrets | `npm run build` → bundle check | Done |
| No secrets in Git history or the working tree | gitleaks (history clean; working tree: reviewed test fixtures only) | Done |

## Release gate

Release only when all of these are true:

- [ ] Backend, desktop (vitest, typecheck, lint, build), Rust and e2e suites pass on the release commit.
- [ ] CI is green on the pull request.
- [ ] A backup was taken immediately before the deploy (migrations 0025–0028).
- [ ] After deploy: `/health` ok; admin MFA enrolled; Security → Verify audit chain passes; one
      wrong-password sign-in shows your real public IP.
- [ ] The Backup and Maintenance workflows have each run green once.
- [ ] The desktop release is built with the signing key from the password manager, and its checksums
      are published.
