import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { DEV_CANDIDATE, signIn } from '../../e2e/helpers'
import { examDetail, openDetails, recordedEvents, seedExam, syntheticDevices, unique } from '../../e2e/proctoring-helpers'
import { OBJECT_THRESHOLDS } from '../../src/features/proctoring/ai/events/config'

/**
 * Guided object-detection calibration (2026-10-02). Not part of the automated suite.
 *
 *   npm run calibrate:objects                         # YOLOX-S on WebGPU (or the device's fallback)
 *   SESSION_OBJECT_MODEL=yolox_tiny npm run calibrate:objects   # the CPU fallback model
 *
 * A visible Edge window opens the real exam on the real camera, and a panel walks the participant
 * through each step: the objects to show (a phone near, far, small, partly visible, on the desk; a
 * book; another laptop or tablet; a calculator or remote) and look-alikes that must NOT count (empty
 * hands, a mug, headphones). For each step it records, per object class, the model's confidence on
 * every processed frame and which object events the real event processor actually raised.
 *
 * **No frame, image or video is captured or stored** — only numbers, written to the git-ignored
 * benchmarks/.cache/webcam/. At the end it suggests per-class thresholds (the lowest value above
 * every look-alike frame, plus a margin) and the share of object frames each would catch. Applying a
 * suggestion is a deliberate edit to `OBJECT_THRESHOLDS` in src/features/proctoring/ai/events/config.ts.
 */

type ObjectClass = 'cell_phone' | 'book' | 'laptop' | 'remote'
const CLASSES: ObjectClass[] = ['cell_phone', 'book', 'laptop', 'remote']
const EVENT: Record<ObjectClass, string> = {
  cell_phone: 'PHONE_DETECTED',
  book: 'BOOK_DETECTED',
  laptop: 'LAPTOP_DETECTED',
  remote: 'HANDHELD_DEVICE_DETECTED',
}

interface Step {
  id: string
  text: string
  seconds: number
  /** The class this step shows, or null for a look-alike / empty step (every class should stay quiet). */
  target: ObjectClass | null
}

const STEPS: Step[] = [
  { id: 'none', text: 'Sit normally and look at the screen. Nothing in your hands.', seconds: 10, target: null },
  { id: 'hands', text: 'Show both EMPTY HANDS to the camera, move them around.', seconds: 10, target: null },
  { id: 'phone-near', text: 'Hold your PHONE near your face, SCREEN facing the camera.', seconds: 10, target: 'cell_phone' },
  { id: 'phone-back', text: 'Hold your PHONE up with its BACK facing the camera.', seconds: 10, target: 'cell_phone' },
  { id: 'phone-ear', text: 'Hold your PHONE to your EAR as if on a call.', seconds: 10, target: 'cell_phone' },
  { id: 'phone-low', text: 'Hold your PHONE low, at chest or lap height, as if reading it.', seconds: 10, target: 'cell_phone' },
  { id: 'phone-far', text: 'Hold your PHONE at ARM’S LENGTH, to one side.', seconds: 10, target: 'cell_phone' },
  { id: 'phone-small', text: 'Put your PHONE as FAR from the camera as you can while still in view (small in the picture).', seconds: 12, target: 'cell_phone' },
  { id: 'phone-partial', text: 'Hold your PHONE HALF out of view, at the edge of the picture.', seconds: 10, target: 'cell_phone' },
  { id: 'phone-desk', text: 'Lay your PHONE flat on the desk where the camera can see it. Skip if the desk is out of view.', seconds: 10, target: 'cell_phone' },
  { id: 'book', text: 'Hold up a BOOK or notebook, open or closed. Skip if you have none.', seconds: 10, target: 'book' },
  { id: 'book-desk', text: 'Put the BOOK on the desk in view. Skip if the desk is out of view or you have none.', seconds: 10, target: 'book' },
  { id: 'laptop', text: 'Show ANOTHER LAPTOP or a TABLET to the camera. Skip if you have none.', seconds: 10, target: 'laptop' },
  { id: 'remote', text: 'Hold up a CALCULATOR or a TV REMOTE. Skip if you have none.', seconds: 10, target: 'remote' },
  { id: 'mug', text: 'Hold up a MUG, cup or bottle (not a target).', seconds: 10, target: null },
  { id: 'headphones', text: 'Hold up HEADPHONES or earphones (not a target). Skip if you have none.', seconds: 10, target: null },
  { id: 'paper', text: 'Hold up a sheet of PAPER (not a target). Skip if you have none.', seconds: 10, target: null },
  { id: 'none-end', text: 'Put everything away and sit normally.', seconds: 10, target: null },
]

const synthetic = process.env.SESSION_CAMERA === 'synthetic'
const objectModel = process.env.SESSION_OBJECT_MODEL || undefined

interface Obs {
  observationId: string
  observationType: string
  monotonicTs: number
  confidence: number | null
  metadata: Record<string, string | number | boolean>
}

async function installPanel(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __session: { setStep(title: string, text: string, seconds: number): void; skipped: boolean; done(text: string): void }
      __assessxAI?: { state?: { health: { state: string }; recentObservations: Obs[] } }
    }
    let panel: HTMLDivElement | null = null
    let timer = 0
    const ensure = () => {
      if (panel && document.body.contains(panel)) return panel
      panel = document.createElement('div')
      panel.style.cssText =
        'position:fixed;right:16px;bottom:16px;width:440px;z-index:2147483647;background:#111827;color:#f9fafb;font:14px system-ui;padding:14px 16px;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.4)'
      panel.innerHTML =
        '<div style="font-size:11px;letter-spacing:.08em;color:#9ca3af">OBJECT CALIBRATION — no images are recorded</div><div id="s-title" style="font-weight:600;margin:6px 0 2px"></div><div id="s-text" style="font-size:18px;line-height:1.35"></div><div id="s-count" style="font-size:28px;font-weight:700;margin:6px 0"></div><div id="s-live" style="font:12px ui-monospace,monospace;color:#d1d5db;white-space:pre"></div><button id="s-skip" style="margin-top:8px;padding:6px 10px;border-radius:6px;border:0;background:#374151;color:#fff;cursor:pointer">Skip — I don’t have this</button>'
      document.body.appendChild(panel)
      panel.querySelector('#s-skip')!.addEventListener('click', () => {
        w.__session.skipped = true
        ;(panel!.querySelector('#s-skip') as HTMLButtonElement).textContent = 'Skipped'
      })
      return panel
    }
    setInterval(() => {
      const state = w.__assessxAI?.state
      if (!state || !panel) return
      const last: Record<string, Obs> = {}
      for (const o of state.recentObservations) if (o.observationType === 'OBJECT_DETECTION') last[String(o.metadata.objectClass)] = o
      const f = (o: Obs | undefined) => (o?.confidence != null ? o.confidence.toFixed(2) : ' — ')
      ;(panel.querySelector('#s-live') as HTMLDivElement).textContent =
        `AI: ${state.health.state}   model: ${last.cell_phone?.metadata.objectModel ?? '—'}\n` +
        `phone ${f(last.cell_phone)}  book ${f(last.book)}  laptop ${f(last.laptop)}  remote ${f(last.remote)}`
    }, 250)
    w.__session = {
      skipped: false,
      setStep(title, text, seconds) {
        const p = ensure()
        w.__session.skipped = false
        ;(p.querySelector('#s-skip') as HTMLButtonElement).textContent = 'Skip — I don’t have this'
        ;(p.querySelector('#s-title') as HTMLDivElement).textContent = title
        ;(p.querySelector('#s-text') as HTMLDivElement).textContent = text
        let left = seconds
        const count = p.querySelector('#s-count') as HTMLDivElement
        window.clearInterval(timer)
        count.textContent = `${left}s`
        timer = window.setInterval(() => {
          left = Math.max(0, left - 1)
          count.textContent = `${left}s`
        }, 1000)
      },
      done(text) {
        const p = ensure()
        window.clearInterval(timer)
        ;(p.querySelector('#s-title') as HTMLDivElement).textContent = 'Finished'
        ;(p.querySelector('#s-text') as HTMLDivElement).textContent = text
        ;(p.querySelector('#s-count') as HTMLDivElement).textContent = ''
      },
    }
  })
}

const round = (v: number) => Math.round(v * 1000) / 1000

function summarise(values: number[]) {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]!
  return { n: s.length, median: round(q(0.5)), p90: round(q(0.9)), max: round(s[s.length - 1]!) }
}

test('guided object-detection calibration', async ({ browser, request }) => {
  test.setTimeout(30 * 60_000)
  const title = unique('Object Calibration')
  const exam = await seedExam(request, title, true, 60)
  const context = await browser.newContext({ permissions: ['camera', 'microphone'] })
  const page = await context.newPage()
  if (synthetic) await syntheticDevices(page)
  await installPanel(page)
  await page.addInitScript((model) => {
    ;(window as unknown as { __assessxAI: unknown }).__assessxAI = model ? { objectModel: model } : {}
  }, objectModel)
  await page.goto('/')
  await signIn(page, request, DEV_CANDIDATE)
  await openDetails(page, title)
  await page.getByRole('button', { name: 'Start Exam' }).click()
  await page.getByRole('button', { name: 'Start Exam' }).click()
  await expect(page.getByRole('banner').getByText(/^Question \d+ of \d+$/)).toBeVisible()
  await expect(page.getByRole('status', { name: /AI monitoring: (active|limited)/ })).toBeVisible({ timeout: 120_000 })
  const attemptId = (await examDetail(request, exam.id)).active_attempt_id!

  const seen = new Map<string, Obs>()
  const collect = async () => {
    const obs = await page.evaluate(() => (window as unknown as { __assessxAI?: { state?: { recentObservations: Obs[] } } }).__assessxAI?.state?.recentObservations ?? [])
    for (const o of obs) if (o.observationType === 'OBJECT_DETECTION') seen.set(o.observationId, o)
  }
  const now = () => page.evaluate(() => performance.now())
  const startedEpisodes = async () => {
    const events = await recordedEvents(request, attemptId, { ai: true })
    return events.filter((e) => Object.values(EVENT).includes(e.event_type) && e.metadata.phase === 'started').map((e) => e.event_type)
  }

  const steps: Record<string, unknown>[] = []
  const frames: { step: Step; cls: ObjectClass; confidence: number; model: string; region: string }[] = []
  let model = '—'
  for (const [index, step] of STEPS.entries()) {
    const label = `Step ${index + 1} of ${STEPS.length}`
    await page.evaluate(([t, s]) => (window as unknown as { __session: { setStep(a: string, b: string, c: number): void } }).__session.setStep(t, 'Get ready…', s), [label, 4] as const)
    await page.waitForTimeout(4_000)
    await page.evaluate(([t, x, s]) => (window as unknown as { __session: { setStep(a: string, b: string, c: number): void } }).__session.setStep(t, x, s), [label, step.text, step.seconds] as const)
    const before = await startedEpisodes()
    const start = await now()
    const end = start + step.seconds * 1000
    while ((await now()) < end) {
      await collect()
      await page.waitForTimeout(150)
    }
    await collect()
    await page.waitForTimeout(1500) // let a just-confirmed episode reach the server
    const after = await startedEpisodes()
    const skipped = await page.evaluate(() => (window as unknown as { __session: { skipped: boolean } }).__session.skipped)
    const inStep = [...seen.values()].filter((o) => o.monotonicTs >= start && o.monotonicTs <= end)
    const perClass: Record<string, unknown> = {}
    for (const cls of CLASSES) {
      const list = inStep.filter((o) => o.metadata.objectClass === cls)
      const m = String(list[0]?.metadata.objectModel ?? model)
      if (list.length) model = m
      const threshold = OBJECT_THRESHOLDS[m as keyof typeof OBJECT_THRESHOLDS]?.[cls]
      const values = list.map((o) => o.confidence ?? 0)
      if (!skipped) for (const o of list) frames.push({ step, cls, confidence: o.confidence ?? 0, model: m, region: String(o.metadata.region ?? '') })
      perClass[cls] = {
        confidence: summarise(values),
        threshold: threshold ?? null,
        framesAtOrAboveThreshold: threshold != null && values.length ? round(values.filter((v) => v >= threshold).length / values.length) : null,
        bestFromTile: list.some((o) => o.metadata.region === 'tile' && (o.confidence ?? 0) >= (threshold ?? 1)),
      }
    }
    const raised = after.slice(before.length)
    steps.push({ id: step.id, instruction: step.text, target: step.target, skipped, objectFrames: inStep.length / CLASSES.length, eventsRaised: raised, perClass })
  }

  // Suggested thresholds: just above every look-alike frame of that class (+0.05), and what share of
  // the class's own frames that would catch. Only from this one session — a starting point, not a proof.
  const suggestions: Record<string, unknown> = {}
  for (const cls of CLASSES) {
    const negatives = frames.filter((f) => f.cls === cls && f.step.target !== cls).map((f) => f.confidence)
    const positives = frames.filter((f) => f.cls === cls && f.step.target === cls).map((f) => f.confidence)
    const negMax = negatives.length ? Math.max(...negatives) : null
    const suggested = negMax === null ? null : round(Math.min(0.95, Math.max(0.2, negMax + 0.05)))
    suggestions[cls] = {
      current: OBJECT_THRESHOLDS[model as keyof typeof OBJECT_THRESHOLDS]?.[cls] ?? null,
      lookAlikeMax: negMax === null ? null : round(negMax),
      suggested,
      objectFramesCaught: suggested === null || positives.length === 0 ? null : round(positives.filter((v) => v >= suggested).length / positives.length),
      objectFrames: positives.length,
    }
  }

  const missed = steps.filter((s) => s.target && !s.skipped && !(s.eventsRaised as string[]).includes(EVENT[s.target as ObjectClass])).map((s) => s.id)
  const falseAlarms = steps.filter((s) => !s.skipped && (s.eventsRaised as string[]).some((e) => e !== (s.target ? EVENT[s.target as ObjectClass] : ''))).map((s) => `${s.id}: ${(s.eventsRaised as string[]).join(', ')}`)
  const telemetry = await page.evaluate(() => (window as unknown as { __assessxAI?: { state?: { telemetry: unknown } } }).__assessxAI?.state?.telemetry)

  const dir = join('benchmarks', '.cache', 'webcam')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const result = { at: new Date().toISOString(), model, synthetic, steps, suggestions, missed, falseAlarms, telemetry }
  writeFileSync(join(dir, `objects-${stamp}.json`), JSON.stringify(result, null, 2))
  const lines = [
    `# Object calibration — ${result.at}`,
    '',
    `Model: **${model}**${synthetic ? ' (synthetic camera — dry run)' : ''}. Numbers only; no images were recorded.`,
    '',
    '| Step | Target | Events raised | Phone max | Book max | Laptop max | Remote max |',
    '|---|---|---|---|---|---|---|',
    ...steps.map((s) => {
      const c = s.perClass as Record<string, { confidence: { max: number } | null }>
      const mx = (k: string) => c[k]?.confidence?.max ?? '—'
      return `| ${s.id}${s.skipped ? ' (skipped)' : ''} | ${s.target ?? '—'} | ${(s.eventsRaised as string[]).join(', ') || '—'} | ${mx('cell_phone')} | ${mx('book')} | ${mx('laptop')} | ${mx('remote')} |`
    }),
    '',
    '| Class | Current threshold | Look-alike max | Suggested | Object frames caught at suggested |',
    '|---|---|---|---|---|',
    ...CLASSES.map((cls) => {
      const s = suggestions[cls] as { current: number | null; lookAlikeMax: number | null; suggested: number | null; objectFramesCaught: number | null; objectFrames: number }
      return `| ${cls} | ${s.current ?? '—'} | ${s.lookAlikeMax ?? '—'} | ${s.suggested ?? '—'} | ${s.objectFramesCaught ?? '—'} (${s.objectFrames} frames) |`
    }),
    '',
    `Missed (no event in an object step): ${missed.join(', ') || 'none'}`,
    `False alarms (an event in the wrong step): ${falseAlarms.join('; ') || 'none'}`,
  ]
  writeFileSync(join(dir, `objects-${stamp}.md`), lines.join('\n') + '\n')
  console.log(lines.join('\n'))

  await page.evaluate(() => (window as unknown as { __session: { done(t: string): void } }).__session.done('Thank you — calibration complete. Results are in benchmarks/.cache/webcam/.'))
  await page.waitForTimeout(2_000)
  await context.close()
})
