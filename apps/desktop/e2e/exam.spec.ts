import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { API_BASE_URL, apiToken, DEV_ADMIN, DEV_CANDIDATE, signIn } from './helpers'

/** Phase 3A: the candidate opens an assigned exam, starts an attempt, and answers questions. */

const unique = (label: string) => `${label} ${Date.now().toString().slice(-6)}`

/** The header's question counter. Scoped, because the question heading repeats the same text. */
const counter = (page: Page) => page.getByRole('banner').getByText(/^Question \d+ of \d+$/)

const MCQ = {
  type: 'MCQ',
  text: 'What is the time complexity of binary search?',
  marks: 2,
  options: [
    { text: 'O(n)', is_correct: false },
    { text: 'O(log n)', is_correct: true },
    { text: 'O(n^2)', is_correct: false },
    { text: 'O(1)', is_correct: false },
  ],
}
const MULTIPLE_SELECT = {
  type: 'MULTIPLE_SELECT',
  text: 'Which of these are sorting algorithms?',
  marks: 3,
  options: [
    { text: 'Merge Sort', is_correct: true },
    { text: 'Binary Search', is_correct: false },
    { text: 'Quick Sort', is_correct: true },
    { text: 'Breadth First Search', is_correct: false },
  ],
}
const TRUE_FALSE = {
  type: 'TRUE_FALSE',
  text: 'A stack follows last-in, first-out ordering.',
  marks: 1,
  options: [
    { text: 'True', is_correct: true },
    { text: 'False', is_correct: false },
  ],
}

/**
 * Publishes an exam and assigns it to the development candidate, through the API.
 * Authoring and publishing have their own specs; this one is about taking the exam.
 */
async function seedAssignedExam(
  request: APIRequestContext,
  title: string,
  durationMinutes = 45,
): Promise<{ id: string }> {
  const token = await apiToken(request, DEV_ADMIN)
  const headers = { Authorization: `Bearer ${token}` }

  const created = await request.post(`${API_BASE_URL}/api/v1/assessments`, {
    headers,
    data: {
      title,
      description: 'Seeded for the Phase 3A exam flow',
      instructions: 'Answer every question. Your answers are saved as you go.',
      duration_minutes: durationMinutes,
      total_marks: 6,
      passing_marks: 3,
    },
  })
  expect(created.ok()).toBeTruthy()
  const assessment = (await created.json()) as { id: string }

  for (const question of [MCQ, MULTIPLE_SELECT, TRUE_FALSE]) {
    const added = await request.post(`${API_BASE_URL}/api/v1/assessments/${assessment.id}/questions`, {
      headers,
      data: question,
    })
    expect(added.ok()).toBeTruthy()
  }

  const published = await request.post(`${API_BASE_URL}/api/v1/assessments/${assessment.id}/publish`, {
    headers,
  })
  expect(published.ok()).toBeTruthy()

  const candidates = (await (
    await request.get(`${API_BASE_URL}/api/v1/candidates`, { headers })
  ).json()) as Array<{ id: string; email: string }>
  const candidate = candidates.find((row) => row.email === DEV_CANDIDATE.email)
  expect(candidate).toBeDefined()

  const assigned = await request.post(`${API_BASE_URL}/api/v1/assessments/${assessment.id}/assignments`, {
    headers,
    data: { candidate_ids: [candidate!.id] },
  })
  expect(assigned.ok()).toBeTruthy()
  return assessment
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
})

test('a candidate opens an assigned exam, answers it, and the answers survive a reload', async ({
  page,
  request,
}) => {
  const title = unique('Exam Flow')
  const { id } = await seedAssignedExam(request, title)

  await signIn(page, request, DEV_CANDIDATE)

  // --- My Exams -> details -> instructions -------------------------------------------------
  await page.getByRole('link', { name: 'My Exams' }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await page
    .getByRole('heading', { name: title })
    .locator('xpath=ancestor::*[contains(@class,"rounded-lg")][1]')
    .getByRole('link', { name: 'View Details' })
    .click()

  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Instructions' })).toBeVisible()
  await expect(page.getByText('Answer every question.')).toBeVisible()

  // --- Start ---------------------------------------------------------------------------------
  await page.getByRole('button', { name: 'Start Exam' }).click()
  await expect(page).toHaveURL(/#\/candidate\/exams\/.+\/attempt$/)

  // The attempt is real server state, not client-side state.
  const candidateToken = await apiToken(request, DEV_CANDIDATE)
  const candidateAuth = { Authorization: `Bearer ${candidateToken}` }
  const detail = (await (
    await request.get(`${API_BASE_URL}/api/v1/candidates/me/assessments/${id}`, { headers: candidateAuth })
  ).json()) as { active_attempt_id: string | null; attempts_used: number }
  expect(detail.active_attempt_id).not.toBeNull()
  expect(detail.attempts_used).toBe(1)

  // --- The paper, in authored order ------------------------------------------------------------
  await expect(counter(page)).toHaveText('Question 1 of 3')
  await expect(page.getByText('What is the time complexity of binary search?')).toBeVisible()

  // --- Answer the MCQ --------------------------------------------------------------------------
  await page.getByRole('radio', { name: 'O(log n)' }).check()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()

  // --- Multiple select -------------------------------------------------------------------------
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByText('Which of these are sorting algorithms?')).toBeVisible()
  await page.getByRole('checkbox', { name: 'Merge Sort' }).check()
  await page.getByRole('checkbox', { name: 'Quick Sort' }).check()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()

  // --- Back, and change an answer ---------------------------------------------------------------
  await page.getByRole('button', { name: 'Previous' }).click()
  await expect(counter(page)).toHaveText('Question 1 of 3')
  await expect(page.getByRole('radio', { name: 'O(log n)' })).toBeChecked()
  await page.getByRole('radio', { name: 'O(1)' }).check()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()

  // --- Jump through the navigation panel ----------------------------------------------------------
  await page.getByRole('button', { name: /^Question 3,/ }).click()
  await expect(page.getByText('A stack follows last-in, first-out ordering.')).toBeVisible()
  await page.getByRole('radio', { name: 'True' }).check()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()

  // --- Reload: the attempt and every answer come back ------------------------------------------------
  await page.reload()
  await expect(counter(page)).toHaveText('Question 1 of 3')
  await expect(page.getByRole('radio', { name: 'O(1)' })).toBeChecked() // the changed answer, not the first
  await expect(page.getByRole('radio', { name: 'O(log n)' })).not.toBeChecked()

  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByRole('checkbox', { name: 'Merge Sort' })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'Quick Sort' })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'Binary Search' })).not.toBeChecked()

  await page.getByRole('button', { name: /^Question 3,/ }).click()
  await expect(page.getByRole('radio', { name: 'True' })).toBeChecked()

  // --- Nothing from Phase 3C is present ------------------------------------------------------------
  // Submitting and the countdown arrived with Phase 3B and are covered by session.spec.ts; a
  // score is still absent, because nothing calculates one.
  await expect(page.getByText(/your score|marks obtained|percentage|pass(ed)?/i)).toHaveCount(0)

  // There is no way out of a running exam: no Leave button, and no navigation around it.
  await expect(page.getByRole('button', { name: /leave/i })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'My Exams' })).toHaveCount(0)
})

test('the candidate UI and API never expose the answer key', async ({ page, request }) => {
  const title = unique('No Key')
  const { id } = await seedAssignedExam(request, title)

  const candidateToken = await apiToken(request, DEV_CANDIDATE)
  const headers = { Authorization: `Bearer ${candidateToken}` }

  const started = await request.post(`${API_BASE_URL}/api/v1/candidates/me/assessments/${id}/attempts`, {
    headers,
  })
  expect(started.ok()).toBeTruthy()
  const raw = await started.text()
  const attempt = JSON.parse(raw) as { id: string; questions: Array<Record<string, unknown>> }

  // The wire format carries no answer key and no worked solution.
  expect(raw).not.toContain('is_correct')
  expect(raw).not.toContain('explanation')
  for (const question of attempt.questions) {
    expect(Object.keys(question).sort()).toEqual(['id', 'marks', 'options', 'position', 'text', 'type'])
    for (const option of question.options as Array<Record<string, unknown>>) {
      expect(Object.keys(option).sort()).toEqual(['id', 'position', 'text'])
    }
  }

  // Nor does the rendered exam screen. Reached through the UI: a hash-only `goto` does not
  // re-route the app (the same caveat publishing.spec.ts records).
  await signIn(page, request, DEV_CANDIDATE)
  await page.getByRole('link', { name: 'My Exams' }).click()
  await page
    .getByRole('heading', { name: title })
    .locator('xpath=ancestor::*[contains(@class,"rounded-lg")][1]')
    .getByRole('link', { name: 'Resume Exam' })
    .click()
  await expect(counter(page)).toHaveText('Question 1 of 3')
  expect(await page.content()).not.toContain('is_correct')
})

test('starting twice resumes the same attempt rather than creating a second', async ({ request }) => {
  const title = unique('Resume')
  const { id } = await seedAssignedExam(request, title)

  const token = await apiToken(request, DEV_CANDIDATE)
  const headers = { Authorization: `Bearer ${token}` }
  const url = `${API_BASE_URL}/api/v1/candidates/me/assessments/${id}/attempts`

  // Two starts at once — the double-click and the retried request.
  const [first, second] = await Promise.all([request.post(url, { headers }), request.post(url, { headers })])
  expect(first.ok()).toBeTruthy()
  expect(second.ok()).toBeTruthy()
  expect((await first.json()).id).toBe((await second.json()).id)

  const detail = (await (
    await request.get(`${API_BASE_URL}/api/v1/candidates/me/assessments/${id}`, { headers })
  ).json()) as { attempts_used: number }
  expect(detail.attempts_used).toBe(1)
})

test("a candidate cannot reach another candidate's attempt", async ({ request }) => {
  const title = unique('Scoped Attempt')
  const { id } = await seedAssignedExam(request, title)

  const devToken = await apiToken(request, DEV_CANDIDATE)
  const started = await request.post(`${API_BASE_URL}/api/v1/candidates/me/assessments/${id}/attempts`, {
    headers: { Authorization: `Bearer ${devToken}` },
  })
  const attempt = (await started.json()) as { id: string; questions: Array<{ id: string }> }

  // A different candidate, assigned the same exam.
  const adminToken = await apiToken(request, DEV_ADMIN)
  const adminAuth = { Authorization: `Bearer ${adminToken}` }
  const rollNumber = `E2EA${Date.now().toString().slice(-8)}`
  const other = {
    kind: 'candidate' as const,
    rollNumber,
    email: `${rollNumber.toLowerCase()}@assessx.local`,
    password: 'AssessX-e2e-attempt1',
  }
  const created = await request.post(`${API_BASE_URL}/api/v1/candidates`, {
    headers: adminAuth,
    data: {
      name: `Other Candidate ${rollNumber}`,
      email: other.email,
      roll_number: rollNumber,
      initial_password: other.password,
    },
  })
  expect(created.ok()).toBeTruthy()
  await request.post(`${API_BASE_URL}/api/v1/assessments/${id}/assignments`, {
    headers: adminAuth,
    data: { candidate_ids: [(await created.json()).id] },
  })

  const otherAuth = { Authorization: `Bearer ${await apiToken(request, other)}` }
  const base = `${API_BASE_URL}/api/v1/candidates/me/attempts/${attempt.id}`

  // Reading, answering and flagging someone else's attempt are all simply not found.
  for (const response of await Promise.all([
    request.get(base, { headers: otherAuth }),
    request.put(`${base}/answers/${attempt.questions[0].id}`, {
      headers: otherAuth,
      data: { selected_option_ids: [] },
    }),
  ])) {
    expect(response.status()).toBe(404)
  }

  // And an admin has no candidate endpoints at all.
  expect((await request.get(base, { headers: adminAuth })).status()).toBe(403)
})
