# Security operations: monitoring, alerting, audit

How AssessX detects, alerts and supports investigation. For incident handling see
[`INCIDENT-RESPONSE.md`](INCIDENT-RESPONSE.md).

## Security events

`security_events` (migration 0028) is **separate from the business audit log**. It records things that
are security-relevant, with:
* severity, category and time;
* request id, actor (if known) and the trusted client address;
* target and safe details.

It never records passwords, tokens, keys, URLs, answer text or video. Keys that look like credentials
are dropped automatically, and accounts appear as an HMAC (`account_key`).

**Normal proctoring observations are never security events.** A face out of view, gaze, a focus change
or head movement stay proctoring events for human review.

| Event | Severity | Source |
|---|---|---|
| `sign_in_failed` | LOW | wrong credentials (no account details stored) |
| `sign_in_throttled` | HIGH | throttling engaged |
| `authentication_failed` | LOW | a request with a bad, expired or revoked token (401) |
| `authorization_denied` | MEDIUM | a signed-in user refused (403) |
| `resource_probe` | LOW | a signed-in user asking for someone else's id (404 on protected prefixes) |
| `rate_limited` / `code_run_limited` / `download_rate_limited` | LOW / LOW / MEDIUM | limits refusing requests |
| `websocket_auth_failed` / `websocket_abuse` / `websocket_connection_limit` | LOW / HIGH / MEDIUM | socket refusals and closures |
| `server_error` | LOW | any 5xx |
| `mfa_failed` / `mfa_recovery_used` / `mfa_reset` | MEDIUM / HIGH / HIGH | admin second factor |
| `admin_new_ip` | MEDIUM | an admin signing in from an address not seen for them in 30 days |
| `sessions_revoked_bulk` | HIGH | 5 or more sessions of one account ended at once |
| `exam_takeover` | MEDIUM | an exam moved to another sign-in |
| `storage_failure` | HIGH | evidence storage refusing an operation |
| `backup_failed` / `backup_missing` | HIGH | backup heartbeat failure, or no success within 26 h |
| `evidence_access_limited` | HIGH | evidence-view rate limit hit |
| `evidence_integrity_failed` / `audit_integrity_failed` | CRITICAL | hash mismatch |
| `ai_injection_suspected` | MEDIUM | instruction-like text in an interview answer |
| `maintenance_auth_failed` | HIGH | wrong maintenance token |

The source of truth is `TAXONOMY` in `backend/app/services/security_events.py`.

## Alert rules

Rules count matching events in a window, per group (actor, client address, account, or global). When a
threshold is reached they raise **one** alert per rule and group per cooldown (default 30 minutes), so
alerts are deduplicated and never storm.

| Rule | Condition | Severity |
|---|---|---|
| `sign_in_spray` | failed sign-ins on 10+ distinct accounts in 15 min | CRITICAL |
| `account_brute_force` | 5 failures on one account in 15 min | MEDIUM |
| `sign_in_throttled` | any throttling, per address | HIGH |
| `repeated_authorization_denied` | 5 refusals for one user in 10 min | HIGH |
| `cross_resource_probing` | 10 probes by one user in 10 min | HIGH |
| `mass_cross_candidate_access` | 100 refusals or probes in 10 min (all users) | CRITICAL |
| `invalid_token_flood` | 20 bad tokens or tickets from one address in 10 min | MEDIUM |
| `websocket_abuse` | any abuse closure or socket cap hit | HIGH |
| `error_spike` | 20 server errors in 5 min | CRITICAL |
| `integrity_failure` | any evidence or audit integrity failure | CRITICAL |
| `storage_failure` | 3 in 30 min | HIGH |
| `backup_problem` | a failed or missing backup | HIGH |
| `evidence_access_abuse` | evidence-view limit hit | HIGH |
| `ai_injection_abuse` | 3 flagged answers from one candidate in 1 h | HIGH |
| `admin_new_ip` | an admin from a new address | MEDIUM |
| `admin_mfa_failures` | 5 wrong second-factor codes in 15 min | CRITICAL |
| `admin_account_change` | MFA reset, recovery code used, or bulk session revocation | HIGH |
| `abusive_requests` | 30 rate-limit refusals from one address in 10 min | MEDIUM |
| `maintenance_auth` | 3 wrong maintenance tokens in 1 h | HIGH |
| `exam_takeovers` | 3 takeovers by one candidate in 1 h | MEDIUM |

### Where alerts go

Every alert is:
* stored in `security_alerts`, shown under **Security → Alerts** in the admin app, where it can be
  acknowledged (audited);
* logged as `SECURITY ALERT` (visible in Render's logs);
* sent to **`ALERT_WEBHOOK_URL`** if that is set (an https URL; a Slack, Discord or ntfy incoming
  webhook all work, and all are free). The message carries the rule, severity, count and time; never ids,
  addresses or secrets.

## Client address (who connected from where)

* The address comes from `CLIENT_IP_HEADER` when it is set (behind Render's Cloudflare edge:
  `cf-connecting-ip`), otherwise from the connection.
* `X-Forwarded-For` is never trusted for security decisions.
* A client-supplied `X-Request-ID` is kept only if it is short and plain; anything else is replaced, so
  logs can't be injected into.
* Every request log line, audit row and security event carries the request id and address, so one
  request can be followed across all three.

## The audit trail

`audit_logs` is append-only: a database trigger refuses UPDATE and DELETE.

Since migration 0028 every row is also **hash-chained by the database**:
* a trigger sets `entry_hash` = SHA-256(previous hash + the row's canonical content), in `seq` order;
* the application never supplies a hash;
* a changed, deleted or inserted row breaks the chain.

**Security → Audit trail → Verify audit chain** (or `GET /api/v1/admin/audit-logs/verify`) recomputes
the chain. A break raises a CRITICAL alert.

The hourly maintenance run also verifies the chain and outputs the current head (`seq`, `hash`). Keep
these outputs, for example the GitHub Actions run logs: a later head that does not extend an earlier
one shows the chain was rebuilt.

**Viewing is audited.** Reading the audit trail, security events or alerts writes
`AUDIT_LOG_VIEWED` / `SECURITY_EVENTS_VIEWED`.

## Scheduled maintenance

Render Free sleeps, so nothing critical relies on the API's own timer.

* `.github/workflows/maintenance.yml` calls `POST /api/v1/internal/maintenance` hourly with
  `MAINTENANCE_TOKEN` (constant-time compared). That endpoint:
  * sweeps evidence uploads;
  * applies retention ([`DATA-RETENTION.md`](DATA-RETENTION.md));
  * verifies the audit chain;
  * checks for a missing backup.

  It is 404 when no token is configured, and a wrong token is a security event.
* The API also runs the same job hourly while it is awake.
* `python -m app.cli evidence-maintenance` runs it by hand.

## Health

* `GET /health` is liveness: no dependencies, no data.
* `GET /api/v1/health` is readiness, including the database. Neither returns configuration or secrets.
* An external uptime check on `/health` is recommended (free tiers exist) and is listed in
  `FINAL-PRODUCTION-ACTIONS.md`.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `ALERT_WEBHOOK_URL` | unset | secret; https only in production |
| `CLIENT_IP_HEADER` | unset | `cf-connecting-ip` on Render |
| `MAINTENANCE_TOKEN` | unset (route off) | secret, at least 32 characters |
| `BACKUP_MAX_AGE_HOURS` | 26 | missing-backup threshold |
| `ADMIN_MFA_REQUIRED` | on in production, off elsewhere | `false` is refused in production |
| `ADMIN_SESSION_TTL_HOURS` | 12 | |
| `MAX_SOCKETS_PER_USER` | 6 | |
| `EVIDENCE_VIEWS_PER_HOUR`, `REPORT_DOWNLOADS_PER_HOUR` | 120 | per admin |
| `RETENTION_*` | see `DATA-RETENTION.md` | |
