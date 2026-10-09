# AssessX security architecture

This is the overview. Details live in the documents linked from each section; every claim here
describes the implementation in this repository.

AssessX is **not** "unhackable" and does not detect all cheating. It applies layered, tested controls
and records enough to investigate. Its known limits are listed at the end.

## Trust boundaries

| Component | Trust | Why |
|---|---|---|
| Desktop app (Tauri + React) | **Untrusted client** | Runs on the candidate's machine and can be modified. Every rule that matters is enforced again on the server |
| Backend (FastAPI) | **Security authority** | Decides identity, role, ownership, state, scores and retention |
| PostgreSQL (Supabase) | Backend-only | Reached only by the API, never by an app or a browser |
| Evidence storage (private bucket) | Backend-only | No app receives a storage URL or credential |
| AI provider (optional) | Untrusted output | Every model output is schema-validated and bounded; the server computes scores |

The server never trusts client-reported proctoring events, device state, evidence metadata, timestamps,
authorization claims or risk. It derives all of these, and the client only *reports* observations.

## Secrets

* **The server holds:** `SECRET_KEY`, the database URLs, `RUNNER_TOKEN`, `LLM_API_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `MAINTENANCE_TOKEN` and `ALERT_WEBHOOK_URL`. All are Render
  environment variables (secret). None is ever returned by an API or logged.
* **Backups:** `BACKUP_PASSPHRASE` and `BACKUP_DATABASE_URL` are GitHub repository secrets, used only
  by the backup workflow.
* **Update signing:** the updater private key is kept offline by the release owner and is never in the
  repository (`docs/security/REPOSITORY-AND-RELEASE-SECURITY.md`).
* **The desktop app holds no secret.** The production bundle is checked for test hooks, local
  addresses, private keys and provider keys on every build (`scripts/check-production-bundle.mjs`).
* **Personal tokens:** a session token is stored per user. Session-only sign-ins keep it in memory
  (`sessionStorage`). "Keep me signed in" (candidates only) keeps it in the **Windows Credential
  Manager**.

## Controls by area

| Area | Control | Where |
|---|---|---|
| Sign-in | Server-drawn challenge; throttling per account, per address and per account+address; dummy-hash timing; generic errors | `services/auth.py`, `login_throttle.py` |
| Admin accounts | **TOTP second factor** (mandatory in production). Codes accepted once (anti-replay), throttled, with recovery codes. Sessions last at most 12 h and are never remembered. A new-address sign-in raises an alert | `services/mfa.py`, `api/deps.py` |
| Sessions | Opaque tokens stored as HMACs. Sign out everywhere; deactivation and password change end sessions | `services/auth.py` |
| Authorization | Role guards on every route, tested route by route (`tests/test_route_authz.py`). Ownership is resolved server-side; another user's id is 404 | `api/deps.py` |
| Exams | One sign-in per exam at a time; a stale owner is taken over and audited | `services/attempts.py` |
| Requests | 2 MiB body limit; bounded paged lists (50 by default, 200 at most); security headers | `core/limits.py`, `api/paging.py` |
| WebSockets | Single-use 60 s tickets (no tokens in URLs); session re-checked every 30 s; size and rate limits; 6 sockets per user | `realtime/security.py` |
| Code runner | Sandboxed runner (no network, time and memory limits); per question 1 job in flight; per attempt 2 jobs, 10 runs a minute, 300 runs total; global queue cap | `services/coding/execution.py`, `runner/` |
| AI interviews | Answer treated as data: Unicode-normalised, control and bidi characters stripped, delimiter and role tags removed; injection attempts flagged for the reviewer; schema-validated output; server-computed score | `services/interview/` |
| Evidence clips | Server-created only, unpredictable keys, private storage, SHA-256 checked on every view, view rate limit, retention | `docs/EVIDENCE-CLIPS.md` |
| Database | RLS on every table, a least-privilege runtime role, append-only audit log | `docs/security/DATABASE-ROLES.md` |
| Audit | Who, what, when, from where and which request on every action; **hash-chained by the database**; admin viewer with chain verification | `services/audit_chain.py` |
| Monitoring | Security-event taxonomy, threshold alert rules, webhook delivery | `docs/SECURITY-OPERATIONS.md` |
| Recovery | Daily encrypted backups, monthly restore drill, missing-backup alert | `docs/DISASTER-RECOVERY.md` |
| Retention | Automatic, audited, with review holds | `docs/DATA-RETENTION.md` |
| Supply chain | Hashed Python lock, npm and Cargo lock files, digest-pinned base image, SHA-pinned CI actions, audits, secret scanning, release checksums | `.github/`, `docs/RELEASING.md` |

## Known limitations (honest, by design or by budget)

1. **Client-side proctoring can be tampered with.** A modified app can suppress events or send false
   ones. The server bounds and validates what it receives, but a missing event is never proof that
   nothing happened.
2. **Evidence clips are captured on the candidate's machine**, so a modified app could send an altered
   recording. The hash proves the clip has not changed *since upload*, not that it is authentic.
3. **AI interview scores can be influenced within their bounds.** Injection attempts are flagged, and a
   human reviewer decides.
4. **Windows lockdown is detection plus deterrence**, not an OS-managed kiosk. The kiosk configuration is
   an unverified template.
5. **Single organisation:** any administrator can see every candidate's data.
6. **Free-tier infrastructure:** Render Free sleeps and Supabase Free has limited storage and no
   point-in-time recovery. Scheduled jobs (GitHub Actions) compensate, within GitHub's own scheduling
   delays.
7. **The installer is not Authenticode-signed** until a certificate is bought. In-app updates are
   signature-verified regardless.
8. **The audit hash chain** detects tampering by anyone who cannot rebuild the whole chain. A database
   owner could recompute it, so keep the daily checkpoint (the chain head in the maintenance output).
