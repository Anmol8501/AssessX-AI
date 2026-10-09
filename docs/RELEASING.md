# Releasing the AssessX desktop app (with in-app updates)

From version **0.1.1**, the installed app updates itself. When it opens (and every few hours while
it stays open) it checks the **latest GitHub Release** of `Anmol8501/AssessX-AI`. If a newer version
exists, it shows **"AssessX x.y.z is available — Update now / Later"**. "Update now" downloads the
installer, installs it and restarts the app.

* **Signed updates only.** An update installs only if its signature matches the public key built
  into the app (`apps/desktop/src-tauri/tauri.conf.json` → `plugins.updater.pubkey`). Only someone
  holding the private release key can produce an update the app will accept.
* **Never during an exam.** The prompt does not appear on the exam screen (installing closes the app).
  Once an update has started, the window is blocked until it finishes, so an exam cannot start
  mid-update.
* **Quiet when offline.** A failed *check* (offline, GitHub unreachable, no release yet) is silent; a
  failed *install* is shown, with "Try again".
* **One-time manual step:** apps older than 0.1.1 have no updater. Install 0.1.1 by hand once; every
  later version arrives in the app.

The version the app is running is shown at the bottom of the sidebar (e.g. `v0.1.1`).

## The release signing key

* **Private key:** `C:\Users\<you>\.tauri\assessx-updater.key` on the release machine. It is **not** in
  the repository and must never be committed or shared. **Back it up** (e.g. in a password manager). If
  it is lost, installed apps can no longer be updated: every user would have to reinstall a build
  signed with a new key by hand.
* **Public key:** in `tauri.conf.json`. It is safe to publish.
* The key was generated without a password (`npx tauri signer generate --ci`). To add one, generate a
  new pair with `-p`, put the new public key in `tauri.conf.json`, and set
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` when releasing. Apps that trust only the old key must then be
  updated once with a release signed by the old key that ships the new public key, or reinstalled.

## Publishing a new version

1. **Bump the version** in all three places, keeping them equal: `apps/desktop/package.json`,
   `apps/desktop/src-tauri/tauri.conf.json` and `apps/desktop/src-tauri/Cargo.toml`. The updater only
   offers a *higher* version.
2. **Build the signed release** from `apps/desktop/`:

   ```powershell
   npm run release:build -- --notes "What changed in this version"
   ```

   This signs with the key file above, or with `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PATH`.
   It produces, in `src-tauri/target/release/bundle/nsis/`:
   * `AssessX_<version>_x64-setup.exe`: the installer;
   * `AssessX_<version>_x64-setup.exe.sig`: its signature;
   * `latest.json`: what installed apps read, holding the version, notes, signature and download URL;
   * `SHA256SUMS.txt`: the SHA-256 of the installer and `latest.json`, for people who download by hand.
3. **Create the GitHub Release** at https://github.com/Anmol8501/AssessX-AI/releases/new:
   tag `v<version>` (exactly; `latest.json` points to that tag), target `main`, upload the
   `.exe`, `latest.json` **and** `SHA256SUMS.txt`, and publish it as the **latest** release (not a pre-release).
4. **Update the website's download link** (`apps/web/.env.production` → `VITE_ASSESSX_DOWNLOAD_URL`)
   to the new installer's URL, so new users download the current version.

Installed apps pick the update up the next time they open.

Security procedures for the release key (backup, rollover) and the repository settings that protect
`main` and the release tags: `docs/security/REPOSITORY-AND-RELEASE-SECURITY.md`.

A plain `npm run tauri:build` still works without the key. It builds an unsigned installer for local
testing, which is fine to install by hand but cannot be delivered as an in-app update.

## Versions that must stay in step

Tauri requires the Rust crate `tauri` and the npm package `@tauri-apps/api` to share the same
major.minor version. `@tauri-apps/api` is therefore pinned to `~2.11`, matching `tauri` 2.11.x in
`Cargo.lock`. The updater plugins are pinned to versions that support Tauri 2.11
(`tauri-plugin-updater` / `@tauri-apps/plugin-updater` 2.12.x, `tauri-plugin-process` /
`@tauri-apps/plugin-process` 2.3.x). Upgrade Tauri deliberately, all together.
