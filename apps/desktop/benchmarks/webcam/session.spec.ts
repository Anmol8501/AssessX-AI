import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { DEV_CANDIDATE, signIn } from '../../e2e/helpers'
import { openDetails, seedExam, syntheticDevices, unique } from '../../e2e/proctoring-helpers'

/**
 * Guided real-webcam validation of the Phase 5B detectors.
 *
 * The participant follows on-screen instructions (a panel over the exam). For each step the harness
 * collects the AI observations produced during that step and summarises them as numbers. **No frame,
 * image or video is captured or stored** — only the detectors' numeric outputs, written to the
 * git-ignored benchmarks/.cache/webcam/. Items the participant does not have can be skipped.
 */

interface Obs {
  observationId: string
  observationType: string
  monotonicTs: number
  confidence: number | null
  metadata: Record<string, string | number | boolean>
}
interface Step {
  id: string
  text: string
  seconds: number
  kind: 'face' | 'phone' | 'negative' | 'quality' | 'absent'
}

const STEPS: Step[] = [
  { id: 'baseline', text: 'Sit normally and look at the screen.', seconds: 8, kind: 'face' },
  { id: 'head-left', text: 'Slowly turn your HEAD to your LEFT, hold, then come back.', seconds: 6, kind: 'face' },
  { id: 'head-right', text: 'Slowly turn your HEAD to your RIGHT, hold, then come back.', seconds: 6, kind: 'face' },
  { id: 'head-up', text: 'Tilt your HEAD UP, hold, then come back.', seconds: 6, kind: 'face' },
  { id: 'head-down', text: 'Tilt your HEAD DOWN, hold, then come back.', seconds: 6, kind: 'face' },
  { id: 'eyes-left', text: 'Keep your head still. Look at the LEFT edge of the screen with your EYES only.', seconds: 6, kind: 'face' },
  { id: 'eyes-right', text: 'Keep your head still. Look at the RIGHT edge of the screen with your EYES only.', seconds: 6, kind: 'face' },
  { id: 'absent', text: 'Move completely OUT of the camera view.', seconds: 6, kind: 'absent' },
  { id: 'phone-screen-near', text: 'Hold your PHONE up near your face, SCREEN facing the camera.', seconds: 8, kind: 'phone' },
  { id: 'phone-back-near', text: 'Hold your PHONE up, BACK facing the camera.', seconds: 8, kind: 'phone' },
  { id: 'phone-landscape', text: 'Hold your PHONE sideways (landscape), facing the camera.', seconds: 8, kind: 'phone' },
  { id: 'phone-far', text: 'Hold your PHONE at arm’s length, visible to the camera.', seconds: 8, kind: 'phone' },
  { id: 'phone-partial', text: 'Hold your PHONE half out of view, at the edge of the camera picture.', seconds: 8, kind: 'phone' },
  { id: 'phone-in-hand-low', text: 'Hold your PHONE in your hand at chest height, as if reading it.', seconds: 8, kind: 'phone' },
  { id: 'neg-hands', text: 'Show both EMPTY HANDS to the camera (no phone).', seconds: 8, kind: 'negative' },
  { id: 'neg-book', text: 'Hold up a BOOK or notebook (no phone). Skip if you have none.', seconds: 8, kind: 'negative' },
  { id: 'neg-headphones', text: 'Hold up HEADPHONES or earphones (no phone). Skip if you have none.', seconds: 8, kind: 'negative' },
  { id: 'neg-calculator', text: 'Hold up a CALCULATOR (no phone). Skip if you have none.', seconds: 8, kind: 'negative' },
  { id: 'neg-remote', text: 'Hold up a TV REMOTE (no phone). Skip if you have none.', seconds: 8, kind: 'negative' },
  { id: 'neg-mug', text: 'Hold up a MUG, cup or bottle (no phone).', seconds: 8, kind: 'negative' },
  { id: 'quality-cover', text: 'Cover the camera lens with your hand (quality check).', seconds: 6, kind: 'quality' },
  { id: 'quality-normal', text: 'Uncover the camera and sit normally again.', seconds: 6, kind: 'quality' },
]

const synthetic = process.env.SESSION_CAMERA === 'synthetic'

async function installPanel(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __session: { setStep(title: string, text: string, seconds: number): void; skipped: boolean; done(text: string): void }
      __probe: { workersCreated: number; workersTerminated: number; longTasks: number[] }
      __assessxAI?: { state?: { health: { state: string; reason: string | null }; recentObservations: Obs[] } }
    }
    const probe = { workersCreated: 0, workersTerminated: 0, longTasks: [] as number[] }
    w.__probe = probe
    const Original = window.Worker
    window.Worker = class extends Original {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        probe.workersCreated++
      }
      override terminate() {
        probe.workersTerminated++
        super.terminate()
      }
    }
    new PerformanceObserver((list) => list.getEntries().forEach((e) => probe.longTasks.push(e.duration))).observe({ type: 'longtask', buffered: true })

    let panel: HTMLDivElement | null = null
    let timer = 0
    const ensure = () => {
      if (panel && document.body.contains(panel)) return panel
      panel = document.createElement('div')
      panel.style.cssText =
        'position:fixed;right:16px;bottom:16px;width:430px;z-index:2147483647;background:#111827;color:#f9fafb;font:14px system-ui;padding:14px 16px;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.4)'
      panel.innerHTML =
        '<div style="font-size:11px;letter-spacing:.08em;color:#9ca3af">AI VALIDATION SESSION — no images are recorded</div><div id="s-title" style="font-weight:600;margin:6px 0 2px"></div><div id="s-text" style="font-size:18px;line-height:1.35"></div><div id="s-count" style="font-size:28px;font-weight:700;margin:6px 0"></div><div id="s-live" style="font:12px ui-monospace,monospace;color:#d1d5db;white-space:pre"></div><button id="s-skip" style="margin-top:8px;padding:6px 10px;border-radius:6px;border:0;background:#374151;color:#fff;cursor:pointer">Skip — I don’t have this item</button>'
      document.body.appendChild(panel)
      panel.querySelector('#s-skip')!.addEventListener('click', () => {
        w.__session.skipped = true
        ;(panel!.querySelector('#s-skip') as HTMLButtonElement).textContent = 'Skipped'
      })
      return panel
    }
    const live = () => {
      const state = w.__assessxAI?.state
      if (!state || !panel) return
      const last: Record<string, Obs> = {}
      for (const o of state.recentObservations) last[o.observationType] = o
      const f = (v: unknown, d = 1) => (typeof v === 'number' ? v.toFixed(d) : '—')
      const pose = last.HEAD_POSE?.metadata
      const gaze = last.GAZE?.metadata
      ;(panel.querySelector('#s-live') as HTMLDivElement).textContent =
        `AI: ${state.health.state}${state.health.reason ? ` (${state.health.reason})` : ''}\n` +
        `faces: ${last.FACE_PRESENCE?.metadata.faceCount ?? '—'}   track: ${last.FACE_TRACK?.metadata.trackId ?? '—'}\n` +
        `yaw ${f(pose?.yawDeg)}  pitch ${f(pose?.pitchDeg)}  roll ${f(pose?.rollDeg)}\n` +
        `gaze h ${f(gaze?.gazeHorizontal, 2)}  v ${f(gaze?.gazeVertical, 2)}\n` +
        `phone confidence ${f(last.OBJECT_DETECTION?.confidence, 3)}   luminance ${f(last.FRAME_QUALITY?.metadata.meanLuminance, 2)}`
    }
    setInterval(live, 250)
    w.__session = {
      skipped: false,
      setStep(title, text, seconds) {
        const p = ensure()
        w.__session.skipped = false
        ;(p.querySelector('#s-skip') as HTMLButtonElement).textContent = 'Skip — I don’t have this item'
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

function summarise(values: number[]) {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]!
  const r = (v: number) => Math.round(v * 1000) / 1000
  return { n: s.length, min: r(s[0]!), median: r(q(0.5)), p90: r(q(0.9)), max: r(s[s.length - 1]!) }
}

test('guided real-webcam validation of the AI detectors', async ({ browser, request }) => {
  const title = unique('AI Webcam Validation')
  await seedExam(request, title, true, 60)
  const context = await browser.newContext({ permissions: ['camera', 'microphone'] })
  const page = await context.newPage()
  if (synthetic) await syntheticDevices(page)
  await installPanel(page)
  await page.addInitScript(() => {
    ;(window as unknown as { __assessxAI: unknown }).__assessxAI = { config: { inferenceIntervalMs: 250 } }
  })
  if (synthetic) {
    const portrait = `data:image/jpeg;base64,${readFileSync('e2e/.cache/portrait.jpg').toString('base64')}`
    await page.addInitScript((src) => {
      const media = window as unknown as { __media: { streams: MediaStream[] } }
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      navigator.mediaDevices.getUserMedia = async (c?: MediaStreamConstraints) => {
        if (!c?.video) return original(c)
        const canvas = document.createElement('canvas')
        canvas.width = 640
        canvas.height = 480
        const ctx = canvas.getContext('2d')!
        const img = new Image()
        img.src = src
        await img.decode()
        const draw = () => ctx.drawImage(img, 120, 0, 400, 480)
        draw()
        setInterval(draw, 100)
        const stream = canvas.captureStream(10)
        media.__media.streams.push(stream)
        return stream
      }
    }, portrait)
  }
  await page.goto('/')
  await signIn(page, request, DEV_CANDIDATE)
  await openDetails(page, title)
  await page.getByRole('button', { name: 'Start Exam' }).click()
  await page.getByRole('button', { name: 'Start Exam' }).click()
  await expect(page.getByRole('banner').getByText(/^Question \d+ of \d+$/)).toBeVisible()
  await expect(page.getByRole('status', { name: /AI monitoring: (active|limited)/ })).toBeVisible({ timeout: 90_000 })

  const seen = new Map<string, Obs>()
  const collect = async () => {
    const obs = await page.evaluate(
      () => (window as unknown as { __assessxAI?: { state?: { recentObservations: Obs[] } } }).__assessxAI?.state?.recentObservations ?? [],
    )
    for (const o of obs) seen.set(o.observationId, o)
  }
  const now = () => page.evaluate(() => performance.now())

  const report: Record<string, unknown> = {}
  for (const [index, step] of STEPS.entries()) {
    await page.evaluate(([t, s]) => (window as unknown as { __session: { setStep(a: string, b: string, c: number): void } }).__session.setStep(t, 'Get ready…', s), [`Step ${index + 1} of ${STEPS.length}`, 3] as const)
    await page.waitForTimeout(3_000)
    await page.evaluate(([t, x, s]) => (window as unknown as { __session: { setStep(a: string, b: string, c: number): void } }).__session.setStep(t, x, s), [`Step ${index + 1} of ${STEPS.length}`, step.text, step.seconds] as const)
    const start = await now()
    const end = start + step.seconds * 1000
    while ((await now()) < end) {
      await collect()
      await page.waitForTimeout(200)
    }
    await collect()
    const skipped = await page.evaluate(() => (window as unknown as { __session: { skipped: boolean } }).__session.skipped)
    const inStep = [...seen.values()].filter((o) => o.monotonicTs >= start && o.monotonicTs <= end)
    const of = (type: string) => inStep.filter((o) => o.observationType === type)
    const num = (list: Obs[], key: string) => list.map((o) => o.metadata[key]).filter((v): v is number => typeof v === 'number')
    report[step.id] = {
      kind: step.kind,
      instruction: step.text,
      skipped,
      frames: of('FACE_PRESENCE').length,
      faceCount: summarise(num(of('FACE_PRESENCE'), 'faceCount')),
      facePresentFraction: of('FACE_PRESENCE').length ? of('FACE_PRESENCE').filter((o) => o.metadata.facePresent === true).length / of('FACE_PRESENCE').length : null,
      trackIds: [...new Set(of('FACE_TRACK').map((o) => o.metadata.trackId))],
      yawDeg: summarise(num(of('HEAD_POSE'), 'yawDeg')),
      pitchDeg: summarise(num(of('HEAD_POSE'), 'pitchDeg')),
      rollDeg: summarise(num(of('HEAD_POSE'), 'rollDeg')),
      gazeHorizontal: summarise(num(of('GAZE'), 'gazeHorizontal')),
      gazeVertical: summarise(num(of('GAZE'), 'gazeVertical')),
      phoneConfidence: summarise(of('OBJECT_DETECTION').map((o) => o.confidence ?? 0)),
      meanLuminance: summarise(num(of('FRAME_QUALITY'), 'meanLuminance')),
    }
  }

  // Camera loss and return (the camera track ends as it does when a device is unplugged).
  await page.evaluate(() => (window as unknown as { __session: { setStep(a: string, b: string, c: number): void } }).__session.setStep('Camera check', 'Simulating a camera disconnect — please wait.', 15))
  const before = await page.evaluate(() => (window as unknown as { __probe: { workersCreated: number; workersTerminated: number } }).__probe)
  await page.evaluate(() => {
    const tracks: MediaStreamTrack[] = []
    document.querySelectorAll('video').forEach((v) => {
      const s = v.srcObject
      if (s instanceof MediaStream) tracks.push(...s.getVideoTracks())
    })
    tracks.find((t) => t.readyState === 'live')?.dispatchEvent(new Event('ended'))
  })
  await expect(page.getByRole('status', { name: 'AI monitoring: limited' })).toBeVisible({ timeout: 15_000 })
  const lossReason = await page.evaluate(() => (window as unknown as { __assessxAI?: { state?: { health: { reason: string | null } } } }).__assessxAI?.state?.health.reason)
  await page.getByRole('button', { name: 'Reconnect camera' }).click()
  await expect(page.getByRole('status', { name: /AI monitoring: (active|limited)/ })).toBeVisible({ timeout: 60_000 })
  await page.waitForTimeout(3_000)
  const afterReconnect = await page.evaluate(() => (window as unknown as { __assessxAI?: { state?: { health: { state: string } } } }).__assessxAI?.state?.health.state)
  const reconnect = await page.evaluate(() => (window as unknown as { __probe: { workersCreated: number; workersTerminated: number } }).__probe)

  await page.getByRole('banner').getByRole('button', { name: 'Submit Exam' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Submit Exam' }).click()
  await expect(page.getByRole('heading', { name: 'Exam submitted successfully.' })).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __assessxAI?: { state?: { health: { state: string } } } }).__assessxAI?.state?.health.state))
    .toBe('STOPPED')
  const final = await page.evaluate(() => (window as unknown as { __probe: { workersCreated: number; workersTerminated: number; longTasks: number[] } }).__probe)
  const telemetry = await page.evaluate(() => (window as unknown as { __assessxAI?: { state?: { telemetry: unknown } } }).__assessxAI?.state?.telemetry)
  await page.evaluate(() => (window as unknown as { __session: { done(t: string): void } }).__session.done('Thank you — the session is complete. The camera is now released.'))
  await page.waitForTimeout(2_000)

  const out = {
    when: new Date().toISOString(),
    camera: synthetic ? 'synthetic (portrait dry run)' : 'real webcam',
    steps: report,
    cameraLoss: { reasonShown: lossReason, stateAfterReconnect: afterReconnect },
    workers: { beforeLoss: before, afterReconnect: reconnect, afterSubmit: { created: final.workersCreated, terminated: final.workersTerminated } },
    longTasks: summarise(final.longTasks),
    telemetry,
  }
  const dir = join('benchmarks', '.cache', 'webcam')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `session-${synthetic ? 'synthetic' : 'webcam'}-${Date.now()}.json`)
  writeFileSync(file, JSON.stringify(out, null, 1))
  console.log(`[session] results written to ${file}`)
  await context.close() // releases the camera
})
