import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'
import { DEV_CANDIDATE, signIn } from './helpers'
import { openDetails, seedExam, syntheticDevices, unique } from './proctoring-helpers'

/**
 * AI proctoring, end to end (Phase 5A foundation + Phase 5B detectors).
 *
 * The AI pipeline runs on the same camera stream the proctoring check opened — no second camera.
 *
 *   * Infrastructure tests (5A) install the TEST-ONLY mock runtime through the `window.__assessxAI`
 *     seam — the only way to reach the mock; it is never in the packaged app — to check lifecycle,
 *     failure and "no runtime" honesty deterministically.
 *   * Real-model tests (5B) run the production MediaPipe runtime in its Web Worker on real frames:
 *     a synthetic camera with no face, and MediaPipe's own published test portrait drawn into the
 *     camera (upright, then rotated in-plane). They check what the detectors report, never
 *     accuracy: one portrait proves the path works, not how well the models perform.
 *
 * The portrait is downloaded at test time into the git-ignored `e2e/.cache/` and verified by
 * SHA-256; it is not redistributed. Without network access to fetch it, those tests are skipped.
 */

interface SeamObservation {
  observationType: string
  confidence: number | null
  metadata: Record<string, string | number | boolean>
  boundingBox?: { x: number; y: number; width: number; height: number }
}
interface SeamState {
  health: {
    state: string
    reason: string | null
    runtimeState: string
    cameraAvailable: boolean
    detectors: { id: string; state: string }[]
  }
  telemetry: {
    framesProcessed: number
    framesCaptured: number
    runtime: {
      kind: string
      productionCapable: boolean
      accelerator: string | null
      objectDetector: { model: string; accelerator: string; loadMs: number; warmupMs: number | null; firstInferenceMs: number | null; fallback: string | null } | null
      loadErrors: string[]
    } | null
  }
  recentObservations: SeamObservation[]
}

const PORTRAIT_URL = 'https://storage.googleapis.com/mediapipe-assets/portrait.jpg'
const PORTRAIT_SHA256 = 'a6f11efaa834706db23f275b6115058fa87fc7f14362681e6abe14e82749de3e'
const PORTRAIT_PATH = 'e2e/.cache/portrait.jpg'

/** The MediaPipe test portrait as a data URL, fetched once and verified; null if unavailable. */
async function portraitDataUrl(): Promise<string | null> {
  try {
    if (!existsSync(PORTRAIT_PATH)) {
      const response = await fetch(PORTRAIT_URL)
      if (!response.ok) return null
      mkdirSync('e2e/.cache', { recursive: true })
      writeFileSync(PORTRAIT_PATH, Buffer.from(await response.arrayBuffer()))
    }
    const bytes = readFileSync(PORTRAIT_PATH)
    if (createHash('sha256').update(bytes).digest('hex') !== PORTRAIT_SHA256) return null
    return `data:image/jpeg;base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
}

const counter = (page: Page) => page.getByRole('banner').getByText(/^Question \d+ of \d+$/)
const aiStatus = (page: Page, label: string) => page.getByRole('status', { name: `AI monitoring: ${label}` })

/**
 * A candidate context with synthetic devices, an optional AI seam, and optionally a camera that
 * shows the portrait (rotation controlled live through `window.__portraitRotation`, degrees).
 */
async function candidatePage(browser: Browser, seam: Record<string, unknown> | null, portrait: string | null = null): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, permissions: ['camera', 'microphone'] })
  const page = await context.newPage()
  await syntheticDevices(page)
  await page.addInitScript(() => {
    // Instrumentation: how many inference workers exist, and main-thread long tasks (UI stalls).
    const probe = { workersCreated: 0, workersTerminated: 0, longTasks: [] as { start: number; duration: number }[] }
    ;(window as unknown as { __probe: typeof probe }).__probe = probe
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
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) probe.longTasks.push({ start: entry.startTime, duration: entry.duration })
    }).observe({ type: 'longtask', buffered: true })
  })
  if (seam) {
    await page.addInitScript((value) => {
      ;(window as unknown as { __assessxAI: unknown }).__assessxAI = value
    }, seam)
  }
  if (portrait) {
    await page.addInitScript((src) => {
      const win = window as unknown as { __portraitRotation: number; __media: { streams: MediaStream[] } }
      win.__portraitRotation = 0
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      navigator.mediaDevices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
        if (!constraints?.video) return original(constraints)
        const canvas = document.createElement('canvas')
        canvas.width = 640
        canvas.height = 480
        const context2d = canvas.getContext('2d')!
        const image = new Image()
        image.src = src
        await image.decode()
        const draw = () => {
          context2d.fillStyle = '#808080'
          context2d.fillRect(0, 0, 640, 480)
          context2d.save()
          context2d.translate(320, 240)
          context2d.rotate((win.__portraitRotation * Math.PI) / 180)
          const scale = 440 / image.height
          context2d.drawImage(image, (-image.width * scale) / 2, (-image.height * scale) / 2, image.width * scale, image.height * scale)
          context2d.restore()
        }
        draw()
        window.setInterval(draw, 100)
        const stream = canvas.captureStream(10)
        win.__media.streams.push(stream) // so a test can end it like the other synthetic devices
        return stream
      }
    }, portrait)
  }
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  return page
}

async function enterExam(page: Page, request: APIRequestContext, title: string) {
  await signIn(page, request, DEV_CANDIDATE)
  await openDetails(page, title)
  await page.getByRole('button', { name: 'Start Exam' }).click() // proctoring check
  await page.getByRole('button', { name: 'Start Exam' }).click() // enter the exam
  await expect(counter(page)).toHaveText('Question 1 of 2')
}

async function submit(page: Page) {
  await page.getByRole('banner').getByRole('button', { name: 'Submit Exam' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Submit Exam' }).click()
  await expect(page.getByRole('heading', { name: 'Exam submitted successfully.' })).toBeVisible()
}

interface Probe {
  workersCreated: number
  workersTerminated: number
  longTasks: { start: number; duration: number }[]
}
const probe = (page: Page) => page.evaluate(() => (window as unknown as { __probe: Probe }).__probe)

const seamState = (page: Page) =>
  page.evaluate(() => (window as unknown as { __assessxAI?: { state?: SeamState } }).__assessxAI?.state ?? null)

/** The most recent observation of a type, polled until it satisfies `accept`. */
async function latest(page: Page, type: string, accept: (o: SeamObservation) => boolean = () => true, timeout = 30_000) {
  let found: SeamObservation | undefined
  await expect
    .poll(
      async () => {
        const observations = (await seamState(page))?.recentObservations ?? []
        // The newest observation of this type that meets `accept` (one frame carries one per object class).
        found = [...observations].reverse().find((o) => o.observationType === type && accept(o))
        return found !== undefined
      },
      { timeout },
    )
    .toBe(true)
  return found!
}

// The real runtime's speed depends on the machine; these tests check behaviour, not performance,
// so the latency guard is relaxed here (it is covered by the unit tests).
const REAL = { config: { inferenceIntervalMs: 100, latencyBudgetMs: 60_000 } }

test.describe('AI infrastructure (test-only mock runtime)', () => {
  test('the AI pipeline starts with the exam, produces observations, and stops on submit', async ({ browser, request }) => {
    test.setTimeout(90_000)
    const title = unique('AI Proctored Exam')
    await seedExam(request, title, true)
    const page = await candidatePage(browser, { mock: {}, config: { inferenceIntervalMs: 100 } })
    await enterExam(page, request, title)

    await expect(aiStatus(page, 'active')).toBeVisible({ timeout: 15_000 })
    await expect.poll(async () => (await seamState(page))?.telemetry.framesProcessed ?? 0, { timeout: 15_000 }).toBeGreaterThan(0)
    const state = await seamState(page)
    expect(state?.health.state).toBe('RUNNING')
    expect(state?.telemetry.runtime?.productionCapable).toBe(false) // the mock never claims to be real
    expect(state?.recentObservations.some((o) => o.observationType === 'FRAME_OBSERVED')).toBeTruthy()

    await submit(page)
    await expect.poll(async () => (await seamState(page))?.health.state, { timeout: 10_000 }).toBe('STOPPED')
    await page.context().close()
  })

  test('a failed model load is reported honestly as unavailable, never as monitoring', async ({ browser, request }) => {
    test.setTimeout(90_000)
    const title = unique('AI Load Fail Exam')
    await seedExam(request, title, true)
    const page = await candidatePage(browser, { mock: { loadFails: true }, config: { inferenceIntervalMs: 100 } })
    await enterExam(page, request, title)

    await expect(aiStatus(page, 'unavailable')).toBeVisible({ timeout: 15_000 })
    const state = await seamState(page)
    expect(state?.health.state).toBe('ERROR')
    expect(state?.health.runtimeState).toBe('LOAD_FAILED')
    expect(state?.telemetry.framesCaptured).toBe(0) // nothing to infer with: the camera is not sampled
    await page.context().close()
  })

  test('with no runtime available the pipeline reports limited, not active', async ({ browser, request }) => {
    test.setTimeout(90_000)
    const title = unique('AI No Runtime Exam')
    await seedExam(request, title, true)
    const page = await candidatePage(browser, { disableRuntime: true })
    await enterExam(page, request, title)
    await expect(aiStatus(page, 'limited')).toBeVisible({ timeout: 15_000 })
    await page.context().close()
  })
})

test.describe('AI detectors (real MediaPipe runtime)', () => {
  test('with no face in view: face absence is observed, pose/gaze stay silent, object scores are raw', async ({ browser, request }) => {
    test.setTimeout(120_000)
    const title = unique('AI Real No Face')
    await seedExam(request, title, true)
    const page = await candidatePage(browser, REAL)
    await enterExam(page, request, title)

    await expect(aiStatus(page, 'active')).toBeVisible({ timeout: 60_000 })
    const presence = await latest(page, 'FACE_PRESENCE')
    expect(presence.metadata).toEqual({ facePresent: false, faceCount: 0 })

    // The default object model is YOLOX (YOLOX-S on WebGPU, else YOLOX-Tiny); one observation per
    // class, raw confidence only — the detected/not-detected decision belongs to the event layer.
    const phone = await latest(page, 'OBJECT_DETECTION', (o) => o.metadata.objectClass === 'cell_phone')
    expect(['yolox_s', 'yolox_tiny']).toContain(phone.metadata.objectModel)
    expect(phone.metadata).not.toHaveProperty('detected')
    for (const objectClass of ['book', 'laptop', 'remote']) await latest(page, 'OBJECT_DETECTION', (o) => o.metadata.objectClass === objectClass)
    await latest(page, 'FRAME_QUALITY')

    const state = (await seamState(page))!
    expect(state.telemetry.runtime).toMatchObject({ kind: 'mediapipe', productionCapable: true, accelerator: 'CPU' })
    expect(state.recentObservations.some((o) => o.observationType === 'HEAD_POSE' || o.observationType === 'GAZE')).toBe(false)
    expect(state.health.detectors.every((d) => d.state === 'RUNNING')).toBe(true)

    await submit(page)
    await expect.poll(async () => (await seamState(page))?.health.state, { timeout: 10_000 }).toBe('STOPPED')
    await page.context().close()
  })

  test('with a face in view: presence, tracking, head pose and gaze are measured; camera loss and return are handled', async ({
    browser,
    request,
  }) => {
    test.setTimeout(180_000)
    const portrait = await portraitDataUrl()
    test.skip(portrait === null, 'MediaPipe test portrait unavailable (no network?)')
    const title = unique('AI Real Portrait')
    await seedExam(request, title, true)
    const page = await candidatePage(browser, REAL, portrait)
    await enterExam(page, request, title)
    await expect(aiStatus(page, 'active')).toBeVisible({ timeout: 60_000 })

    // Exactly one live inference worker for the exam. (In development React StrictMode mounts,
    // unmounts and remounts effects once, so a first pipeline is created and immediately stopped —
    // its worker is terminated; production builds do not double-invoke. Hence alive = created − terminated.)
    const atStart = await probe(page)
    expect(atStart.workersCreated - atStart.workersTerminated).toBe(1)

    // Presence and count, with the model's confidence and a box.
    const presence = await latest(page, 'FACE_PRESENCE', (o) => o.metadata.faceCount === 1)
    expect(presence.metadata.facePresent).toBe(true)
    expect(presence.confidence).toBeGreaterThan(0)
    expect(presence.boundingBox?.width).toBeGreaterThan(0)

    // A short-lived track that continues across frames.
    const track = await latest(page, 'FACE_TRACK', (o) => o.metadata.trackId === 't1' && Number(o.metadata.framesSeen) >= 3)

    // Head pose on the upright portrait, then after rotating it 20° clockwise in the frame.
    const upright = await latest(page, 'HEAD_POSE')
    expect(Math.abs(Number(upright.metadata.rollDeg))).toBeLessThan(5)
    const gaze = await latest(page, 'GAZE')
    expect(Object.keys(gaze.metadata)).toHaveLength(10)
    expect(gaze.confidence).toBeNull()

    // UI impact while all detectors run: main-thread long tasks over a steady 10 s window. Inference
    // runs in the worker, so the exam thread should see no stall of its own (reported, loosely bounded).
    const windowStart = await page.evaluate(() => performance.now())
    await page.waitForTimeout(10_000)
    const steady = (await probe(page)).longTasks.filter((task) => task.start >= windowStart)
    const longest = Math.max(0, ...steady.map((task) => task.duration))
    test.info().annotations.push({ type: 'main-thread long tasks (10 s, AI running)', description: `${steady.length}, longest ${Math.round(longest)} ms` })
    expect(longest).toBeLessThan(500)

    await page.evaluate(() => {
      ;(window as unknown as { __portraitRotation: number }).__portraitRotation = 20
    })
    const rolled = await latest(page, 'HEAD_POSE', (o) => Number(o.metadata.rollDeg) < -15)
    expect(Number(rolled.metadata.rollDeg)).toBeGreaterThan(-25)

    // The camera drops: AI monitoring says so plainly (not a statement about the candidate) …
    await page.evaluate(() => {
      const media = (window as unknown as { __media: { streams: MediaStream[] } }).__media
      media.streams.flatMap((s) => s.getVideoTracks()).find((t) => t.readyState === 'live')?.dispatchEvent(new Event('ended'))
    })
    await expect(aiStatus(page, 'limited')).toBeVisible({ timeout: 15_000 })
    expect((await seamState(page))?.health.reason).toMatch(/camera/i)

    // … and when it returns, perception resumes on the new stream with fresh (reset) tracks.
    await page.getByRole('button', { name: 'Reconnect camera' }).click()
    await expect(aiStatus(page, 'active')).toBeVisible({ timeout: 30_000 })
    // Tracking state was reset with the camera: ids restart at t1, with a later start time.
    await latest(page, 'FACE_TRACK', (o) => o.metadata.trackId === 't1' && Number(o.metadata.trackStartedMs) > Number(track.metadata.trackStartedMs))
    // A camera reconnect reuses the same inference worker — no new worker, no duplicate pipeline.
    expect(await probe(page)).toMatchObject({ workersCreated: atStart.workersCreated, workersTerminated: atStart.workersTerminated })

    await submit(page)
    await expect.poll(async () => (await seamState(page))?.health.state, { timeout: 10_000 }).toBe('STOPPED')
    // The worker (WebAssembly memory, models) is released with the exam.
    await expect.poll(async () => (await probe(page)).workersTerminated).toBe(atStart.workersCreated)
    await page.context().close()
  })
})

test.describe('YOLOX-Tiny forced (the CPU fallback model, real runtime)', () => {
  const YOLOX = { objectModel: 'yolox_tiny', config: { inferenceIntervalMs: 100, latencyBudgetMs: 60_000 } }

  test('YOLOX-Tiny runs behind the same detector, warmed up, and labels its observations', async ({ browser, request }) => {
    test.setTimeout(150_000)
    const title = unique('AI YOLOX')
    await seedExam(request, title, true)
    const page = await candidatePage(browser, YOLOX)
    await enterExam(page, request, title)
    await expect(aiStatus(page, 'active')).toBeVisible({ timeout: 90_000 })

    const phone = await latest(page, 'OBJECT_DETECTION', (o) => o.metadata.objectClass === 'cell_phone')
    expect(phone.metadata).toMatchObject({ objectClass: 'cell_phone', objectModel: 'yolox_tiny' })
    expect(phone.confidence).not.toBeNull() // raw model confidence only — no decision
    const state = (await seamState(page))!
    const backend = state.telemetry.runtime!.objectDetector!
    expect(backend.model).toBe('yolox_tiny')
    expect(['webgpu', 'wasm']).toContain(backend.accelerator)
    expect(backend.warmupMs).toBeGreaterThan(0) // cold start measured apart from steady state
    expect(backend.firstInferenceMs).toBeGreaterThan(0)
    test.info().annotations.push({ type: 'yolox backend', description: JSON.stringify(backend) })
    // The other detectors are unaffected.
    await latest(page, 'FACE_PRESENCE')
    await latest(page, 'FRAME_QUALITY')
    expect(state.health.detectors.every((d) => d.state === 'RUNNING')).toBe(true)

    await submit(page)
    await expect.poll(async () => (await seamState(page))?.health.state, { timeout: 10_000 }).toBe('STOPPED')
    await page.context().close()
  })

  for (const [name, url, reason] of [
    // The dev server answers unknown paths with its HTML page (SPA fallback), which the integrity check
    // rejects; the packaged app returns 404. Either way the load fails with an explicit reason.
    ['missing', '/models/__missing__.onnx', /missing|integrity/i],
    ['corrupted', '/models/efficientdet_lite0.tflite', /integrity/i],
  ] as const) {
    test(`a ${name} YOLOX model fails clearly without affecting face detection`, async ({ browser, request }) => {
      test.setTimeout(150_000)
      const title = unique(`AI YOLOX ${name}`)
      await seedExam(request, title, true)
      const page = await candidatePage(browser, { ...YOLOX, objectModelUrl: url })
      await enterExam(page, request, title)

      await expect(aiStatus(page, 'limited')).toBeVisible({ timeout: 90_000 })
      await latest(page, 'FACE_PRESENCE') // face detection still works
      const state = (await seamState(page))!
      expect(state.health.reason).toMatch(/object detection/)
      expect(state.health.detectors.find((d) => d.id === 'object-detection')?.state).toBe('ERROR')
      expect(state.telemetry.runtime!.loadErrors.join(' ')).toMatch(reason)
      expect(state.telemetry.runtime!.objectDetector).toBeNull()
      // Never silently swapped for EfficientDet: no object observations at all.
      expect(state.recentObservations.some((o) => o.observationType === 'OBJECT_DETECTION')).toBe(false)
      await page.context().close()
    })
  }
})
