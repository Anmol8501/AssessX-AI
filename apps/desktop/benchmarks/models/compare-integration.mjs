// EfficientDet-Lite0 vs the app's integrated YOLOX-Tiny (both through the production AI worker), on
// exactly the same images → results/comparison-integration.md. Does not rewrite comparison.md or any
// earlier result. Engineering comparison only: no statistical accuracy is claimed, no threshold chosen.
//
// "Partial phone" proxy: a COCO image whose annotated phone box touches the image border (the phone
// is cut off by the frame). Descriptive counts at fixed cut-offs are NOT chosen thresholds.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dir = join(here, 'results')
const load = (name) => JSON.parse(readFileSync(join(dir, name), 'utf8'))

const effCpu = load('efficientdet-lite0.cpu.json')
const effGpu = load('efficientdet-lite0.gpu.json')
const yxCpu = load('yolox-tiny-app.wasm.json')
const yxGpu = load('yolox-tiny-app.webgpu.json')
const yxHarness = load('yolox-tiny.wasm.json') // the evaluation adapter, for parity

// Border-truncated phones (partial-phone proxy), from the COCO annotations.
const truncated = new Set()
const annotationsPath = join(here, '..', '.cache', 'coco', 'instances_val2017.json')
if (existsSync(annotationsPath)) {
  const coco = JSON.parse(readFileSync(annotationsPath, 'utf8'))
  const phoneId = coco.categories.find((c) => c.name === 'cell phone').id
  const images = new Map(coco.images.map((i) => [i.id, i]))
  for (const a of coco.annotations) {
    if (a.category_id !== phoneId || a.iscrowd) continue
    const im = images.get(a.image_id)
    const [x, y, w, h] = a.bbox
    if (x <= 2 || y <= 2 || x + w >= im.width - 2 || y + h >= im.height - 2) truncated.add(im.file_name)
  }
}

const q = (values, p) => {
  const s = [...values].sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] : null
}
const f3 = (v) => (v == null ? '—' : v.toFixed(3))
const auc = (pos, neg) => {
  let wins = 0
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0
  return pos.length && neg.length ? wins / (pos.length * neg.length) : null
}
const iou = (a, b) => {
  if (!a || !b) return null
  const w = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const h = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  const inter = w * h
  const union = a.width * a.height + b.width * b.height - inter
  return union > 0 ? inter / union : null
}

function quality(run) {
  const r = run.results
  const phones = r.filter((x) => x.label === 'phone')
  const large = phones.filter((x) => x.phoneAreaRatio >= 0.05)
  const partial = phones.filter((x) => truncated.has(x.image))
  const free = r.filter((x) => x.label === 'no-phone')
  const maxFree = Math.max(...free.map((x) => x.score))
  const s = (list) => list.map((x) => x.score)
  return { phones, large, partial, free, maxFree, s }
}

function drift(cpu, gpu) {
  const byImage = new Map(cpu.results.map((r) => [r.image, r]))
  const pairs = gpu.results.map((g) => [byImage.get(g.image), g]).filter(([c]) => c)
  const diffs = pairs.map(([c, g]) => Math.abs(c.score - g.score))
  const ious = pairs.map(([c, g]) => iou(c.box, g.box)).filter((v) => v !== null)
  const strong = pairs.filter(([c, g]) => Math.max(c.score, g.score) >= 0.5)
  const strongIous = strong.map(([c, g]) => iou(c.box, g.box)).filter((v) => v !== null)
  return {
    n: pairs.length,
    maxAbs: Math.max(...diffs),
    meanAbs: diffs.reduce((a, b) => a + b, 0) / diffs.length,
    boxIouMedian: q(ious, 0.5),
    boxIouBelow09: ious.filter((v) => v < 0.9).length,
    strongN: strong.length,
    strongIouMin: strongIous.length ? Math.min(...strongIous) : null,
  }
}

const models = [
  {
    name: 'EfficientDet-Lite0 (MediaPipe, default)',
    licence: 'Model **unresolved**; runtime Apache-2.0',
    size: '7.3 MB',
    input: '1×320×320×3 float32 (NHWC)',
    cpu: effCpu,
    gpu: effGpu,
    gpuLabel: 'MediaPipe GPU delegate',
    warmup: 'none (first inference is the cold one)',
  },
  {
    name: 'YOLOX-Tiny (ONNX Runtime Web, opt-in)',
    licence: 'Code Apache-2.0 (verified); weights not separately stated (unconfirmed); ORT MIT',
    size: '20.2 MB (+26.8 MB ORT WebAssembly)',
    input: '1×3×416×416 float32 (NCHW, BGR, 0..255, letterbox)',
    cpu: yxCpu,
    gpu: yxGpu,
    gpuLabel: 'ONNX Runtime WebGPU',
    warmup: null,
  },
]

const L = ['# EfficientDet-Lite0 vs integrated YOLOX-Tiny (engineering comparison)', '']
L.push('Both through the app\'s production AI worker, same 418 images (214 with a phone, 204 without). No threshold is chosen; cut-off columns are descriptive only.', '')
L.push('| | ' + models.map((m) => m.name).join(' | ') + ' |', '|---|' + models.map(() => '---').join('|') + '|')
const row = (label, fn) => L.push(`| ${label} | ${models.map(fn).join(' | ')} |`)
row('Licence', (m) => m.licence)
row('Model size', (m) => m.size)
row('Input', (m) => m.input)
row('CPU steady (median / p90)', (m) => `${m.cpu.steadyMedianMs} / ${m.cpu.steadyP90Ms} ms`)
row('GPU path', (m) => m.gpuLabel)
row('GPU steady (median / p90)', (m) => `${m.gpu.steadyMedianMs} / ${m.gpu.steadyP90Ms} ms`)
row('CPU cold start (load + first inference)', (m) => `${m.cpu.coldStartMs} ms`)
row('GPU cold start (load + first inference)', (m) => `${m.gpu.coldStartMs} ms`)
row('Warm-up (CPU / GPU)', (m) => {
  const c = m.cpu.objectBackend
  const g = m.gpu.objectBackend
  return c?.warmupMs != null ? `load ${Math.round(c.loadMs)} · warm-up ${Math.round(c.warmupMs)} · first ${Math.round(c.firstInferenceMs)} ms / load ${Math.round(g.loadMs)} · warm-up ${Math.round(g.warmupMs)} · first ${Math.round(g.firstInferenceMs)} ms` : m.warmup
})
for (const m of models) m.q = quality(m.cpu)
row('Separability AUC (all phones / large phones)', (m) => `${f3(auc(m.q.s(m.q.phones), m.q.s(m.q.free)))} / ${f3(auc(m.q.s(m.q.large), m.q.s(m.q.free)))}`)
row('Phone confidence: median · p90 · max', (m) => `${f3(q(m.q.s(m.q.phones), 0.5))} · ${f3(q(m.q.s(m.q.phones), 0.9))} · ${f3(Math.max(...m.q.s(m.q.phones)))}`)
row('Phone-free confidence: median · p90 · max', (m) => `${f3(q(m.q.s(m.q.free), 0.5))} · ${f3(q(m.q.s(m.q.free), 0.9))} · ${f3(m.q.maxFree)}`)
row('Large phones (≥5% of frame) above every phone-free image', (m) => `${m.q.large.filter((x) => x.score > m.q.maxFree).length}/${m.q.large.length}`)
row('Large phones at/above 0.5 (descriptive)', (m) => `${m.q.large.filter((x) => x.score >= 0.5).length}/${m.q.large.length}`)
row(`Partial phones (box cut by frame edge, n=${models[0].q.partial.length}): median · above every phone-free image`, (m) => `${f3(q(m.q.s(m.q.partial), 0.5))} · ${m.q.partial.filter((x) => x.score > m.q.maxFree).length}/${m.q.partial.length}`)
row('Phone-free images at/above 0.5 (descriptive)', (m) => `${m.q.free.filter((x) => x.score >= 0.5).length}/${m.q.free.length}`)
row('Highest-scoring phone-free images', (m) => [...m.q.free].sort((a, b) => b.score - a.score).slice(0, 4).map((x) => `${x.image.replace('.jpg', '')} (${x.group}) ${x.score.toFixed(2)}`).join('; '))
for (const m of models) m.d = drift(m.cpu, m.gpu)
row('CPU↔GPU score drift: max · mean |Δ| (images compared)', (m) => `${m.d.maxAbs.toExponential(2)} · ${m.d.meanAbs.toExponential(2)} (${m.d.n})`)
row('CPU↔GPU top box: median IoU · boxes with IoU < 0.9', (m) => (m.d.boxIouMedian == null ? 'not recorded (earlier run stored scores only)' : `${f3(m.d.boxIouMedian)} · ${m.d.boxIouBelow09}`))
row('…where either score ≥ 0.5: images · minimum IoU', (m) => (m.d.strongIouMin == null ? '—' : `${m.d.strongN} · ${f3(m.d.strongIouMin)}`))

// Production adapter vs evaluation adapter (same model, CPU): the integration must reproduce it.
const harness = new Map(yxHarness.results.map((r) => [r.image, r.score]))
const parity = yxCpu.results.map((r) => Math.abs(r.score - harness.get(r.image)))
L.push('', `Integrated YOLOX-Tiny vs the evaluation harness adapter (CPU, ${parity.length} images): max |Δscore| ${Math.max(...parity).toFixed(4)}, mean ${(parity.reduce((a, b) => a + b, 0) / parity.length).toFixed(5)}.`)
L.push('', 'CPU = WebAssembly, single thread. "EfficientDet GPU" drift figures come from an 11-image parity sample; YOLOX drift uses all 418 images.')
writeFileSync(join(dir, 'comparison-integration.md'), L.join('\n') + '\n')
console.log(L.join('\n'))
