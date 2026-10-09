# Final production actions (owner only)

These are the only steps that cannot be done from the repository. Do them in this order. Each has a check
you can run. No secret value belongs in a file, a commit or a chat: generate secrets locally and paste
them straight into the dashboard.

| # | Action | Where | Configuration | Why | Verify | Expected |
|---|---|---|---|---|---|---|
| 1 | **Take a backup before deploying** | your machine | `python infrastructure/backup/backup.py` (`BACKUP_DATABASE_URL`, `BACKUP_PASSPHRASE` in the environment) | four migrations (0025–0028) run on deploy | `.dump.gpg` and `.sha256` exist | a file of a few MB |
| 2 | **Render secrets** | Render → assessx-backend → Environment | `MAINTENANCE_TOKEN` (random, 32+ characters), `CLIENT_IP_HEADER=cf-connecting-ip`, `ALERT_WEBHOOK_URL` (a Discord/Slack/ntfy webhook). Build command: `pip install --require-hashes -r requirements.lock` | maintenance, client address, alerts, hashed dependencies | save; the deploy succeeds | `/health` is ok |
| 3 | **Deploy** | GitHub: merge the release PR to `main` (Render deploys) | — | puts 8A/8B/8 final live (CX-01) | `GET https://<api>/api/v1/health` | `{"status":"ok","database":"ok"}` |
| 4 | **Enrol admin MFA** | AssessX app, admin sign-in | follow the "Set up two-step sign-in" screen; save the 10 recovery codes in the password manager | admin accounts need MFA in production | sign out and back in | asks for a 6-digit code |
| 5 | **A second administrator** | operator machine: `python -m app.cli create-admin --email … --name … --username …` against production (with `ASSESSX_ADMIN_PASSWORD` in the environment) | — | one admin can reset the other's MFA; no single point of failure | the second admin signs in and enrols | success |
| 6 | **GitHub secrets and variable** | GitHub → Settings → Secrets and variables → Actions | secrets `BACKUP_DATABASE_URL`, `BACKUP_PASSPHRASE`, `MAINTENANCE_TOKEN`; variable `ASSESSX_API_URL=https://assessx-backend-0nw6.onrender.com` | scheduled backup and maintenance | Actions → Backup → Run workflow (with drill), then Maintenance → Run | both green; the API shows no `backup_missing` |
| 7 | **Repository protection** | GitHub → Settings (`docs/security/REPOSITORY-AND-RELEASE-SECURITY.md`) | `main` ruleset (PR + CI required, no force push), 2FA for collaborators, secret scanning and push protection, Dependabot. **Make the repository private** if possible (backup artifacts are encrypted, but private is better) | BX-02 | open a test PR | merge blocked until CI passes |
| 8 | **Database checks and least privilege** | Supabase SQL editor; Render | the read-only queries in `docs/security/DATABASE-ROLES.md` §2; Data API: remove `public` from exposed schemas; optionally §3 (runtime login user) and §4 (`sslmode=verify-full`) | BX-01/05/09 | the queries | 43 tables with RLS and policy; no `anon`/`authenticated` grants |
| 9 | **Verify the client address** | AssessX | sign in once with a wrong password (correct security check) | CX-03 / BX-15 | Admin → Security → Security events → `sign_in_failed` | the address is your public IP |
| 10 | **Back up the update-signing key** | password manager plus an offline copy | `docs/security/REPOSITORY-AND-RELEASE-SECURITY.md` → BX-03 | losing it ends in-app updates | restore it on a second machine (do not release) | the key file matches |
| 11 | **Release the desktop app** | release machine: `npm run release:build` (version bumped) | upload the `.exe`, `latest.json` and `SHA256SUMS.txt` to GitHub Release `v<version>`; update the website link | delivers the client-side fixes (WebSocket tickets, MFA screens, credential storage, evidence recorder) | install on a test PC | update offered; sign-in with MFA works |
| 12 | **Uptime check** (free) | e.g. UptimeRobot or Better Stack free tier | monitor `GET /health` every 5 min; alert to your email | detect outages | pause the service briefly | alert received |
| 13 | *(optional)* **Evidence clips** | Supabase Storage + Render | `docs/EVIDENCE-CLIPS.md` → Production setup (private bucket, `EVIDENCE_*`, `SUPABASE_*`) | FR-017 | a test exam | the clip plays under Monitoring |
| 14 | *(optional, paid)* **Authenticode certificate** | a certificate authority or Azure Trusted Signing | `docs/security/REPOSITORY-AND-RELEASE-SECURITY.md` → BX-07 | removes the SmartScreen "unknown publisher" warning | Windows file properties → Digital signatures | signed |

After step 6 has run once, **Admin → Security → Alerts** should show no `backup_problem` alert, and the
hourly Maintenance run should report `audit_chain_verified: true`.
