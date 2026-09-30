#!/usr/bin/env node
/**
 * Builds a signed AssessX release for in-app updates (see docs/RELEASING.md).
 *
 *   npm run release:build -- --notes "What changed in this version"
 *
 * 1. Signs the build with the release key: TAURI_SIGNING_PRIVATE_KEY if set, otherwise the key file
 *    at TAURI_SIGNING_PRIVATE_KEY_PATH, otherwise ~/.tauri/assessx-updater.key. The key never enters
 *    the repository; without it this script stops (a plain `npm run tauri:build` still works for
 *    local, unsigned builds).
 * 2. Runs `tauri build` with updater artifacts enabled, producing the installer and its `.sig`.
 * 3. Writes `latest.json` next to the installer. Installed apps read it from the latest GitHub
 *    Release to learn about the new version and verify the download.
 *
 * Then create the GitHub Release `v<version>` and upload the installer and `latest.json`.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = 'Anmol8501/AssessX-AI'
const app = join(dirname(fileURLToPath(import.meta.url)), '..')
const conf = JSON.parse(readFileSync(join(app, 'src-tauri', 'tauri.conf.json'), 'utf8'))
const version = conf.version
const product = conf.productName

const notesArg = process.argv.indexOf('--notes')
const notes = notesArg > -1 ? process.argv[notesArg + 1] : `${product} ${version}`

// 1. The signing key — from the environment or a file outside the repository.
if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
  const keyPath = process.env.TAURI_SIGNING_PRIVATE_KEY_PATH || join(homedir(), '.tauri', 'assessx-updater.key')
  if (!existsSync(keyPath)) {
    console.error(`No release signing key: set TAURI_SIGNING_PRIVATE_KEY, or put the key at ${keyPath}.`)
    process.exit(1)
  }
  process.env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(keyPath, 'utf8').trim()
}
process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= ''

// 2. Build with updater artifacts (a config override, so ordinary builds need no key).
const override = join(tmpdir(), `assessx-release-${process.pid}.json`)
writeFileSync(override, JSON.stringify({ bundle: { createUpdaterArtifacts: true } }))
const build = spawnSync('npx', ['tauri', 'build', '--config', override], { cwd: app, stdio: 'inherit', shell: true })
if (build.status !== 0) process.exit(build.status ?? 1)

// 3. latest.json for the updater.
const installer = `${product}_${version}_x64-setup.exe`
const nsis = join(app, 'src-tauri', 'target', 'release', 'bundle', 'nsis')
const signaturePath = join(nsis, `${installer}.sig`)
if (!existsSync(signaturePath)) {
  console.error(`Expected ${signaturePath} — was the build signed?`)
  process.exit(1)
}
const signature = readFileSync(signaturePath, 'utf8').trim()
const url = `https://github.com/${REPO}/releases/download/v${version}/${installer}`
const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64-nsis': { signature, url },
    'windows-x86_64': { signature, url },
  },
}
const manifestPath = join(nsis, 'latest.json')
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')

console.log(`
Release ${version} is ready. Publish it on GitHub:
  1. https://github.com/${REPO}/releases/new  →  tag: v${version}  (target: main)
  2. Upload these two files:
       ${join(nsis, installer)}
       ${manifestPath}
  3. Publish as the latest release (not a pre-release).
Installed apps (0.1.1 or later) will then offer this update the next time they open.`)
