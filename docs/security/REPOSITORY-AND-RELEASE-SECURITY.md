# Repository, release key and download integrity (Phase 8B — BX-02, BX-03, BX-07)

These are settings and procedures a **repository administrator** must apply by hand. The repository
can't change its own GitHub settings, and the release key never enters it. Nothing here was changed
automatically. Each item says how to check it.

## BX-02: GitHub repository settings (`Anmol8501/AssessX-AI`)

Apply as the repository owner, under **Settings**.

| Setting | Where | Value |
|---|---|---|
| Protect `main` | Rules → Rulesets → New branch ruleset, target `main` | Require a pull request before merging (1 approval; dismiss stale approvals). Require status checks: the `CI` workflow jobs (`backend`, `desktop`, `desktop-rust`, `web`, `secrets`). Block force pushes. Restrict deletions. Require linear history (optional) |
| Bypass list | same ruleset | empty, or only the owner for emergencies |
| Tags `v*` | Rules → Rulesets → New tag ruleset | Restrict creations, updates and deletions to maintainers. Release tags drive in-app updates |
| Two-factor authentication | each collaborator's account (the owner can see who has it under Collaborators) | required for everyone with write access |
| Collaborators | Collaborators and teams | least privilege: *Write* only for people who push; review the list each release |
| Secret scanning + push protection | Security → Code security | enable both. They block a push that contains a recognised key |
| Dependabot alerts + security updates | Security → Code security | enable. A `dependabot.yml` is included for version updates |
| Actions permissions | Actions → General | "Allow … actions and reusable workflows" limited to GitHub-authored and verified creators. Workflow permissions: **Read repository contents**. Do not allow Actions to approve pull requests |
| Fork PR workflows | Actions → General | require approval for first-time contributors |

**Check:** open a test PR that changes one line and confirm that merge is blocked until CI passes and a
review is given.

## BX-03: the update-signing key

The private key (`~/.tauri/assessx-updater.key`, see `docs/RELEASING.md`) is the most valuable secret in
the project. Whoever holds it can push an update that every installed AssessX app will accept.

**Backup (do now):**
1. Copy the key file into a password manager entry (as an attachment, or the file contents in a secure
   note), together with the public key from `tauri.conf.json`.
2. Keep a second offline copy, e.g. an encrypted USB drive in a locked place. Never put it in email,
   chat, cloud notes, the repository, CI secrets of a public fork, or a screenshot.
3. Record who holds copies and where. Fewer is better.

**Today the key has no password.** A copied file is enough to sign updates. Adding a password means a
**key rollover**, which affects installed apps. It is described below and was **not** performed. It
needs the owner's explicit approval.

### Rollover procedure (only with explicit approval)

Use this when adding a password, or immediately if the key may have leaked.

1. Generate a new pair with a password: `npx tauri signer generate -p "<password>" -w ~/.tauri/assessx-updater-v2.key`.
   Store the new key and password as in "Backup" above.
2. Put the **new public key** in `apps/desktop/src-tauri/tauri.conf.json` (`plugins.updater.pubkey`),
   bump the version, and build that release **signed with the old key**. Installed apps accept it
   because they still trust the old key. Once installed, they trust only the new one.
3. Publish it, and wait until the apps in use have updated.
4. From the next release on, sign with the new key (`TAURI_SIGNING_PRIVATE_KEY_PATH` and
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`).
5. Destroy every copy of the old key.

If the old key **is known to be compromised**, step 2 still has to be signed with it. Also tell users to
reinstall from the website, and verify the installer's checksum (BX-07) before doing so.

## BX-07: download integrity

* **Updates** are already verified: the app installs an update only if its Tauri signature matches the
  built-in public key.
* **Manual downloads** (from the website or GitHub Releases) now come with checksums.
  `npm run release:build` writes `SHA256SUMS.txt` next to the installer. Upload it with each release.
  Users can check a download with:
  ```powershell
  Get-FileHash .\AssessX_<version>_x64-setup.exe -Algorithm SHA256
  ```
  Compare the result with the line in `SHA256SUMS.txt` on the GitHub Release page.
* **Authenticode (not done; needs a purchase).** The installer isn't code-signed with a Windows
  certificate, so SmartScreen warns "unknown publisher". Fixing that needs an OV/EV code-signing
  certificate or Azure Trusted Signing, which costs money and needs identity verification. It wasn't
  bought. When one is available, set `bundle.windows.certificateThumbprint` (or a `signCommand`) in
  `tauri.conf.json` and sign in `release-build.mjs` before the checksums are computed.
