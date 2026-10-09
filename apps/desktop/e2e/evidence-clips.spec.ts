import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'
import { API_BASE_URL, DEV_ADMIN, DEV_CANDIDATE, apiToken, signIn, storedToken } from './helpers'
import { examDetail, openDetails, seedExam, syntheticDevices, unique } from './proctoring-helpers'

/**
 * Evidence clips (PRD FR-017), end to end: the real Phase 5B/5C AI (driven by a TEST-ONLY scripted
 * scene) reports a factual event; the app's real MediaRecorder rolling buffer captures around it; the
 * server stores the clip privately and hashes it; an administrator watches it through the API. Plus:
 * a failed upload never disturbs the exam, nothing is recorded after it, and candidates cannot reach
 * any evidence route.
 */

const FAST = {
  config: { inferenceIntervalMs: 100 },
  events: {
    allTiming: { startAfterMs: 800, minFrames: 3, resolveAfterMs: 800, minClearFrames: 3, cooldownMs: 500, unknownResolveMs: 1500 },
    statusStableMs: 500,
    frameStaleMs: 1000,
    tickMs: 250,
  },
}

type Clip = { clip_id: string; status: string; byte_size: number | null; sha256: string | null; failure_reason: string | null; events: { event_type: string }[] }

const counter = (page: Page) => page.getByRole('banner').getByText(/^Question \d+ of \d+$/)
const setScene = (page: Page, scene: Record<string, unknown>) =>
  page.evaluate((value) => {
    ;(window as unknown as { __assessxAI: { scene: unknown } }).__assessxAI.scene = value
  }, scene)

async function candidatePage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, permissions: ['camera', 'microphone'] })
  const page = await context.newPage()
  await syntheticDevices(page)
  await page.addInitScript((value) => {
    ;(window as unknown as { __assessxAI: unknown }).__assessxAI = value
  }, { ...FAST, scene: { faces: 1 } })
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
  await page.getByRole('button', { name: 'Start Exam' }).click()
  await expect(counter(page)).toHaveText('Question 1 of 2')
  return (await examDetail(request, examId)).active_attempt_id!
}

async function clipsOf(request: APIRequestContext, token: string, attemptId: string): Promise<Clip[]> {
  const response = await request.get(`${API_BASE_URL}/api/v1/admin/attempts/${attemptId}/evidence-clips`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(response.ok()).toBeTruthy()
  return ((await response.json()) as { clips: Clip[] }).clips
}

test('a factual event yields a stored, hashed clip an administrator can watch — and nothing after the exam', async ({ browser, request }) => {
  test.setTimeout(150_000)
  const title = unique('Evidence Clip Exam')
  const exam = await seedExam(request, title, true)
  const page = await candidatePage(browser)

  // The candidate is told, before starting, exactly what may be recorded.
  await signIn(page, request, DEV_CANDIDATE)
  await openDetails(page, title)
  await page.getByRole('button', { name: 'Start Exam' }).click()
  await expect(page.getByText(/your camera is not recorded continuously/i)).toBeVisible()
  await expect(page.getByText(/without sound/i)).toBeVisible()
  await page.getByRole('button', { name: 'Start Exam' }).click()
  await expect(counter(page)).toHaveText('Question 1 of 2')
  const attemptId = (await examDetail(request, exam.id)).active_attempt_id!

  // Let the rolling buffer fill, then the face leaves the view: a stabilised FACE_NOT_DETECTED.
  await page.waitForTimeout(7000)
  await setScene(page, { faces: 0 })
  const admin = await apiToken(request, DEV_ADMIN)
  await expect
    .poll(async () => (await clipsOf(request, admin, attemptId)).map((c) => c.status), { timeout: 60_000, intervals: [2000] })
    .toContain('READY')
  const [clip] = (await clipsOf(request, admin, attemptId)).filter((c) => c.status === 'READY')
  expect(clip!.events[0]!.event_type).toBe('FACE_NOT_DETECTED')
  expect(clip!.sha256).toMatch(/^[0-9a-f]{64}$/)
  expect(clip!.byte_size).toBeGreaterThan(1000)

  // The video is a real WebM, served only through the API, never cached.
  const media = await request.get(`${API_BASE_URL}/api/v1/admin/attempts/${attemptId}/evidence-clips/${clip!.clip_id}/media`, {
    headers: { Authorization: `Bearer ${admin}` },
  })
  expect(media.status()).toBe(200)
  expect(media.headers()['cache-control']).toBe('no-store')
  expect([...(await media.body()).subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3])

  // The candidate's own session cannot reach any admin evidence route.
  const candidate = { Authorization: `Bearer ${await storedToken(page)}` }
  for (const path of ['', `/${clip!.clip_id}`, `/${clip!.clip_id}/media`]) {
    const response = await request.get(`${API_BASE_URL}/api/v1/admin/attempts/${attemptId}/evidence-clips${path}`, { headers: candidate })
    expect(response.status()).toBe(403)
  }

  // An administrator watches it from the evidence timeline, played from memory (a blob: URL).
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  const reviewer = await context.newPage()
  await reviewer.goto('/')
  await signIn(reviewer, request, DEV_ADMIN)
  await reviewer.getByRole('link', { name: 'Monitoring' }).click()
  await reviewer.getByText(title).first().click()
  const section = reviewer.getByRole('dialog').getByRole('region', { name: 'Proctoring evidence' })
  await expect(section.locator('[data-evidence="clip-badge"]').first()).toHaveText('Video clip', { timeout: 20_000 })
  await section.locator('[data-evidence="clip-badge"]').first().click()
  const panel = section.locator('[data-evidence="clip"]')
  await expect(panel).toContainText('Evidence: ')
  await expect(panel).toContainText('Main camera')
  await expect(panel).not.toContainText(/cheat|proof|guilty/i)
  await panel.getByRole('button', { name: 'View evidence' }).click()
  const video = panel.locator('video')
  await expect(video).toBeVisible()
  expect(await video.getAttribute('src')).toMatch(/^blob:/)
  // It really decodes: the browser knows the picture's size and has frames to show.
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 10_000 }).toBeGreaterThan(0)
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 10_000 }).toBeGreaterThanOrEqual(2)
  await context.close()

  // After submission nothing more is recorded, whatever the camera shows.
  await page.getByRole('banner').getByRole('button', { name: 'Submit Exam' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Submit Exam' }).click()
  await expect(page.getByRole('heading', { name: 'Exam submitted successfully.' })).toBeVisible()
  const settled = (await clipsOf(request, admin, attemptId)).length
  await page.waitForTimeout(15_000)
  const after = await clipsOf(request, admin, attemptId)
  expect(after.length).toBe(settled)
  expect(after.every((c) => c.status !== 'CREATING')).toBe(true)
  await page.context().close()
})

test('a failed clip upload never disturbs the exam; the clip is recorded as FAILED', async ({ browser, request }) => {
  test.setTimeout(150_000)
  const title = unique('Evidence Failure Exam')
  const exam = await seedExam(request, title, true)
  const page = await candidatePage(browser)
  // Every clip upload fails (the network drops it); everything else works.
  await page.route('**/proctoring/evidence-clips/**', (route) => (route.request().method() === 'PUT' ? route.abort('failed') : route.continue()))
  const attemptId = await enterExam(page, request, title, exam.id)

  await page.waitForTimeout(7000)
  await setScene(page, { faces: 0 })
  const admin = await apiToken(request, DEV_ADMIN)
  await expect
    .poll(async () => (await clipsOf(request, admin, attemptId)).map((c) => `${c.status}:${c.failure_reason}`), {
      timeout: 60_000,
      intervals: [2000],
    })
    .toContain('FAILED:upload_failed')

  // The exam carries on: answer, move on, submit.
  await setScene(page, { faces: 1 })
  await page.getByRole('radio').first().check()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
  await page.getByRole('banner').getByRole('button', { name: 'Submit Exam' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Submit Exam' }).click()
  await expect(page.getByRole('heading', { name: 'Exam submitted successfully.' })).toBeVisible()
  await page.context().close()
})
