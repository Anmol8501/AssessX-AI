import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'
import { API_BASE_URL, DEV_ADMIN, DEV_CANDIDATE, signIn } from './helpers'
import { candidateAuth, examDetail, ME, openDetails, recordedEvents, seedExam, syntheticDevices, unique } from './proctoring-helpers'

/**
 * Phase 5C: AI observations → stable, factual proctoring events, end to end.
 *
 *   * Scripted-scene tests drive the **real** Phase 5B detectors and the **real** Phase 5C event
 *     processor from a TEST-ONLY scripted runtime (`window.__assessxAI.scene`, changed live), since a
 *     real webcam cannot be scripted: faces leave and return, a second face appears, the head turns,
 *     the AI fails. Debounce timings are shortened through the seam so episodes open and close fast.
 *   * One test runs the production MediaPipe runtime on the synthetic (faceless) camera, with the
 *     shipped debounce defaults, to show a real model yields one episode — not one row per frame.
 *   * Admin checks confirm the AI Monitoring section updates live, factually, with no verdict.
 */

type Recorded = Awaited<ReturnType<typeof recordedEvents>>

const FAST = {
  config: { inferenceIntervalMs: 100 },
  events: {
    allTiming: { startAfterMs: 800, minFrames: 3, resolveAfterMs: 800, minClearFrames: 3, cooldownMs: 500, unknownResolveMs: 1500 },
    statusStableMs: 500,
    frameStaleMs: 1000,
    tickMs: 250,
  },
}

const counter = (page: Page) => page.getByRole('banner').getByText(/^Question \d+ of \d+$/)

async function candidatePage(browser: Browser, seam: Record<string, unknown> | null): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, permissions: ['camera', 'microphone'] })
  const page = await context.newPage()
  await syntheticDevices(page)
  if (seam) {
    await page.addInitScript((value) => {
      ;(window as unknown as { __assessxAI: unknown }).__assessxAI = value
    }, seam)
  }
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  return page
}

async function enterExam(page: Page, request: APIRequestContext, title: string, examId: string): Promise<string> {
  await signIn(page, request, DEV_CANDIDATE)
  await openDetails(page, title)
  await page.getByRole('button', { name: 'Start Exam' }).click() // proctoring check
  await page.getByRole('button', { name: 'Start Exam' }).click() // enter the exam
  await expect(counter(page)).toHaveText('Question 1 of 2')
  const attemptId = (await examDetail(request, examId)).active_attempt_id
  expect(attemptId).not.toBeNull()
  return attemptId!
}

async function adminDetail(browser: Browser, request: APIRequestContext, title: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  const admin = await context.newPage()
  await admin.goto('/')
  await signIn(admin, request, DEV_ADMIN)
  await admin.getByRole('link', { name: 'Monitoring' }).click()
  await expect(admin.getByText(title).first()).toBeVisible({ timeout: 15_000 })
  await admin.getByText(title).first().click()
  await expect(admin.getByRole('dialog')).toBeVisible()
  return admin
}

const setScene = (page: Page, scene: Record<string, unknown>) =>
  page.evaluate((value) => {
    ;(window as unknown as { __assessxAI: { scene: unknown } }).__assessxAI.scene = value
  }, scene)

const aiEvents = (request: APIRequestContext, attemptId: string) => recordedEvents(request, attemptId, { ai: true })

/** Waits until the event processor has calibrated the candidate's neutral head yaw; returns it. */
async function calibratedNeutral(page: Page): Promise<number> {
  let neutral: number | null = null
  await expect
    .poll(
      async () => {
        neutral = await page.evaluate(() => {
          const d = (window as unknown as { __assessxAI?: { eventDiagnostics?: { headCalibration: { status: string; neutralYawDeg?: number } } } })
            .__assessxAI?.eventDiagnostics?.headCalibration
          return d?.status === 'calibrated' ? (d.neutralYawDeg ?? null) : null
        })
        return neutral !== null
      },
      { timeout: 15_000 },
    )
    .toBe(true)
  return neutral!
}

/** Polls the AI event log until `accept` holds, returning it. */
async function until(request: APIRequestContext, attemptId: string, accept: (events: Recorded) => boolean, timeout = 20_000) {
  let events: Recorded = []
  await expect
    .poll(
      async () => {
        events = await aiEvents(request, attemptId)
        return accept(events)
      },
      { timeout },
    )
    .toBe(true)
  return events
}

const ofType = (events: Recorded, type: string) => events.filter((e) => e.event_type === type)
const indicator = (admin: Page, label: string) => admin.getByRole('dialog').locator(`[data-ai-indicator="${label}"]`)

test.describe('AI events (real detectors, scripted scene)', () => {
  test('a face leaving and returning is one episode: started, then resolved with a server duration', async ({ browser, request }) => {
    test.setTimeout(120_000)
    const title = unique('AI Episode Exam')
    const exam = await seedExam(request, title, true)
    const page = await candidatePage(browser, { ...FAST, scene: { faces: 1 } })
    const attemptId = await enterExam(page, request, title, exam.id)

    // Health first, in its own category: the AI reports RUNNING once it has settled.
    const withStatus = await until(request, attemptId, (events) => ofType(events, 'AI_STATUS').some((e) => e.metadata.ai_status === 'RUNNING'))
    const status = ofType(withStatus, 'AI_STATUS').find((e) => e.metadata.ai_status === 'RUNNING')!
    expect(status.category).toBe('AI_HEALTH')
    expect(ofType(withStatus, 'FACE_NOT_DETECTED')).toHaveLength(0) // a present face is not an event

    await setScene(page, { faces: 0 })
    const started = await until(request, attemptId, (events) => ofType(events, 'FACE_NOT_DETECTED').length === 1)
    const start = ofType(started, 'FACE_NOT_DETECTED')[0]!
    expect(start).toMatchObject({ category: 'AI_OBSERVATION', source: 'CLIENT', metadata: { phase: 'started', detector: 'face_presence' } })
    await page.waitForTimeout(2000) // ~20 more frames with no face…
    expect(ofType(await aiEvents(request, attemptId), 'FACE_NOT_DETECTED')).toHaveLength(1) // …still one row
    // No face means head pose and gaze cannot be measured — they are never reported as events.
    expect(ofType(await aiEvents(request, attemptId), 'HEAD_ORIENTATION_CHANGED')).toHaveLength(0)

    await setScene(page, { faces: 1 })
    const resolved = await until(request, attemptId, (events) => ofType(events, 'FACE_NOT_DETECTED').length === 2)
    const end = ofType(resolved, 'FACE_NOT_DETECTED')[1]!
    expect(end.metadata).toMatchObject({ phase: 'resolved', episode_id: start.metadata.episode_id, resolution: 'condition_cleared', detector: 'face_presence' })
    const serverDuration = Date.parse(end.recorded_at) - Date.parse(start.recorded_at)
    expect(end.metadata.duration_ms).toBeGreaterThan(2000)
    expect(Math.abs((end.metadata.duration_ms as number) - serverDuration)).toBeLessThan(5)

    // Nothing here scores or judges.
    expect(JSON.stringify(resolved).toLowerCase()).not.toMatch(/score|risk|cheat|verdict|suspicious|phone/)

    // Eyes held far to the side for several seconds: gaze is disabled, so no GAZE_AWAY is recorded.
    await setScene(page, { faces: 1, gazeHorizontal: -0.95, gazeVertical: 0.9 })
    await page.waitForTimeout(4000)
    expect(ofType(await aiEvents(request, attemptId), 'GAZE_AWAY')).toHaveLength(0)
    await page.context().close()
  })

  test('head orientation is measured from the candidate’s own calibrated neutral', async ({ browser, request }) => {
    test.setTimeout(120_000)
    const title = unique('AI Neutral Exam')
    const exam = await seedExam(request, title, true)
    // The candidate sits off-centre: their "looking at the screen" yaw is −10°.
    const page = await candidatePage(browser, { ...FAST, scene: { faces: 1, yawDeg: -10 } })
    const attemptId = await enterExam(page, request, title, exam.id)
    expect(await calibratedNeutral(page)).toBe(-10)

    // Small movement around the neutral (−16° is 6° from it) is not an event…
    await setScene(page, { faces: 1, yawDeg: -16 })
    await page.waitForTimeout(3000)
    expect(ofType(await aiEvents(request, attemptId), 'HEAD_ORIENTATION_CHANGED')).toHaveLength(0)

    // …a 20° deviation (−30°) held long enough is, and it records the neutral it was measured from.
    await setScene(page, { faces: 1, yawDeg: -30 })
    const turned = await until(request, attemptId, (events) => ofType(events, 'HEAD_ORIENTATION_CHANGED').length === 1)
    expect(ofType(turned, 'HEAD_ORIENTATION_CHANGED')[0]!.metadata).toMatchObject({
      phase: 'started',
      direction: 'right',
      yaw_deg: -30,
      neutral_yaw_deg: -10,
    })
    expect(await calibratedNeutral(page)).toBe(-10) // the turn did not move the baseline

    // Looking down (pitch 30°) is not an event.
    await setScene(page, { faces: 1, yawDeg: -10, pitchDeg: 30 })
    await until(request, attemptId, (events) => ofType(events, 'HEAD_ORIENTATION_CHANGED').length === 2)
    await page.waitForTimeout(3000)
    expect(ofType(await aiEvents(request, attemptId), 'HEAD_ORIENTATION_CHANGED')).toHaveLength(2)
    await page.context().close()
  })

  test('the admin sees the AI state update live: multiple faces, head turn, dark image, then clear', async ({ browser, request }) => {
    test.setTimeout(150_000)
    const title = unique('AI Admin Exam')
    const exam = await seedExam(request, title, true)
    const page = await candidatePage(browser, { ...FAST, scene: { faces: 1 } })
    const attemptId = await enterExam(page, request, title, exam.id)
    await until(request, attemptId, (events) => ofType(events, 'AI_STATUS').some((e) => e.metadata.ai_status === 'RUNNING'))

    const admin = await adminDetail(browser, request, title)
    const dialog = admin.getByRole('dialog')
    const section = dialog.getByRole('region', { name: 'AI monitoring' })
    await expect(section.getByText('AI Running')).toBeVisible({ timeout: 15_000 })
    await expect(indicator(admin, 'Face')).toContainText('Detected')
    await expect(indicator(admin, 'Faces')).toContainText('One')
    await expect(indicator(admin, 'Head')).toContainText('Forward')
    await expect(section.getByText('They do not determine whether a candidate cheated.', { exact: false })).toBeVisible()
    await expect(indicator(admin, 'Gaze')).toHaveCount(0) // gaze is not used as a signal

    expect(await calibratedNeutral(page)).toBe(0)
    await setScene(page, { faces: 2, yawDeg: 40, meanLuminance: 0.03 })
    await expect(indicator(admin, 'Faces')).toContainText('Multiple', { timeout: 15_000 })
    await expect(indicator(admin, 'Head')).toContainText('Turned left')
    await expect(indicator(admin, 'Camera image')).toContainText('Issue')
    const ongoing = dialog.getByRole('list', { name: 'Ongoing AI observations' })
    await expect(ongoing.getByText('Multiple faces detected (2)')).toBeVisible()
    await expect(ongoing.getByText('Head orientation changed (left)')).toBeVisible()
    await expect(ongoing.getByText('Camera image too dark')).toBeVisible()
    // The timeline shows the factual start events, delivered live.
    await expect(dialog.getByText('Multiple faces detected (2) — started').first()).toBeVisible()

    const recorded = await aiEvents(request, attemptId)
    expect(ofType(recorded, 'MULTIPLE_FACES_DETECTED')[0]!.metadata).toMatchObject({ face_count: 2, confidence: 0.9 })
    expect(ofType(recorded, 'HEAD_ORIENTATION_CHANGED')[0]!.metadata).toMatchObject({ direction: 'left', detector: 'head_pose' })

    await setScene(page, { faces: 1 })
    await expect(ongoing.getByText('None.')).toBeVisible({ timeout: 15_000 })
    await expect(indicator(admin, 'Faces')).toContainText('One')
    await expect(indicator(admin, 'Head')).toContainText('Forward')
    await expect(dialog.getByText(/Head orientation changed \(left\) — ended \(after \d+s, cleared\)|Head orientation changed — ended/).first()).toBeVisible()

    // The wall tile shows the AI's health and the number of ongoing observations — no score.
    await admin.getByRole('button', { name: 'Close' }).click()
    await expect(admin.getByText('AI observations:').first()).toBeVisible()
    await expect(admin.locator('body')).not.toContainText(/risk|cheat|suspicious|verdict/i)

    await admin.context().close()
    await page.context().close()
  })

  test('a phone in view: the candidate is warned, the admin sees it live, and it ends when put away', async ({ browser, request }) => {
    test.setTimeout(150_000)
    const title = unique('AI Phone Exam')
    const exam = await seedExam(request, title, true)
    const page = await candidatePage(browser, { ...FAST, scene: { faces: 1 } })
    const attemptId = await enterExam(page, request, title, exam.id)
    await until(request, attemptId, (events) => ofType(events, 'AI_STATUS').some((e) => e.metadata.ai_status === 'RUNNING'))

    const admin = await adminDetail(browser, request, title)
    const dialog = admin.getByRole('dialog')
    await expect(indicator(admin, 'Objects')).toContainText('None seen', { timeout: 15_000 })

    // A phone scoring below YOLOX-S's provisional threshold (0.45) is not an event.
    await setScene(page, { faces: 1, objects: [{ category: 'cell phone', score: 0.3 }] })
    await page.waitForTimeout(3000)
    expect(ofType(await aiEvents(request, attemptId), 'PHONE_DETECTED')).toHaveLength(0)

    // A phone clearly in view, frame after frame: one episode, a warning, and the admin sees it.
    await setScene(page, { faces: 1, objects: [{ category: 'cell phone', score: 0.81 }] })
    const started = await until(request, attemptId, (events) => ofType(events, 'PHONE_DETECTED').length === 1)
    expect(ofType(started, 'PHONE_DETECTED')[0]).toMatchObject({
      category: 'AI_OBSERVATION',
      metadata: { phase: 'started', detector: 'object_detection', object_class: 'cell_phone', confidence: 0.81, object_model: 'yolox_s' },
    })
    await expect(page.getByRole('alert').filter({ hasText: 'A mobile phone is visible' })).toBeVisible()
    await expect(indicator(admin, 'Objects')).toContainText('Phone', { timeout: 15_000 })
    const ongoing = dialog.getByRole('list', { name: 'Ongoing AI observations' })
    await expect(ongoing.getByText('Mobile phone in view (confidence 81%)')).toBeVisible()

    // A book appears too: its own episode.
    await setScene(page, { faces: 1, objects: [{ category: 'cell phone', score: 0.81 }, { category: 'book', score: 0.7 }] })
    await until(request, attemptId, (events) => ofType(events, 'BOOK_DETECTED').length === 1)
    await expect(indicator(admin, 'Objects')).toContainText('Book')

    // Both put away: both episodes end, the warning goes, the admin sees none.
    await setScene(page, { faces: 1 })
    const ended = await until(request, attemptId, (events) => ofType(events, 'PHONE_DETECTED').length === 2 && ofType(events, 'BOOK_DETECTED').length === 2)
    expect(ofType(ended, 'PHONE_DETECTED')[1]!.metadata).toMatchObject({ phase: 'resolved', resolution: 'condition_cleared' })
    await expect(page.getByRole('alert').filter({ hasText: 'A mobile phone is visible' })).toHaveCount(0)
    await expect(indicator(admin, 'Objects')).toContainText('None seen', { timeout: 15_000 })
    // A warning only: the exam is never locked by the AI.
    await expect(counter(page)).toBeVisible()
    expect(JSON.stringify(ended).toLowerCase()).not.toMatch(/risk|cheat|verdict|suspicious/)

    await admin.context().close()
    await page.context().close()
  })

  test('an AI failure is reported as ERROR, open episodes end as unmeasurable, and the admin sees Unknown', async ({ browser, request }) => {
    test.setTimeout(120_000)
    const title = unique('AI Failure Exam')
    const exam = await seedExam(request, title, true)
    const page = await candidatePage(browser, { ...FAST, scene: { faces: 1 } })
    const attemptId = await enterExam(page, request, title, exam.id)
    await calibratedNeutral(page)
    await setScene(page, { faces: 1, yawDeg: -45 })
    await until(request, attemptId, (events) => ofType(events, 'HEAD_ORIENTATION_CHANGED').length === 1)

    await setScene(page, { faces: 1, yawDeg: -45, runtimeFails: true })
    const failed = await until(
      request,
      attemptId,
      (events) =>
        ofType(events, 'AI_STATUS').some((e) => e.metadata.ai_status === 'ERROR') && ofType(events, 'HEAD_ORIENTATION_CHANGED').length === 2,
    )
    expect(ofType(failed, 'AI_STATUS').find((e) => e.metadata.ai_status === 'ERROR')!.metadata.ai_reason).toBe('runtime_error')
    expect(ofType(failed, 'HEAD_ORIENTATION_CHANGED')[1]!.metadata).toMatchObject({ phase: 'resolved', resolution: 'measurement_unavailable' })
    // A failed AI is not "no face": it never produces a FACE_NOT_DETECTED episode.
    expect(ofType(failed, 'FACE_NOT_DETECTED')).toHaveLength(0)

    const admin = await adminDetail(browser, request, title)
    const section = admin.getByRole('dialog').getByRole('region', { name: 'AI monitoring' })
    await expect(section.getByText('AI Error')).toBeVisible({ timeout: 15_000 })
    await expect(section.getByText('AI runtime error')).toBeVisible()
    for (const label of ['Face', 'Faces', 'Head', 'Camera image']) await expect(indicator(admin, label)).toContainText('Unknown')
    await admin.context().close()
    await page.context().close()
  })

  test('submitting closes an ongoing episode on the server (session_ended)', async ({ browser, request }) => {
    test.setTimeout(120_000)
    const title = unique('AI Session End Exam')
    const exam = await seedExam(request, title, true)
    const page = await candidatePage(browser, { ...FAST, scene: { faces: 1 } })
    const attemptId = await enterExam(page, request, title, exam.id)
    await calibratedNeutral(page)
    await setScene(page, { faces: 1, yawDeg: -40 })
    const started = await until(request, attemptId, (events) => ofType(events, 'HEAD_ORIENTATION_CHANGED').length === 1)
    expect(ofType(started, 'HEAD_ORIENTATION_CHANGED')[0]!.metadata).toMatchObject({ phase: 'started', direction: 'right' })

    await page.getByRole('banner').getByRole('button', { name: 'Submit Exam' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Submit Exam' }).click()
    await expect(page.getByRole('heading', { name: 'Exam submitted successfully.' })).toBeVisible()

    const all = await recordedEvents(request, attemptId, { ai: true })
    const head = ofType(all, 'HEAD_ORIENTATION_CHANGED')
    expect(head).toHaveLength(2)
    expect(head[1]).toMatchObject({ source: 'SERVER', metadata: { phase: 'resolved', resolution: 'session_ended' } })
    // Closed at the session's end instant (same server time as SESSION_ENDED; row order between equal times is not defined).
    expect(head[1]!.recorded_at).toBe(all.find((e) => e.event_type === 'SESSION_ENDED')!.recorded_at)
    await page.context().close()
  })

  test('the candidate cannot forge server resolutions, phone events or score fields', async ({ browser, request }) => {
    test.setTimeout(90_000)
    const title = unique('AI Forgery Exam')
    const exam = await seedExam(request, title, true)
    const page = await candidatePage(browser, { ...FAST, scene: { faces: 1 } })
    const attemptId = await enterExam(page, request, title, exam.id)
    const headers = await candidateAuth(request)
    const post = (event_type: string, metadata: Record<string, unknown>) =>
      request.post(`${ME}/attempts/${attemptId}/proctoring/events`, {
        headers,
        data: { client_event_id: crypto.randomUUID(), event_type, metadata },
      })
    const episode = crypto.randomUUID()

    expect((await post('CHEATING_DETECTED', { phase: 'started', episode_id: episode })).status()).toBe(422)
    expect((await post('PHONE_DETECTED', { phase: 'started', episode_id: episode, object_class: 'cell_phone', image: 'AAAA' })).status()).toBe(422)
    expect((await post('GAZE_AWAY', { phase: 'started', episode_id: episode, direction: 'left' })).status()).toBe(422) // disabled
    expect((await post('FACE_NOT_DETECTED', { phase: 'started', episode_id: episode, risk_score: 1 })).status()).toBe(422)
    expect((await post('FACE_NOT_DETECTED', { phase: 'started', episode_id: episode })).status()).toBe(201)
    expect((await post('FACE_NOT_DETECTED', { phase: 'resolved', episode_id: episode, resolution: 'session_ended' })).status()).toBe(422)
    expect((await post('FACE_NOT_DETECTED', { phase: 'resolved', episode_id: episode, resolution: 'condition_cleared', duration_ms: 1 })).status()).toBe(422)
    // Admin-only monitoring is not reachable with a candidate token.
    expect((await request.get(`${API_BASE_URL}/api/v1/admin/monitoring/sessions/${attemptId}`, { headers })).status()).toBe(403)
    await page.context().close()
  })
})

test.describe('AI events (real MediaPipe runtime, shipped debounce defaults)', () => {
  test('an empty camera yields one FACE_NOT_DETECTED episode, not a row per frame, and no object event', async ({ browser, request }) => {
    test.setTimeout(180_000)
    const title = unique('AI Real Model Exam')
    const exam = await seedExam(request, title, true)
    // Production runtime and detectors; only the sampling interval is shortened.
    const page = await candidatePage(browser, { config: { inferenceIntervalMs: 100, latencyBudgetMs: 60_000 } })
    const attemptId = await enterExam(page, request, title, exam.id)

    // The YOLOX-S model (36 MB) and ONNX Runtime load before the first frame: allow for a slow cold start.
    const events = await until(request, attemptId, (all) => ofType(all, 'FACE_NOT_DETECTED').length >= 1, 90_000)
    await page.waitForTimeout(4000)
    const later = await aiEvents(request, attemptId)
    expect(ofType(later, 'FACE_NOT_DETECTED')).toHaveLength(1)
    expect(ofType(later, 'FACE_NOT_DETECTED')[0]!.metadata.phase).toBe('started')
    // The real object model (YOLOX) on an empty synthetic camera: no phone, book, laptop or device.
    for (const type of ['PHONE_DETECTED', 'BOOK_DETECTED', 'LAPTOP_DETECTED', 'HANDHELD_DEVICE_DETECTED']) {
      expect(later.map((e) => e.event_type)).not.toContain(type)
    }
    const ai = later.filter((e) => e.category === 'AI_OBSERVATION' || e.category === 'AI_HEALTH')
    expect(new Set(ai.map((e) => e.event_type))).toEqual(new Set(['AI_STATUS', 'FACE_NOT_DETECTED']))
    void events
    await page.context().close()
  })
})
