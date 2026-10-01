import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { API_BASE_URL, DEV_ADMIN, DEV_CANDIDATE, apiToken, signIn } from './helpers'
import { ME, candidateAuth, seedExam, unique } from './proctoring-helpers'

/**
 * Phase 6C: an administrator reviews a finished proctored attempt — opens it from the queue, starts
 * the review, confirms an evidence item, writes a note, records an outcome that differs from what
 * the risk level might suggest, then revises it; the earlier decision and the history remain. A
 * candidate can reach none of it. The attempt is driven through the API (the AI pipeline itself is
 * covered by the 5C/6B specs); every review step goes through the real admin UI.
 */

async function finishedProctoredAttempt(request: APIRequestContext, examId: string): Promise<string> {
  const headers = await candidateAuth(request)
  const started = await request.post(`${ME}/assessments/${examId}/attempts`, { headers })
  expect(started.ok()).toBeTruthy()
  const attemptId = ((await started.json()) as { id: string }).id
  const activated = await request.post(`${ME}/attempts/${attemptId}/proctoring/activate`, {
    headers,
    data: { camera: 'READY', microphone: 'READY' },
  })
  expect(activated.ok()).toBeTruthy()
  const episode = crypto.randomUUID()
  for (const event of [
    { event_type: 'MULTIPLE_FACES_DETECTED', metadata: { phase: 'started', episode_id: episode, face_count: 2 } },
    { event_type: 'PASTE_ATTEMPT', metadata: { shortcut: 'CTRL+V', blocked: true, channel: 'keyboard' } },
    { event_type: 'MULTIPLE_FACES_DETECTED', metadata: { phase: 'resolved', episode_id: episode, resolution: 'condition_cleared' } },
  ]) {
    const posted = await request.post(`${ME}/attempts/${attemptId}/proctoring/events`, {
      headers,
      data: { client_event_id: crypto.randomUUID(), ...event },
    })
    expect(posted.status(), await posted.text()).toBe(201)
  }
  expect((await request.post(`${ME}/attempts/${attemptId}/submit`, { headers })).ok()).toBeTruthy()
  return attemptId
}

async function adminPage(page: Page, request: APIRequestContext) {
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await signIn(page, request, DEV_ADMIN)
  await expect(page).toHaveURL(/#\/admin$/) // landed — later navigation cannot race the sign-in redirect
}

test('an admin reviews an attempt: evidence marked, note written, human outcome recorded and revised', async ({ page, request }) => {
  test.setTimeout(90_000)
  const title = unique('Review Exam')
  const exam = await seedExam(request, title, true)
  const attemptId = await finishedProctoredAttempt(request, exam.id)

  await page.setViewportSize({ width: 1440, height: 1100 })
  await adminPage(page, request)
  await page.getByRole('link', { name: 'Reviews' }).click()
  await page.getByLabel('Assessment').selectOption({ label: title })
  const queue = page.getByRole('table', { name: 'Review queue' })
  const row = queue.getByRole('row').filter({ hasText: title })
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('Unreviewed')
  await expect(row).toContainText(/Normal|Low|Medium|High/) // the system's risk signal, in its own column
  await row.getByRole('link').click()

  // --- the review screen: system signals on one side, the human review on the other ----------------
  await expect(page).toHaveURL(new RegExp(`/admin/reviews/${attemptId}$`))
  await expect(page.getByText('System-generated · signals for review, not a verdict')).toBeVisible()
  const panel = page.getByRole('region', { name: 'Administrative review' })
  await expect(panel).toContainText('Unreviewed')
  await panel.getByRole('button', { name: 'Start review' }).click()
  await expect(panel).toContainText('In review')
  await expect(panel).toContainText('Started by')

  // Confirm one evidence item; the mark is shown, the evidence itself is unchanged.
  const timeline = page.getByRole('region', { name: 'Proctoring evidence' }).getByRole('list', { name: 'Evidence timeline' })
  await timeline.getByRole('button', { name: /Multiple faces/ }).click()
  await page.getByRole('button', { name: 'Confirm observation' }).click()
  await expect(timeline.getByText('Observation confirmed')).toBeVisible()

  // A human note, attributed to the signed-in administrator.
  await panel.getByLabel('Add a note').fill('A second person appeared briefly; consistent with someone walking past.')
  await panel.getByRole('button', { name: 'Add note' }).click()
  const notes = panel.getByRole('list', { name: 'Review notes' })
  await expect(notes).toContainText('consistent with someone walking past')

  // Nothing is pre-selected: completing needs an explicit outcome and a rationale.
  const complete = panel.getByRole('button', { name: 'Complete review' })
  await expect(complete).toBeDisabled()
  await panel.getByRole('radio', { name: /Flagged for follow-up/ }).check()
  await expect(complete).toBeDisabled()
  await panel.getByLabel('Rationale').fill('Second face confirmed; refer for follow-up.')
  await complete.click()

  const outcome = panel.locator('[data-review="outcome"]')
  await expect(panel).toContainText('Reviewed')
  await expect(outcome).toContainText('Administrative outcome · human')
  await expect(outcome).toContainText('Flagged for follow-up')
  await expect(outcome).toContainText('Risk signal at decision · system')
  // Marks freeze once the outcome is recorded.
  await expect(page.getByRole('button', { name: 'Confirm observation' })).toHaveCount(0)

  // Revise: a new decision; the earlier one stays in the record.
  await panel.getByRole('button', { name: 'Revise outcome' }).click()
  await expect(panel.getByRole('radio', { name: /Flagged for follow-up/ })).toHaveCount(0) // same outcome is a note
  await panel.getByRole('radio', { name: /^Cleared/ }).check()
  await panel.getByLabel('Reason for the revision').fill('Invigilator confirmed the room was shared by arrangement.')
  await panel.getByRole('button', { name: 'Record revision' }).click()
  await expect(outcome).toContainText('Cleared')
  await expect(panel.getByRole('list', { name: 'Earlier decisions' })).toContainText('Revision 1: Flagged for follow-up — superseded')
  await panel.getByText(/Review history/).click()
  await expect(panel.getByRole('list', { name: 'Review history' })).toContainText('Revised the outcome: Flagged for follow-up → Cleared')
  // The human side uses administrative language only. (The 6A panel's own disclaimer — "not a
  // determination that the candidate cheated" — is on the system side and is expected.)
  await expect(panel).not.toContainText(/cheat|guilty|fraud/i)

  // Back in the queue, the human outcome sits beside — not instead of — the risk signal.
  await page.getByRole('button', { name: 'Review queue' }).click()
  await page.getByLabel('Assessment').selectOption({ label: title })
  await expect(queue.getByRole('row').filter({ hasText: title })).toContainText('Cleared')
  await expect(queue.getByRole('row').filter({ hasText: title })).toContainText('Reviewed')
})

test('a stale decision is refused and the review is reloaded, not overwritten', async ({ page, request }) => {
  test.setTimeout(60_000)
  const title = unique('Review Race Exam')
  const exam = await seedExam(request, title, true)
  const attemptId = await finishedProctoredAttempt(request, exam.id)

  await page.setViewportSize({ width: 1440, height: 1100 })
  await adminPage(page, request)
  await page.goto(`/#/admin/reviews/${attemptId}`)
  const panel = page.getByRole('region', { name: 'Administrative review' })
  await panel.getByRole('button', { name: 'Start review' }).click()
  await expect(panel).toContainText('In review')

  // Another administrator session completes the review first, through the API.
  const admin = { Authorization: `Bearer ${await apiToken(request, DEV_ADMIN)}` }
  const other = await request.post(`${API_BASE_URL}/api/v1/admin/attempts/${attemptId}/review/complete`, {
    headers: admin,
    data: { outcome: 'NO_ACTION', rationale: 'Decided elsewhere.', expected_version: 1 },
  })
  expect(other.ok()).toBeTruthy()

  await panel.getByRole('radio', { name: /Invalidated/ }).check()
  await panel.getByLabel('Rationale').fill('Stale decision.')
  await panel.getByRole('button', { name: 'Complete review' }).click()
  await expect(panel.getByRole('alert')).toContainText('was changed')
  await expect(panel.locator('[data-review="outcome"]')).toContainText('No action') // the first decision stands
})

test('a candidate cannot reach the review screens or the review API', async ({ page, request }) => {
  const title = unique('Review Guard Exam')
  const exam = await seedExam(request, title, true)
  const attemptId = await finishedProctoredAttempt(request, exam.id)
  const headers = await candidateAuth(request)

  for (const [method, path, data] of [
    ['get', '', undefined],
    ['get', `/${attemptId}/review`, undefined],
    ['post', `/${attemptId}/review`, undefined],
    ['post', `/${attemptId}/review/complete`, { outcome: 'CLEARED', rationale: 'x', expected_version: 1 }],
  ] as const) {
    const response = await request[method](`${API_BASE_URL}/api/v1/admin/attempts${path}`, { headers, data })
    expect(response.status()).toBe(403)
  }

  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await signIn(page, request, DEV_CANDIDATE)
  await page.goto(`/#/admin/reviews/${attemptId}`)
  await expect(page).not.toHaveURL(/\/admin\/reviews/)
  await expect(page.getByRole('region', { name: 'Administrative review' })).toHaveCount(0)
})
