import { expect, test } from '@playwright/test'
import { DEV_CANDIDATE, signIn } from './helpers'
import {
  candidateAuth,
  check,
  examDetail,
  ME,
  openDetails,
  proctoringSession,
  seedExam,
  setDevice,
  syntheticDevices,
  unique,
} from './proctoring-helpers'

/**
 * Phase 4A: a proctored exam goes through the camera/microphone check, runs under a proctoring
 * session, and the session ends with the attempt.
 *
 * Devices: `getUserMedia` is replaced in the page with synthetic streams — a canvas for the camera,
 * an oscillator for the microphone — which a test can refuse, hide, or end on demand with the same
 * `DOMException`s and `ended` events real hardware produces. Everything above `getUserMedia` (the
 * device hook, error handling, the readiness screen, the session lifecycle and reporting) runs for
 * real against the backend.
 *
 * Edge's built-in fake devices (`--use-fake-device-for-media-stream`) were tried first and are not
 * usable here: once the fake microphone opens, Edge intermittently fires `devicechange`, ends the
 * fake camera's track and reports no camera for the rest of the browser session. Opening a real
 * camera and microphone inside the packaged WebView2 app is therefore a manual check.
 */


test.beforeEach(async ({ page }) => {
  await syntheticDevices(page)
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
})

test('a proctored exam is checked, run under proctoring, and its session ends on submission', async ({
  page,
  request,
}) => {
  const title = unique('Proctored Exam')
  const { id } = await seedExam(request, title, true)

  await signIn(page, request, DEV_CANDIDATE)
  await openDetails(page, title)
  await expect(page.getByText('Camera and microphone', { exact: true })).toBeVisible()
  await expect(page.getByText('This exam is proctored.')).toBeVisible()

  // --- The readiness check comes before the attempt, so it costs no exam time -------------------
  await page.getByRole('button', { name: 'Start Exam' }).click()
  await expect(page.getByRole('heading', { name: 'Proctoring check' })).toBeVisible()
  await expect(check(page, 'Camera')).toHaveText('Ready')
  await expect(check(page, 'Microphone')).toHaveText('Ready')
  await expect(check(page, 'Exam session')).toHaveText('Ready')
  await expect(page.getByLabel('Your camera preview')).toBeVisible()
  expect((await examDetail(request, id)).attempts_used).toBe(0) // no attempt, no clock yet

  // --- Enter: the attempt starts and the session is activated -----------------------------------
  await page.getByRole('button', { name: 'Start Exam' }).click()
  await expect(page.getByRole('banner').getByText(/^Question 1 of 2$/)).toBeVisible()
  await expect(page.getByLabel('Proctoring status')).toBeVisible()

  const detail = await examDetail(request, id)
  expect(detail.active_attempt_id).not.toBeNull()
  const attemptId = detail.active_attempt_id!
  const active = await proctoringSession(request, attemptId)
  expect(active.status).toBe('ACTIVE')
  expect(active.camera_state).toBe('READY')
  expect(active.microphone_state).toBe('READY')
  expect(active.started_at).not.toBeNull()

  // --- The Phase 3 exam is unchanged: answer, submit, see the result -----------------------------
  await page.getByRole('radio', { name: 'Queue' }).check()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
  await page.getByRole('banner').getByRole('button', { name: 'Submit Exam' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Submit Exam' }).click()
  await expect(page.getByRole('heading', { name: 'Exam submitted successfully.' })).toBeVisible()

  const ended = await proctoringSession(request, attemptId)
  expect(ended.status).toBe('ENDED')
  // The camera and microphone are released with the exam: no live track is left behind.
  await expect(page.getByLabel('Proctoring status')).toHaveCount(0)
})

test('resuming a proctored exam goes through the check again and keeps the same session', async ({ page, request }) => {
  const title = unique('Resumed Proctored')
  const { id } = await seedExam(request, title, true)

  await signIn(page, request, DEV_CANDIDATE)
  await openDetails(page, title)
  await page.getByRole('button', { name: 'Start Exam' }).click()
  await page.getByRole('button', { name: 'Start Exam' }).click()
  await expect(page.getByRole('banner').getByText(/^Question 1 of 2$/)).toBeVisible()
  const attemptId = (await examDetail(request, id)).active_attempt_id!
  const first = await proctoringSession(request, attemptId)

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Proctoring check' })).toBeVisible()
  await expect(page.getByText('Your attempt is in progress and its clock is running.')).toBeVisible()
  await expect(check(page, 'Camera')).toHaveText('Ready')
  await page.getByRole('button', { name: 'Continue Exam' }).click()
  await expect(page.getByRole('banner').getByText(/^Question 1 of 2$/)).toBeVisible()

  const again = await proctoringSession(request, attemptId)
  expect(again.status).toBe('ACTIVE')
  expect(again.started_at).toBe(first.started_at) // same session, original start
})

test('a blocked camera or a missing microphone keeps the exam closed until fixed', async ({ page, request }) => {
  const title = unique('Blocked Devices')
  const { id } = await seedExam(request, title, true)

  await signIn(page, request, DEV_CANDIDATE)
  await setDevice(page, 'video', 'deny', true)
  await setDevice(page, 'audio', 'missing', true)
  await openDetails(page, title)
  await page.getByRole('button', { name: 'Start Exam' }).click()

  await expect(check(page, 'Camera')).toHaveText('Access blocked')
  await expect(check(page, 'Microphone')).toHaveText('Not available')
  await expect(page.getByText(/Camera access is blocked/)).toBeVisible()
  await expect(page.getByText(/No microphone was found/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start Exam' })).toBeDisabled()
  expect((await examDetail(request, id)).attempts_used).toBe(0)

  // The candidate fixes the camera and retries; the microphone is still missing.
  await setDevice(page, 'video', 'deny', false)
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(check(page, 'Camera')).toHaveText('Ready')
  await expect(check(page, 'Microphone')).toHaveText('Not available')
  await expect(page.getByRole('button', { name: 'Start Exam' })).toBeDisabled()

  await setDevice(page, 'audio', 'missing', false)
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(check(page, 'Microphone')).toHaveText('Ready')
  await expect(page.getByRole('button', { name: 'Start Exam' })).toBeEnabled()
})

test('a camera lost mid-exam is shown and recorded, and the exam carries on', async ({ page, request }) => {
  const title = unique('Camera Lost')
  const { id } = await seedExam(request, title, true)

  await signIn(page, request, DEV_CANDIDATE)
  await openDetails(page, title)
  await page.getByRole('button', { name: 'Start Exam' }).click()
  await page.getByRole('button', { name: 'Start Exam' }).click()
  await expect(page.getByRole('banner').getByText(/^Question 1 of 2$/)).toBeVisible()
  const attemptId = (await examDetail(request, id)).active_attempt_id!

  // The camera's track ends, as it does when the device is unplugged.
  await page.evaluate(() => {
    const media = (window as unknown as { __media: { streams: MediaStream[] } }).__media
    const track = media.streams.flatMap((s) => s.getVideoTracks()).find((t) => t.readyState === 'live')
    track?.dispatchEvent(new Event('ended'))
  })
  await expect(page.getByRole('button', { name: 'Reconnect camera' })).toBeVisible()
  await expect.poll(async () => (await proctoringSession(request, attemptId)).camera_state).toBe('UNAVAILABLE')

  // Not a verdict: the exam carries on and answers still save.
  await page.getByRole('radio', { name: 'Queue' }).check()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Reconnect camera' }).click()
  await expect(page.getByRole('button', { name: 'Reconnect camera' })).toHaveCount(0)
  await expect.poll(async () => (await proctoringSession(request, attemptId)).camera_state).toBe('READY')
  expect((await proctoringSession(request, attemptId)).status).toBe('ACTIVE')
})

test('an exam that is not proctored starts straight away, exactly as before', async ({ page, request }) => {
  const title = unique('Unproctored Exam')
  const { id } = await seedExam(request, title, false)

  await signIn(page, request, DEV_CANDIDATE)
  await openDetails(page, title)
  await expect(page.getByText('Not proctored', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Start Exam' }).click()

  await expect(page.getByRole('banner').getByText(/^Question 1 of 2$/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Proctoring check' })).toHaveCount(0)
  await expect(page.getByLabel('Proctoring status')).toHaveCount(0)
  const attemptId = (await examDetail(request, id)).active_attempt_id!
  const response = await request.get(`${ME}/attempts/${attemptId}/proctoring`, { headers: await candidateAuth(request) })
  expect(response.status()).toBe(404) // no session for an unproctored attempt
})
