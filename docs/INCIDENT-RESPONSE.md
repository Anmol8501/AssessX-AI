# Incident response

Every incident follows the same flow: **detect → triage → contain → investigate → eradicate → recover →
review**. The owner is the AssessX operator (the deployment's administrator). Bring in the institution's
security or data-protection contact for anything involving personal data.

## General steps

1. **Detect.** Security alerts (webhook, Admin → Security → Alerts, the Render log `SECURITY ALERT`);
   GitHub failure emails (backup, maintenance, CI); user reports.
2. **Triage.** Decide what is affected (accounts, data, availability) and how severe it is (the alert's
   severity is a starting point). Write down the time and what you saw.
3. **Contain before you investigate** when data is at risk. Revoking access is reversible; leaked data
   is not.
4. **Preserve evidence. Never delete it.** Keep:
   * the audit trail and security events (Admin → Security, or SQL);
   * Render logs (download them: Render keeps them only briefly);
   * the maintenance run outputs (audit chain heads);
   * the GitHub Actions logs.
5. **Investigate with the request id.** The same id appears in the API log line, the audit row and the
   security event, along with the client address, actor and time.
6. **Eradicate, recover, verify.** See `DISASTER-RECOVERY.md`. Verify the audit chain afterwards.
7. **Review within a week.** What happened, why the controls did or didn't catch it, what changes. Keep
   the record.

## Playbooks

| Incident | Immediate action | Revoke | Preserve | Investigate with | Recover |
|---|---|---|---|---|---|
| **Leaked credential (a user's password)** | Candidates/Admin → deactivate the account, or *Sign out everywhere* | the user's sessions (deactivation ends them, sockets included) | audit `SIGN_IN_*` and `SESSIONS_REVOKED` rows; security events for the account | sign-ins from new addresses (`admin_new_ip`), `account_brute_force` alerts | issue a reset code; the user sets a new password; reactivate |
| **Leaked API key or server secret** (`SECRET_KEY`, Supabase, runner, LLM, maintenance or webhook) | rotate the secret in its dashboard and on Render; redeploy | the key itself; for `SECRET_KEY` every session and admin MFA enrolment | Render and provider logs | provider usage logs, `maintenance_auth_failed` | `DISASTER-RECOVERY.md` → credential rotation |
| **Compromised admin account** | another admin: `POST /api/v1/users/{id}/mfa-reset` and deactivate or change the password; or the operator CLI `reset-admin-mfa` | that admin's sessions and second factor | all audit rows with that actor; evidence-view rows | `admin_new_ip`, `admin_mfa_failures`, `mfa_recovery_used`, actions in the audit trail | re-enrol MFA from a clean device; review what they changed (exam settings, answer keys, reviews, deleted clips) |
| **Suspected database compromise** | rotate the database password; consider maintenance mode (scale the Render service to 0) | database credentials, the service-role key, `SECRET_KEY` | **a forensic backup before any change** (`backup.py`), the audit chain head | verify the audit chain; `DATABASE-ROLES.md` checks; Supabase logs | restore into a new project if integrity is in doubt (`DISASTER-RECOVERY.md`) |
| **Suspicious candidate account** | hold the exam (Monitoring → hold); deactivate if needed | that candidate's sessions | the attempt's events, evidence clips (start a review to **hold** them), takeovers | `resource_probe`, `authorization_denied`, `exam_takeover`, `ai_injection_suspected` | reactivate or keep closed; a human decides on the exam |
| **Compromised desktop build** | pull the GitHub Release; publish a fixed version signed with the release key | — | the bad artifact and its hash (`SHA256SUMS.txt`) | compare with CI and the release checklist | tell users to reinstall from the website and check the checksum |
| **Compromised updater signing key** | **stop releasing.** Follow the rollover in `security/REPOSITORY-AND-RELEASE-SECURITY.md` | the old key, after rollover | releases since the suspected leak | GitHub release history, audit of who had access | ship the rollover release; tell users to reinstall if any malicious update was published |
| **Storage breach or evidence exposure** | rotate the Supabase service-role key; confirm the bucket is **private** | the service-role key | `EVIDENCE_CLIP_VIEWED` / `_DELETED` audit rows; Supabase storage logs | `evidence_access_abuse`, `evidence_integrity_failed` | delete affected clips if required (audited); notify per the institution's policy |
| **Malicious API traffic** | identify the address from security events; block it at Cloudflare or Render if needed | — | security events, Render logs | `invalid_token_flood`, `abusive_requests`, `cross_resource_probing` | tighten the limits (config); keep alerts on |
| **DDoS or resource exhaustion** | Render: scale up temporarily; Cloudflare protections | — | Render metrics and logs | `error_spike`, rate-limit events | requests are already bounded (paged lists, body and socket limits); review which endpoint was hit |
| **AI prompt-injection abuse** | none urgent: injection attempts are flagged, scores are bounded, and humans decide | — | the flagged evaluations and the answers | `ai_injection_suspected`, `ai_injection_abuse` alerts | reviewers check flagged answers; keep `LLM_PROVIDER` on, or switch to `none` to stop AI scoring |
| **Audit chain does not verify** | treat as a database compromise (above) | — | **the chain state now**, including the first broken `seq` | compare with earlier maintenance heads | restore if needed; the break itself is evidence |
| **Backups failing or missing** | run the Backup workflow by hand; fix the secrets | — | — | the workflow log | `DISASTER-RECOVERY.md` → failure response |

## Contacts and access to set up before you need them

* At least **two administrator accounts**, each with MFA, so one can reset the other.
* The password manager entries: backup passphrase, update-signing key, recovery codes.
* Who can change Render, Supabase, Cloudflare and GitHub settings, each with 2FA
  (`FINAL-PRODUCTION-ACTIONS.md`).
