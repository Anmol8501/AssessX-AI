#!/usr/bin/env node
/**
 * Checks the built desktop bundle (dist/) before it can become an installer (Phase 8B).
 *
 * Fails the build when the JavaScript that ships contains:
 *   * a test hook (`__assessxAI`, `__assessxReadiness`) or a test-only runtime (BX-06) — they must be
 *     compiled out of production builds;
 *   * a local API address (BX-11) — a release must not talk to localhost;
 *   * anything shaped like a secret (database URL with credentials, private key, provider key) — the
 *     desktop app must never contain one.
 *
 * Runs automatically after `npm run build` (postbuild), which `tauri build` and the release build use.
 * A development build (`vite build --mode development`) is not checked.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const app = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = process.argv[2] ? join(app, process.argv[2]) : join(app, 'dist')

if (process.env.ASSESSX_ALLOW_INSECURE_API === '1') {
  console.log('[bundle-check] skipped: ASSESSX_ALLOW_INSECURE_API=1 (a deliberate local build)')
  process.exit(0)
}

const FORBIDDEN = [
  { name: 'AI test hook', pattern: /__assessxAI/ },
  { name: 'device-check test hook', pattern: /__assessxReadiness/ },
  { name: 'scripted test runtime', pattern: /scripted-mediapipe/ },
  { name: 'mock AI runtime', pattern: /mock-heartbeat/ },
  { name: 'local API address', pattern: /https?:\/\/(127\.0\.0\.1|localhost):8000/ },
  { name: 'database URL with credentials', pattern: /postgres(ql)?(\+\w+)?:\/\/[^\s'"@/]+:[^\s'"@/]+@/ },
  { name: 'private key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'Anthropic key', pattern: /sk-ant-[A-Za-z0-9_-]{20,}/ },
]

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

const scripts = files(dist).filter((path) => /\.(m?js|html)$/.test(path) && !path.includes(`${join('dist', 'onnxruntime')}`) && !path.includes(join('dist', 'mediapipe')))
const problems = []
for (const path of scripts) {
  const text = readFileSync(path, 'utf8')
  for (const { name, pattern } of FORBIDDEN) {
    if (pattern.test(text)) problems.push(`${relative(app, path)}: ${name}`)
  }
}

if (problems.length > 0) {
  console.error('[bundle-check] the production bundle contains what it must not:\n  ' + problems.join('\n  '))
  process.exit(1)
}
console.log(`[bundle-check] ${scripts.length} files checked: no test hooks, local API addresses or secrets`)
