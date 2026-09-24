import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { API_BASE_URL, apiToken, DEV_ADMIN, DEV_CANDIDATE, signIn } from './helpers'

/** Phase 3B: the countdown, submission, and an exam that ends itself when the time runs out. */

const unique = (label: string) => `${label} ${Date.now().toString().slice(-6)}`

const counter = (page: Page) => page.getByRole('banner').getByText(/^Question \d+ of \d+$/)
const timer = (page: Page) => page.getByRole('timer')

const MCQ = {
  type: 'MCQ',
  text: 'Which traversal visits the root first?',
  marks: 2,
  options: [
    { text: 'Pre-order', is_correct: true },
    { text: 'In-order', is_correct: false },
    { text: 'Post-order', is_correct: false },
    { text: 'Level-order', is_correct: false },
  ],
}
const TRUE_FALSE = {
  type: 'TRUE_FALSE',
  text: 'A queue follows first-in, first-out ordering.',
  marks: 1,
  options: [
    { text: 'True', is_correct: true },
    { text: 'False', is_correct: false },
  ],
}

/** Publishes a timed exam and assigns it to the development candidate. */
async function seedTimedExam(
  request: APIRequestContext,
  title: string,
  durationMinutes: number,
): Promise<{ id: string }> {
  const token = await apiToken(request, DEV_ADMIN)
  const headers = { Authorization: `Bearer ${token}` }

  const created = await request.post(`${API_BASE_URL}/api/v1/assessments`, {
    headers,
    data: {
      title,
      instructions: 'Answer the questions before the time runs out.',
      duration_minutes: durationMinutes,
      total_marks: 3,
      passing_marks: 1,
    },
  })
  expect(created.ok()).toBeTruthy()
  const assessment = (await created.json()) as { id: string }

  for (const question of [MCQ, TRUE_FALSE]) {
    const added = await request.post(`${API_BASE_URL}/api/v1/assessments/${assessment.id}/questions`, {
      headers,
      data: question,
    })
    expect(added.ok()).toBeTruthy()
  }
  expect((await request.post(`${API_BASE_URL}/api/v1/assessments/${assessment.id}/publish`, { headers })).ok()).toBeTruthy()

  const candidates = (await (
    await request.get(`${API_BASE_URL}/api/v1/candidates`, { headers })
  ).json()) as Array<{ id: string; email: string }>
  const candidate = candidates.find((row) => row.email === DEV_CANDIDATE.email)!
  expect(
    (
      await request.post(`${API_BASE_URL}/api/v1/assessments/${assessment.id}/assignments`, {
        headers,
        data: { candidate_ids: [candidate.id] },
      })
    ).ok(),
  ).toBeTruthy()
  return assessment
}

/** Opens the exam through the UI. A hash-only `goto` does not re-route the app. */
async function openExam(page: Page, title: string, action: 'Start Exam' | 'Resume Exam') {
  await page.getByRole('link', { name: 'My Exams' }).click()
  await page
    .getByRole('heading', { name: title })
    .locator('xpath=ancestor::*[contains(@class,"rounded-lg")][1]')
    .getByRole('link', { name: 'View Details' })
    .click()
  await page.getByRole('button', { name: action }).click()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
})

test('the countdown runs, survives a reload without restarting, and the exam can be submitted', async ({
  page,
  request,
}) => {
  const title = unique('Timed Exam')
  const { id } = await seedTimedExam(request, title, 45)

  await signIn(page, request, DEV_CANDIDATE)
  await openExam(page, title, 'Start Exam')
  await expect(counter(page)).toHaveText('Question 1 of 2')

  // --- The timer is visible and counting down ---------------------------------------------------
  await expect(timer(page)).toBeVisible()
  const first = await timer(page).innerText()
  expect(first).toMatch(/^\d{2}:\d{2}$/)
  await expect(async () => {
    expect(await timer(page).innerText()).not.toBe(first)
  }).toPass({ timeout: 5_000 })

  // --- Answer, then reload -----------------------------------------------------------------------
  await page.getByRole('radio', { name: 'Pre-order' }).check()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()

  const beforeReload = await timer(page).innerText()
  await page.reload()
  await expect(counter(page)).toHaveText('Question 1 of 2')
  await expect(page.getByRole('radio', { name: 'Pre-order' })).toBeChecked() // answers survive

  // The clock continued rather than restarting: a reload must not hand back the full duration.
  const afterReload = await timer(page).innerText()
  expect(toSeconds(afterReload)).toBeLessThanOrEqual(toSeconds(beforeReload))
  expect(toSeconds(afterReload)).toBeGreaterThan(44 * 60 - 120) // still ~45 minutes, not reset

  // The deadline itself is unchanged, which is the property that actually matters.
  const auth = { Authorization: `Bearer ${await apiToken(request, DEV_CANDIDATE)}` }
  const detail = (await (
    await request.get(`${API_BASE_URL}/api/v1/candidates/me/assessments/${id}`, { headers: auth })
  ).json()) as { latest_attempt_id: string }
  const session = (await (
    await request.get(`${API_BASE_URL}/api/v1/candidates/me/attempts/${detail.latest_attempt_id}/session`, {
      headers: auth,
    })
  ).json()) as { expires_at: string; status: string; remaining_seconds: number }
  expect(session.status).toBe('IN_PROGRESS')

  // --- Submit -------------------------------------------------------------------------------------
  await page.getByRole('button', { name: 'Submit Exam' }).click()
  const confirm = page.getByRole('dialog')
  await expect(confirm.getByText(/You have answered 1 of 2 questions/)).toBeVisible()
  await expect(confirm.getByText(/cannot change your answers/)).toBeVisible()
  await confirm.getByRole('button', { name: 'Submit Exam' }).click()

  // --- Finalized ------------------------------------------------------------------------------------
  await expect(page.getByText('Exam submitted successfully.')).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Pre-order' })).toHaveCount(0) // no answering surface
  await expect(timer(page)).toHaveCount(0)
  // This exam does not release results (the default), so the score is withheld rather than shown.
  // Scoring itself is covered by results.spec.ts.
  await expect(page.getByText('Your result is not being shown')).toBeVisible()
  await expect(page.getByText(/\d+ \/ \d+/)).toHaveCount(0)

  // --- Reopening does not reopen the exam -----------------------------------------------------------
  await page.reload()
  await expect(page.getByText('Exam submitted successfully.')).toBeVisible()

  // --- And the server refuses further changes --------------------------------------------------------
  const attempt = (await (
    await request.get(`${API_BASE_URL}/api/v1/candidates/me/attempts/${detail.latest_attempt_id}`, {
      headers: auth,
    })
  ).json()) as { status: string; questions: Array<{ id: string; options: Array<{ id: string }> }> }
  expect(attempt.status).toBe('SUBMITTED')

  const rejected = await request.put(
    `${API_BASE_URL}/api/v1/candidates/me/attempts/${detail.latest_attempt_id}/answers/${attempt.questions[0].id}`,
    { headers: auth, data: { selected_option_ids: [attempt.questions[0].options[1].id] } },
  )
  expect(rejected.status()).toBe(409)
  expect((await rejected.json()).error.code).toBe('attempt_locked')
})

test('My Exams shows a submitted exam as finished and will not start it again', async ({ page, request }) => {
  const title = unique('Finished Exam')
  const { id } = await seedTimedExam(request, title, 30)

  const auth = { Authorization: `Bearer ${await apiToken(request, DEV_CANDIDATE)}` }
  const startResponse = await request.post(
    `${API_BASE_URL}/api/v1/candidates/me/assessments/${id}/attempts`,
    { headers: auth },
  )
  expect(startResponse.status(), await startResponse.text()).toBe(200)
  const started = (await startResponse.json()) as { id: string }

  const submitResponse = await request.post(
    `${API_BASE_URL}/api/v1/candidates/me/attempts/${started.id}/submit`,
    { headers: auth },
  )
  expect(submitResponse.status(), await submitResponse.text()).toBe(200)

  await signIn(page, request, DEV_CANDIDATE)
  await page.getByRole('link', { name: 'My Exams' }).click()

  const card = page
    .getByRole('heading', { name: title })
    .locator('xpath=ancestor::*[contains(@class,"rounded-lg")][1]')
  await expect(card.getByText('Submitted')).toBeVisible()
  await expect(card.getByRole('link', { name: 'Resume Exam' })).toHaveCount(0)

  await card.getByRole('link', { name: 'View Details' }).click()
  await expect(page.getByText('You have submitted this exam. Your answers are final.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start Exam' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Resume Exam' })).toHaveCount(0)

  // A second attempt is refused by the server, whatever the UI offers.
  const again = await request.post(`${API_BASE_URL}/api/v1/candidates/me/assessments/${id}/attempts`, {
    headers: auth,
  })
  expect(again.status()).toBe(409)
})

test('an exam ends itself when the time runs out', async ({ page, request }) => {
  // One minute is the shortest duration the assessment model allows, so this test really waits.
  test.setTimeout(150_000)
  const title = unique('One Minute')
  const { id } = await seedTimedExam(request, title, 1)

  await signIn(page, request, DEV_CANDIDATE)
  await openExam(page, title, 'Start Exam')
  await expect(counter(page)).toHaveText('Question 1 of 2')

  await page.getByRole('radio', { name: 'Pre-order' }).check()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()

  // The countdown reaches its final minute and the timer says so.
  await expect(timer(page)).toBeVisible()
  expect(toSeconds(await timer(page).innerText())).toBeLessThanOrEqual(60)

  // No Submit is clicked: the exam must finish on its own.
  await expect(page.getByText('Exam time has ended.')).toBeVisible({ timeout: 100_000 })
  await expect(page.getByRole('radio', { name: 'Pre-order' })).toHaveCount(0)
  await expect(page.getByText(/your score|percentage|passed|failed/i)).toHaveCount(0)

  // The database agrees, the saved answer survived, and further changes are refused.
  const auth = { Authorization: `Bearer ${await apiToken(request, DEV_CANDIDATE)}` }
  const detail = (await (
    await request.get(`${API_BASE_URL}/api/v1/candidates/me/assessments/${id}`, { headers: auth })
  ).json()) as { latest_attempt_id: string; latest_attempt_status: string }
  expect(detail.latest_attempt_status).toBe('TIME_EXPIRED')

  const attempt = (await (
    await request.get(`${API_BASE_URL}/api/v1/candidates/me/attempts/${detail.latest_attempt_id}`, {
      headers: auth,
    })
  ).json()) as {
    status: string
    submitted_at: string | null
    answers: Array<{ selected_option_ids: string[] }>
    questions: Array<{ id: string; options: Array<{ id: string }> }>
  }
  expect(attempt.status).toBe('TIME_EXPIRED')
  expect(attempt.submitted_at).toBeNull()
  expect(attempt.answers[0].selected_option_ids).toHaveLength(1) // the answer was kept

  const rejected = await request.put(
    `${API_BASE_URL}/api/v1/candidates/me/attempts/${detail.latest_attempt_id}/answers/${attempt.questions[0].id}`,
    { headers: auth, data: { selected_option_ids: [] } },
  )
  expect(rejected.status()).toBe(409)

  // And submitting after the fact does not resurrect it.
  const late = await request.post(
    `${API_BASE_URL}/api/v1/candidates/me/attempts/${detail.latest_attempt_id}/submit`,
    { headers: auth },
  )
  expect(late.status()).toBe(409)
})

test('the deadline is the server\'s and cannot be moved by the client', async ({ request }) => {
  const title = unique('Fixed Clock')
  const { id } = await seedTimedExam(request, title, 30)
  const auth = { Authorization: `Bearer ${await apiToken(request, DEV_CANDIDATE)}` }

  // Timing sent by the client is ignored: there is no field for it on any request.
  const started = (await (
    await request.post(`${API_BASE_URL}/api/v1/candidates/me/assessments/${id}/attempts`, {
      headers: auth,
      data: {
        started_at: '2000-01-01T00:00:00Z',
        expires_at: '2099-01-01T00:00:00Z',
        remaining_seconds: 999_999,
      },
    })
  ).json()) as { id: string; expires_at: string; started_at: string; remaining_seconds: number }

  expect(new Date(started.started_at).getFullYear()).toBe(new Date().getFullYear())
  expect(started.remaining_seconds).toBeLessThanOrEqual(30 * 60)

  // Resuming reports the same deadline rather than a fresh one.
  const resumed = (await (
    await request.post(`${API_BASE_URL}/api/v1/candidates/me/assessments/${id}/attempts`, { headers: auth })
  ).json()) as { expires_at: string }
  expect(resumed.expires_at).toBe(started.expires_at)

  // Two submits are safe: the second returns the same finalized attempt.
  const url = `${API_BASE_URL}/api/v1/candidates/me/attempts/${started.id}/submit`
  const [a, b] = await Promise.all([request.post(url, { headers: auth }), request.post(url, { headers: auth })])
  const statuses = [a.status(), b.status()].sort()
  expect(statuses[0]).toBe(200) // at least one succeeds; a loser sees 200 (idempotent) or 409
  const finalized = (await (
    await request.get(`${API_BASE_URL}/api/v1/candidates/me/attempts/${started.id}/session`, { headers: auth })
  ).json()) as { status: string; submitted_at: string }
  expect(finalized.status).toBe('SUBMITTED')
  expect(finalized.submitted_at).toBeTruthy()
})

/** `mm:ss` or `h:mm:ss` to seconds. */
function toSeconds(display: string): number {
  const parts = display.trim().split(':').map(Number)
  return parts.reduce((total, part) => total * 60 + part, 0)
}
