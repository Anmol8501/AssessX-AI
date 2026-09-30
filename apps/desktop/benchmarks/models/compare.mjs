// Summarises benchmarks/models/results/*.json into results/comparison.md.
//
// Engineering comparison only — small, generic (COCO) dataset; no statistical accuracy is claimed.
// "Separability" is the ROC AUC between phone images and phone-free images: the probability that a
// random phone image scores higher than a random phone-free one (0.5 = no better than chance). It is
// threshold-free. Counts at fixed cut-offs are descriptive only — none of them is a chosen threshold.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = join(dirname(fileURLToPath(import.meta.url)), 'results')
const runs = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))

function auc(pos, neg) {
  if (!pos.length || !neg.length) return null
  let wins = 0
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0
  return wins / (pos.length * neg.length)
}
const med = (v) => (v.length ? [...v].sort((a, b) => a - b)[Math.floor((v.length - 1) / 2)] : null)
const f3 = (v) => (v == null ? '—' : v.toFixed(3))
const ms = (v) => (v == null ? '—' : `${v}`)

const order = ['efficientdet-lite0', 'efficientdet-lite2', 'yolox-nano', 'yolox-tiny', 'yolox-s', 'dfine-n', 'dfine-s']
const ids = [...new Set(runs.map((r) => r.candidate))].sort((a, b) => order.indexOf(a) - order.indexOf(b))
const lines = ['# Object-detector comparison (engineering comparison — not an accuracy study)', '']

lines.push('## Phone separability (CPU, full dataset: 214 phone images, 204 phone-free)', '')
lines.push('| Model | AUC all phones | AUC phones ≥5% | median phone | median phone ≥5% | median phone-free | max phone-free | phones above every phone-free image | large phones above every phone-free image |')
lines.push('|---|---|---|---|---|---|---|---|---|')
const scored = {}
for (const id of ids) {
  const run = runs.find((r) => r.candidate === id && r.scoring === 'full dataset')
  if (!run) continue
  scored[id] = run
  const pos = run.results.filter((r) => r.label === 'phone')
  const big = pos.filter((r) => r.phoneAreaRatio >= 0.05)
  const neg = run.results.filter((r) => r.label === 'no-phone')
  const maxNeg = Math.max(...neg.map((r) => r.score))
  lines.push(
    `| ${id} | ${f3(auc(pos.map((r) => r.score), neg.map((r) => r.score)))} | ${f3(auc(big.map((r) => r.score), neg.map((r) => r.score)))} | ${f3(med(pos.map((r) => r.score)))} | ${f3(med(big.map((r) => r.score)))} | ${f3(med(neg.map((r) => r.score)))} | ${f3(maxNeg)} | ${pos.filter((r) => r.score > maxNeg).length}/${pos.length} | ${big.filter((r) => r.score > maxNeg).length}/${big.length} |`,
  )
}

lines.push('', '## Descriptive counts at fixed cut-offs (NOT chosen thresholds)', '')
lines.push('| Model | cut-off | phones at/above (TP) | phones below (FN) | large phones at/above | phone-free at/above (FP) | FP by group |')
lines.push('|---|---|---|---|---|---|---|')
for (const [id, run] of Object.entries(scored)) {
  const pos = run.results.filter((r) => r.label === 'phone')
  const big = pos.filter((r) => r.phoneAreaRatio >= 0.05)
  const neg = run.results.filter((r) => r.label === 'no-phone')
  for (const t of [0.3, 0.5, 0.7]) {
    const fp = neg.filter((r) => r.score >= t)
    const groups = Object.entries(fp.reduce((a, r) => ((a[r.group] = (a[r.group] ?? 0) + 1), a), {}))
      .map(([g, n]) => `${g} ${n}`)
      .join(', ')
    lines.push(`| ${id} | ${t} | ${pos.filter((r) => r.score >= t).length} | ${pos.filter((r) => r.score < t).length} | ${big.filter((r) => r.score >= t).length}/${big.length} | ${fp.length} | ${groups || '—'} |`)
  }
}

lines.push('', '## Latency (single frame, ms) and size', '')
lines.push('| Model | size (MB) | CPU cold start | CPU steady median (p90) | GPU path | GPU cold start | GPU steady median (p90) | CPU↔GPU max score diff (sample) |')
lines.push('|---|---|---|---|---|---|---|---|')
for (const id of ids) {
  const cpu = runs.find((r) => r.candidate === id && (r.ep === 'cpu' || r.ep === 'wasm'))
  const gpu = runs.find((r) => r.candidate === id && (r.ep === 'gpu' || r.ep === 'webgpu'))
  const base = cpu && !cpu.error ? Object.fromEntries(cpu.results.map((r) => [r.image, r.score])) : {}
  const diff = gpu?.results?.length ? Math.max(...gpu.results.map((r) => Math.abs(r.score - (base[r.image] ?? r.score)))) : null
  const size = (cpu?.modelBytes ?? gpu?.modelBytes ?? 0) / 1e6
  const gpuLabel = gpu?.error ? `error: ${gpu.error.slice(0, 60)}` : gpu?.unavailable ?? gpu?.accelerator ?? '—'
  lines.push(
    `| ${id} | ${size.toFixed(1)} | ${ms(cpu?.coldStartMs)} | ${ms(cpu?.steadyMedianMs)} (${ms(cpu?.steadyP90Ms)}) | ${gpuLabel} | ${ms(gpu?.coldStartMs)} | ${ms(gpu?.steadyMedianMs)} (${ms(gpu?.steadyP90Ms)}) | ${diff == null ? '—' : diff.toFixed(4)} |`,
  )
}
lines.push('', 'CPU = WebAssembly, single thread (the app’s WebView is not cross-origin isolated). Cold start = model load + first inference in a freshly launched browser.')
writeFileSync(join(dir, 'comparison.md'), lines.join('\n') + '\n')
console.log(lines.join('\n'))
