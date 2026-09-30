import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { API_BASE_URL, apiToken, DEV_ADMIN, DEV_CANDIDATE, signIn } from '../../e2e/helpers'
import { examDetail, openDetails, seedExam, syntheticDevices, unique } from '../../e2e/proctoring-helpers'

/**
 * Guided real-webcam sanity check of the Phase 5C event timings and thresholds.
 *
 *   npx playwright test --config benchmarks/webcam/playwright.config.ts events-session
 *
 * Runs the production AI pipeline with the **shipped** debounce/threshold defaults and production
 * sampling rate, walks the participant through short scenarios, and records, per step, (a) which AI
 * events the server recorded and when, (b) the detectors' raw numbers, and (c) the candidate's
 * calibrated neutral head yaw and each step's deviation from it, so the provisional thresholds can be
 * compared with real measurements.
 *
 * Revision 2 (after the first session): head turns are measured from the candidate's own calibrated
 * neutral (18° deviation), looking down is not an event, GAZE_AWAY is disabled, FACE_NOT_DETECTED
 * needs 3 frames and FACE_TOO_FAR is 0.03. The step expectations below reflect that. **No frame, image or video is captured or
 * stored** — only numbers, written to the git-ignored benchmarks/.cache/webcam/.
 *
 * SESSION_CAMERA=synthetic dry-runs the harness (faceless synthetic camera, shortened steps).
 */

interface Obs {
  observationId: string
  observationType: string
  monotonicTs: number
  confidence: number | null
  metadata: Record<string, string | number | boolean>
}
interface Recorded {
  event_type: string
  category: string
  source: string
  metadata: Record<string, unknown>
  recorded_at: string
}
interface Step {
  id: string
  text: string
  seconds: number
  /** What the shipped settings are designed to produce in this step (for the summary only). */
  expect: string
}

const STEPS: Step[] = [
  { id: 'baseline', text: 'Sit normally and look at the screen, as if taking an exam.', seconds: 20, expect: 'no events' },
  { id: 'small-moves', text: 'Move naturally: shift in your seat, tilt your head a little, as people do while thinking.', seconds: 12, expect: 'no events (within 18° of your neutral)' },
  { id: 'glances', text: 'Glance quickly to the side and back (about 1 second) a few times.', seconds: 12, expect: 'no events (debounced)' },
  { id: 'head-left', text: 'Turn your HEAD clearly to your LEFT and HOLD it there.', seconds: 7, expect: 'HEAD_ORIENTATION_CHANGED left (> 18° from neutral, held ~3 s)' },
  { id: 'back-1', text: 'Look back at the screen normally.', seconds: 6, expect: 'head episode resolves' },
  { id: 'head-right', text: 'Turn your HEAD clearly to your RIGHT and HOLD it there.', seconds: 7, expect: 'HEAD_ORIENTATION_CHANGED right (> 18° from neutral, held ~3 s)' },
  { id: 'back-2', text: 'Look back at the screen normally.', seconds: 6, expect: 'head episode resolves' },
  { id: 'head-down', text: 'Look DOWN at your desk or keyboard, as if writing, and HOLD.', seconds: 7, expect: 'no event (looking down is not an event)' },
  { id: 'back-3', text: 'Look back at the screen normally.', seconds: 6, expect: 'no events' },
  { id: 'eyes-left', text: 'Keep your head still. Look at the far LEFT edge of the screen with your EYES only, and HOLD.', seconds: 8, expect: 'no event (GAZE_AWAY is disabled)' },
  { id: 'back-4', text: 'Look back at the screen normally.', seconds: 5, expect: 'no events' },
  { id: 'brief-leave', text: 'Duck out of the camera view for about ONE second, then come back.', seconds: 6, expect: 'no event (debounced)' },
  { id: 'leave', text: 'Move completely OUT of the camera view and stay out.', seconds: 9, expect: 'FACE_NOT_DETECTED starts (~3 s after leaving, 3 frames)' },
  { id: 'return', text: 'Come back and sit normally.', seconds: 6, expect: 'FACE_NOT_DETECTED resolves (~2 s)' },
  { id: 'lean-close', text: 'Lean in VERY CLOSE to the camera and hold.', seconds: 9, expect: 'FACE_TOO_CLOSE if face area > 0.35' },
  { id: 'back-5', text: 'Sit back normally.', seconds: 6, expect: 'resolves' },
  { id: 'lean-far', text: 'Move FAR back from the camera (stand up or push your chair back), still in view.', seconds: 9, expect: 'FACE_TOO_FAR if face area < 0.03' },
  { id: 'back-6', text: 'Sit normally again.', seconds: 6, expect: 'resolves' },
  { id: 'second-person', text: 'If someone else is available, have them lean into view beside you. Otherwise press Skip.', seconds: 8, expect: 'MULTIPLE_FACES_DETECTED starts (~2 s)' },
  { id: 'back-7', text: 'Just you, sitting normally.', seconds: 6, expect: 'resolves' },
  { id: 'cover', text: 'Cover the camera lens with your hand and hold.', seconds: 9, expect: 'CAMERA_TOO_DARK (~5 s) and/or FACE_NOT_DETECTED' },
  { id: 'final', text: 'Uncover the camera and sit normally.', seconds: 10, expect: 'everything resolves' },
]

const synthetic = process.env.SESSION_CAMERA === 'synthetic'
const scale = synthetic ? 0.25 : 1

type Win = Window & {
  __session: { setStep(title: string, text: string, seconds: number): void; setEvents(text: string): void; skipped: boolean; done(text: string): void }
  __assessxAI?: {
    state?: { health: { state: string; reason: string | null }; recentObservations: Obs[] }
    eventDiagnostics?: { headCalibration: { status: string; neutralYawDeg?: number; stableSamples?: number } }
  }
}

async function installPanel(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Win
    let panel: HTMLDivElement | null = null
    let timer = 0
    const ensure = () => {
      if (panel && document.body.contains(panel)) return panel
      panel = document.createElement('div')
      panel.style.cssText =
        'position:fixed;right:16px;bottom:16px;width:440px;z-index:2147483647;background:#111827;color:#f9fafb;font:14px system-ui;padding:14px 16px;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.4)'
      panel.innerHTML =
        '<div style="font-size:11px;letter-spacing:.08em;color:#9ca3af">AI EVENT TIMING CHECK — no images are recorded</div><div id="s-title" style="font-weight:600;margin:6px 0 2px"></div><div id="s-text" style="font-size:18px;line-height:1.35"></div><div id="s-count" style="font-size:28px;font-weight:700;margin:6px 0"></div><div id="s-live" style="font:12px ui-monospace,monospace;color:#d1d5db;white-space:pre"></div><div id="s-events" style="font:12px ui-monospace,monospace;color:#fcd34d;white-space:pre;margin-top:6px"></div><button id="s-skip" style="margin-top:8px;padding:6px 10px;border-radius:6px;border:0;background:#374151;color:#fff;cursor:pointer">Skip this step</button>'
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
      for (const o of state.recentObservations) last[o.observationType] = o
      const f = (v: unknown, d = 1) => (typeof v === 'number' ? v.toFixed(d) : '—')
      const pose = last.HEAD_POSE?.metadata
      const gaze = last.GAZE?.metadata
      const q = last.FRAME_QUALITY?.metadata
      const calibration = w.__assessxAI?.eventDiagnostics?.headCalibration
      const neutral = calibration?.status === 'calibrated' ? calibration.neutralYawDeg : undefined
      const deviation = typeof pose?.yawDeg === 'number' && neutral !== undefined ? pose.yawDeg - neutral : undefined
      ;(panel.querySelector('#s-live') as HTMLDivElement).textContent =
        `AI: ${state.health.state}${state.health.reason ? ` (${state.health.reason})` : ''}\n` +
        `faces ${last.FACE_PRESENCE?.metadata.faceCount ?? '—'}   yaw ${f(pose?.yawDeg)}  pitch ${f(pose?.pitchDeg)}\n` +
        `neutral yaw ${neutral !== undefined ? f(neutral) : `calibrating (${calibration?.stableSamples ?? 0}/5)`}   deviation ${f(deviation)}\n` +
        `gaze h ${f(gaze?.gazeHorizontal, 2)} v ${f(gaze?.gazeVertical, 2)}   lum ${f(q?.meanLuminance, 2)}  area ${f(q?.faceAreaRatio, 3)}`
    }, 250)
    w.__session = {
      skipped: false,
      setStep(title, text, seconds) {
        const p = ensure()
        w.__session.skipped = false
        ;(p.querySelector('#s-skip') as HTMLButtonElement).textContent = 'Skip this step'
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
      setEvents(text) {
        ;(ensure().querySelector('#s-events') as HTMLDivElement).textContent = text
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
  return { n: s.length, min: r(s[0]!), p10: r(q(0.1)), median: r(q(0.5)), p90: r(q(0.9)), max: r(s[s.length - 1]!) }
}

const short = (e: Recorded) => {
  const m = e.metadata
  if (e.event_type === 'AI_STATUS') return `AI_STATUS ${m.ai_status}${m.ai_reason && m.ai_reason !== 'none' ? `/${m.ai_reason}` : ''}`
  const detail = m.direction ? ` ${m.direction}` : m.face_count ? ` ×${m.face_count}` : ''
  const end = m.phase === 'resolved' ? ` ${m.resolution}${typeof m.duration_ms === 'number' ? ` ${(m.duration_ms / 1000).toFixed(1)}s` : ''}` : ''
  return `${e.event_type}${detail} ${m.phase}${end}`
}

test('guided real-webcam check of the Phase 5C event timings', async ({ browser, request }) => {
  test.setTimeout(20 * 60_000)
  const title = unique('AI Event Timing Check')
  const exam = await seedExam(request, title, true, 60)
  const context = await browser.newContext({ permissions: ['camera', 'microphone'] })
  const page = await context.newPage()
  if (synthetic) await syntheticDevices(page)
  await installPanel(page)
  // Production runtime, detectors, sampling interval and Phase 5C defaults: the seam only exposes state.
  await page.addInitScript(() => {
    ;(window as unknown as { __assessxAI: unknown }).__assessxAI = {}
  })
  await page.goto('/')
  await signIn(page, request, DEV_CANDIDATE)
  await openDetails(page, title)
  await page.getByRole('button', { name: 'Start Exam' }).click()
  await page.getByRole('button', { name: 'Start Exam' }).click()
  await expect(page.getByRole('banner').getByText(/^Question \d+ of \d+$/)).toBeVisible()
  await expect(page.getByRole('status', { name: /AI monitoring: (active|limited)/ })).toBeVisible({ timeout: 90_000 })
  const attemptId = (await examDetail(request, exam.id)).active_attempt_id!

  const admin = { Authorization: `Bearer ${await apiToken(request, DEV_ADMIN)}` }
  const aiEvents = async (): Promise<Recorded[]> => {
    const response = await request.get(`${API_BASE_URL}/api/v1/dev/attempts/${attemptId}/proctoring-events`, { headers: admin })
    const all = (await response.json()) as Recorded[]
    return all.filter((e) => e.category === 'AI_OBSERVATION' || e.category === 'AI_HEALTH')
  }

  const seen = new Map<string, Obs>()
  const collect = async () => {
    const obs = await page.evaluate(() => (window as unknown as Win).__assessxAI?.state?.recentObservations ?? [])
    for (const o of obs) seen.set(o.observationId, o)
  }
  const perfNow = () => page.evaluate(() => performance.now())
  const showEvents = async () => {
    const events = await aiEvents()
    await page.evaluate((t) => (window as unknown as Win).__session.setEvents(t), events.slice(-4).map(short).join('\n'))
  }

  // Let the AI settle (its first AI_STATUS is reported once health has held for 3 s).
  await page.evaluate(() => (window as unknown as Win).__session.setStep('Starting', 'Sit normally. The AI is starting…', 6))
  await page.waitForTimeout(6_000)

  const windows: { step: Step; wallStart: number; wallEnd: number; perfStart: number; perfEnd: number; skipped: boolean }[] = []
  for (const [index, step] of STEPS.entries()) {
    const label = `Step ${index + 1} of ${STEPS.length}`
    await page.evaluate(([t]) => (window as unknown as Win).__session.setStep(t, 'Get ready…', 3), [label] as const)
    await page.waitForTimeout(3_000)
    const seconds = Math.max(2, Math.round(step.seconds * scale))
    await page.evaluate(([t, x, s]) => (window as unknown as Win).__session.setStep(t, x, s), [label, step.text, seconds] as const)
    const wallStart = Date.now()
    const perfStart = await perfNow()
    let lastPoll = 0
    while ((await perfNow()) < perfStart + seconds * 1000) {
      await collect()
      if (Date.now() - lastPoll > 1000) {
        lastPoll = Date.now()
        await showEvents()
      }
      await page.waitForTimeout(200)
    }
    await collect()
    const skipped = await page.evaluate(() => (window as unknown as Win).__session.skipped)
    windows.push({ step, wallStart, wallEnd: Date.now(), perfStart, perfEnd: await perfNow(), skipped })
  }

  // Submitting closes any still-open episode on the server (session_ended).
  await page.evaluate(() => (window as unknown as Win).__session.setStep('Finishing', 'Submitting the exam — please wait.', 5))
  await page.getByRole('banner').getByRole('button', { name: 'Submit Exam' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Submit Exam' }).click()
  await expect(page.getByRole('heading', { name: 'Exam submitted successfully.' })).toBeVisible()
  const events = await aiEvents()
  const headCalibration = await page.evaluate(() => (window as unknown as Win).__assessxAI?.eventDiagnostics?.headCalibration ?? null)
  await page.evaluate(() => (window as unknown as Win).__session.done('Thank you — the check is complete. The camera is now released.'))
  await page.waitForTimeout(2_000)

  const steps = windows.map((w, i) => {
    const nextStart = windows[i + 1]?.wallStart ?? Number.POSITIVE_INFINITY
    // Events recorded from this step's start until the next step's start (incl. the "get ready" gap).
    const inWindow = events.filter((e) => {
      const t = Date.parse(e.recorded_at)
      return t >= w.wallStart && t < nextStart
    })
    const obs = [...seen.values()].filter((o) => o.monotonicTs >= w.perfStart && o.monotonicTs <= w.perfEnd)
    const of = (type: string) => obs.filter((o) => o.observationType === type)
    const num = (list: Obs[], key: string) => list.map((o) => o.metadata[key]).filter((v): v is number => typeof v === 'number')
    const neutral = headCalibration?.status === 'calibrated' ? headCalibration.neutralYawDeg : undefined
    return {
      id: w.step.id,
      instruction: w.step.text,
      designedToProduce: w.step.expect,
      skipped: w.skipped,
      events: inWindow.map((e) => ({ at_s: Math.round((Date.parse(e.recorded_at) - w.wallStart) / 100) / 10, event: short(e) })),
      frames: of('FACE_PRESENCE').length,
      faceCount: summarise(num(of('FACE_PRESENCE'), 'faceCount')),
      yawDeg: summarise(num(of('HEAD_POSE'), 'yawDeg')),
      yawDeviationFromNeutralDeg: neutral === undefined ? null : summarise(num(of('HEAD_POSE'), 'yawDeg').map((y) => y - neutral)),
      pitchDeg: summarise(num(of('HEAD_POSE'), 'pitchDeg')),
      gazeHorizontal: summarise(num(of('GAZE'), 'gazeHorizontal')),
      gazeVertical: summarise(num(of('GAZE'), 'gazeVertical')),
      meanLuminance: summarise(num(of('FRAME_QUALITY'), 'meanLuminance')),
      faceAreaRatio: summarise(num(of('FRAME_QUALITY'), 'faceAreaRatio')),
    }
  })

  const out = {
    when: new Date().toISOString(),
    camera: synthetic ? 'synthetic (dry run)' : 'real webcam',
    settings: 'shipped DEFAULT_AI_EVENT_CONFIG and DEFAULT_AI_CONFIG (500 ms sampling)',
    headCalibration,
    steps,
    allEvents: events.map((e) => ({ at: e.recorded_at, source: e.source, event: short(e) })),
  }
  const dir = join('benchmarks', '.cache', 'webcam')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `events-session-${synthetic ? 'synthetic' : 'webcam'}-${Date.now()}.json`)
  writeFileSync(file, JSON.stringify(out, null, 1))
  console.log(`[session] results written to ${file}`)
  console.log(`[session] head calibration: ${JSON.stringify(headCalibration)}`)
  for (const s of steps) {
    console.log(`[session] ${s.id.padEnd(14)} ${s.skipped ? '(skipped) ' : ''}→ ${s.events.map((e) => `${e.at_s}s ${e.event}`).join(' | ') || 'no events'}`)
  }
  await context.close() // releases the camera
})
