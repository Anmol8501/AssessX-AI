import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { API_BASE_URL, apiToken, DEV_ADMIN, DEV_CANDIDATE, signIn } from './helpers'

/** Phase 3C: a finished attempt is evaluated, and the score reaches the candidate and the admin. */

const unique = (label: string) => `${label} ${Date.now().toString().slice(-6)}`

const counter = (page: Page) => page.getByRole('banner').getByText(/^Question \d+ of \d+$/)

/**
 * Three questions worth 2, 3 and 1 — deliberately unequal, so a score can only be right if the
 * per-question marks are respected rather than the questions counted.
 */
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
  text: 'A queue follows first-in, first-out ordering.',
  marks: 1,
  options: [
    { text: 'True', is_correct: true },
    { text: 'False', is_correct: false },
  ],
}

const TOTAL_MARKS = 6
const PASSING_MARKS = 3

interface Seeded {
  id: string
  title: string
}

/** Publishes an exam whose results are released to the candidate, and assigns it. */
async function seedExam(
  request: APIRequestContext,
  title: string,
  durationMinutes = 45,
  showResults = true,
): Promise<Seeded> {
  const headers = { Authorization: `Bearer ${await apiToken(request, DEV_ADMIN)}` }

  const created = await request.post(`${API_BASE_URL}/api/v1/assessments`, {
    headers,
    data: {
      title,
      instructions: 'Answer the questions.',
      duration_minutes: durationMinutes,
      total_marks: TOTAL_MARKS,
      passing_marks: PASSING_MARKS,
    },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  const assessment = (await created.json()) as { id: string }

  for (const question of [MCQ, MULTIPLE_SELECT, TRUE_FALSE]) {
    const added = await request.post(`${API_BASE_URL}/api/v1/assessments/${assessment.id}/questions`, {
      headers,
      data: question,
    })
    expect(added.ok(), await added.text()).toBeTruthy()
  }

  // Results are withheld by default; this is the setting the candidate-facing screens honour.
  const configured = await request.patch(`${API_BASE_URL}/api/v1/assessments/${assessment.id}`, {
    headers,
    data: { show_results: showResults },
  })
  expect(configured.ok(), await configured.text()).toBeTruthy()

  const published = await request.post(`${API_BASE_URL}/api/v1/assessments/${assessment.id}/publish`, {
    headers,
  })
  expect(published.ok(), await published.text()).toBeTruthy()

  const candidates = (await (
    await request.get(`${API_BASE_URL}/api/v1/candidates`, { headers })
  ).json()) as Array<{ id: string; email: string }>
  const candidate = candidates.find((row) => row.email === DEV_CANDIDATE.email)!
  const assigned = await request.post(`${API_BASE_URL}/api/v1/assessments/${assessment.id}/assignments`, {
    headers,
    data: { candidate_ids: [candidate.id] },
  })
  expect(assigned.ok(), await assigned.text()).toBeTruthy()
  return { id: assessment.id, title }
}

async function openExam(page: Page, title: string, action: string) {
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

test('a candidate answers, submits, and sees a score the admin can also see', async ({ page, request }) => {
  const title = unique('Scored Exam')
  const { id } = await seedExam(request, title)

  await signIn(page, request, DEV_CANDIDATE)
  await openExam(page, title, 'Start Exam')
  await expect(counter(page)).toHaveText('Question 1 of 3')

  // Q1 (2 marks) correct.
  await page.getByRole('radio', { name: 'Pre-order' }).check()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()

  // Q2 (3 marks) incorrect — one of the two correct options only, so not an exact set.
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('checkbox', { name: 'Merge Sort' }).check()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()

  // Q3 (1 mark) left unanswered.

  await page.getByRole('button', { name: 'Submit Exam' }).click()
  const confirm = page.getByRole('dialog')
  await expect(confirm.getByText(/You have answered 2 of 3 questions/)).toBeVisible()
  await confirm.getByRole('button', { name: 'Submit Exam' }).click()

  // --- The result -------------------------------------------------------------------------------
  await expect(page.getByText('Exam submitted successfully.')).toBeVisible()
  await expect(page.getByText('2 / 6')).toBeVisible() // marks, not a question count
  await expect(page.getByText('33.33%')).toBeVisible()
  await expect(page.getByText('Failed', { exact: true })).toBeVisible()

  const breakdown = page.getByRole('list').filter({ hasText: 'Question 1' })
  await expect(breakdown.getByText('Correct', { exact: true })).toBeVisible()
  await expect(breakdown.getByText('Incorrect', { exact: true })).toBeVisible()
  await expect(breakdown.getByText('Unanswered', { exact: true })).toBeVisible()

  // No answer key anywhere on the page.
  const html = await page.content()
  expect(html).not.toContain('is_correct')
  expect(html).not.toContain('Post-order') // an option of an unanswered question is not revealed

  // --- Reopening shows the result, not the exam ----------------------------------------------------
  await page.reload()
  await expect(page.getByText('Exam submitted successfully.')).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Pre-order' })).toHaveCount(0)

  // --- The stored evaluation matches, and the answers are locked -------------------------------------
  const auth = { Authorization: `Bearer ${await apiToken(request, DEV_CANDIDATE)}` }
  const detail = (await (
    await request.get(`${API_BASE_URL}/api/v1/candidates/me/assessments/${id}`, { headers: auth })
  ).json()) as { latest_attempt_id: string }
  const result = (await (
    await request.get(
      `${API_BASE_URL}/api/v1/candidates/me/attempts/${detail.latest_attempt_id}/result`,
      { headers: auth },
    )
  ).json()) as Record<string, unknown>
  expect(result.score).toBe(2)
  expect(result.maximum_score).toBe(6)
  expect(result.percentage).toBe('33.33')
  expect(result.passed).toBe(false)
  expect(result.correct_count).toBe(1)
  expect(result.incorrect_count).toBe(1)
  expect(result.unanswered_count).toBe(1)

  // --- My Exams offers the result rather than a restart -----------------------------------------------
  // The result screen sits outside the application shell, so the way back is its own button.
  await page.getByRole('button', { name: 'Back to My Exams' }).click()
  const card = page
    .getByRole('heading', { name: title })
    .locator('xpath=ancestor::*[contains(@class,"rounded-lg")][1]')
  await expect(card.getByRole('link', { name: 'View Result' })).toBeVisible()
  await expect(card.getByRole('link', { name: 'Resume Exam' })).toHaveCount(0)

  // --- The candidate's results list -------------------------------------------------------------------
  // Earlier runs leave their own results behind, so the assertion is scoped to this exam's row.
  await page.getByRole('link', { name: 'Results' }).click()
  const listed = page
    .getByText(title, { exact: true })
    .locator('xpath=ancestor::*[contains(@class,"rounded-lg")][1]')
  await expect(listed.getByText('2 / 6')).toBeVisible()
  await expect(listed.getByText('33.33%')).toBeVisible()

  // --- The admin sees the same numbers -------------------------------------------------------------------
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await signIn(page, request, DEV_ADMIN)
  await page.getByRole('link', { name: 'Results' }).click()
  await page.getByRole('link', { name: title }).click()

  const row = page.getByRole('row').filter({ hasText: 'DEV2026001' })
  await expect(row.getByText('2 / 6')).toBeVisible()
  await expect(row.getByText('33.33%')).toBeVisible()
  await expect(row.getByText('Failed')).toBeVisible()
})

test('an exam that runs out of time is still evaluated from the answers that were saved', async ({
  page,
  request,
}) => {
  // One minute is the shortest the assessment model allows, so this test really waits.
  test.setTimeout(150_000)
  const title = unique('Expired Scored')
  const { id } = await seedExam(request, title, 1)

  await signIn(page, request, DEV_CANDIDATE)
  await openExam(page, title, 'Start Exam')
  await expect(counter(page)).toHaveText('Question 1 of 3')

  await page.getByRole('radio', { name: 'Pre-order' }).check() // 2 marks
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()

  // Nothing is submitted: the clock finishes the exam, and the result appears anyway.
  await expect(page.getByText('Exam time has ended.')).toBeVisible({ timeout: 100_000 })
  await expect(page.getByText('2 / 6')).toBeVisible()
  await expect(page.getByText('33.33%')).toBeVisible()

  const auth = { Authorization: `Bearer ${await apiToken(request, DEV_CANDIDATE)}` }
  const detail = (await (
    await request.get(`${API_BASE_URL}/api/v1/candidates/me/assessments/${id}`, { headers: auth })
  ).json()) as { latest_attempt_id: string; latest_attempt_status: string }
  expect(detail.latest_attempt_status).toBe('TIME_EXPIRED')

  const result = (await (
    await request.get(
      `${API_BASE_URL}/api/v1/candidates/me/attempts/${detail.latest_attempt_id}/result`,
      { headers: auth },
    )
  ).json()) as Record<string, unknown>
  expect(result.score).toBe(2)
  expect(result.attempt_status).toBe('TIME_EXPIRED')
})

test('a withheld result is not shown to the candidate but is stored for the admin', async ({
  page,
  request,
}) => {
  const title = unique('Withheld')
  const { id } = await seedExam(request, title, 45, false)

  const auth = { Authorization: `Bearer ${await apiToken(request, DEV_CANDIDATE)}` }
  const started = (await (
    await request.post(`${API_BASE_URL}/api/v1/candidates/me/assessments/${id}/attempts`, { headers: auth })
  ).json()) as { id: string; questions: Array<{ id: string; options: Array<{ id: string }> }> }
  // Answer the first question correctly through the API.
  await request.put(
    `${API_BASE_URL}/api/v1/candidates/me/attempts/${started.id}/answers/${started.questions[0].id}`,
    { headers: auth, data: { selected_option_ids: [started.questions[0].options[0].id] } },
  )
  const submitted = await request.post(
    `${API_BASE_URL}/api/v1/candidates/me/attempts/${started.id}/submit`,
    { headers: auth },
  )
  expect(submitted.ok()).toBeTruthy()

  // The candidate is told the result exists but not what it is — and never shown a zero.
  const withheld = (await (
    await request.get(`${API_BASE_URL}/api/v1/candidates/me/attempts/${started.id}/result`, { headers: auth })
  ).json()) as Record<string, unknown>
  expect(withheld.released).toBe(false)
  expect(withheld.score).toBeNull()
  expect(withheld.passed).toBeNull()
  expect(withheld.questions).toEqual([])

  await signIn(page, request, DEV_CANDIDATE)
  await page.getByRole('link', { name: 'My Exams' }).click()
  await page
    .getByRole('heading', { name: title })
    .locator('xpath=ancestor::*[contains(@class,"rounded-lg")][1]')
    .getByRole('link', { name: 'View Result' })
    .click()
  await expect(page.getByText('Your result is not being shown')).toBeVisible()
  await expect(page.getByText(/\d+ \/ 6/)).toHaveCount(0)

  // The administrator sees the score regardless.
  const adminAuth = { Authorization: `Bearer ${await apiToken(request, DEV_ADMIN)}` }
  const table = (await (
    await request.get(`${API_BASE_URL}/api/v1/assessments/${id}/results`, { headers: adminAuth })
  ).json()) as { results: Array<{ score: number }> }
  expect(table.results[0].score).toBe(2)
})

test('results are scoped to their owner and to administrators', async ({ request }) => {
  const title = unique('Scoped Results')
  const { id } = await seedExam(request, title)

  const auth = { Authorization: `Bearer ${await apiToken(request, DEV_CANDIDATE)}` }
  const started = (await (
    await request.post(`${API_BASE_URL}/api/v1/candidates/me/assessments/${id}/attempts`, { headers: auth })
  ).json()) as { id: string }
  await request.post(`${API_BASE_URL}/api/v1/candidates/me/attempts/${started.id}/submit`, { headers: auth })

  // A different candidate, assigned the same exam.
  const adminAuth = { Authorization: `Bearer ${await apiToken(request, DEV_ADMIN)}` }
  const rollNumber = `E2ER${Date.now().toString().slice(-8)}`
  const other = {
    kind: 'candidate' as const,
    rollNumber,
    email: `${rollNumber.toLowerCase()}@assessx.local`,
    password: 'AssessX-e2e-result1',
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

  // Someone else's result is not found, and their own list is empty.
  const stolen = await request.get(
    `${API_BASE_URL}/api/v1/candidates/me/attempts/${started.id}/result`,
    { headers: otherAuth },
  )
  expect(stolen.status()).toBe(404)
  expect(await (await request.get(`${API_BASE_URL}/api/v1/candidates/me/results`, { headers: otherAuth })).json()).toEqual([])

  // The admin table is closed to candidates entirely.
  const forbidden = await request.get(`${API_BASE_URL}/api/v1/assessments/${id}/results`, {
    headers: otherAuth,
  })
  expect(forbidden.status()).toBe(403)

  // And a score cannot be supplied by the client.
  const forged = await request.post(`${API_BASE_URL}/api/v1/candidates/me/attempts/${started.id}/submit`, {
    headers: auth,
    data: { score: 6, percentage: 100, passed: true },
  })
  expect(forged.ok()).toBeTruthy()
  const real = (await (
    await request.get(`${API_BASE_URL}/api/v1/candidates/me/attempts/${started.id}/result`, { headers: auth })
  ).json()) as { score: number; passed: boolean }
  expect(real.score).toBe(0)
  expect(real.passed).toBe(false)
})
