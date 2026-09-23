import { expect, test, type Page } from '@playwright/test'
import { API_BASE_URL, apiToken, builderStep, DEV_ADMIN, DEV_CANDIDATE, signIn, storedToken } from './helpers'

/** Phase 2B: the assessment builder — basic info, questions, ordering, settings, review, READY. */

const unique = (label: string) => `${label} ${Date.now().toString().slice(-6)}`

/** Creates an assessment whose marks are left to be reconciled in the builder. */
async function newAssessment(page: Page, title: string, totalMarks = 6) {
  await page.getByRole('link', { name: 'Assessments' }).click()
  await page.getByRole('link', { name: '+ Create Assessment' }).click()
  await page.getByLabel('Title').fill(title)
  await page.getByLabel('Duration (minutes)').fill('60')
  await page.getByLabel('Total marks').fill(String(totalMarks))
  await page.getByLabel('Passing marks').fill('3')
  await page.getByRole('button', { name: 'Create Assessment' }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
}

/** Adds a question through the builder's question form. */
async function addQuestion(
  page: Page,
  { type, text, marks, options, correct }: { type: 'MCQ' | 'MULTIPLE_SELECT' | 'TRUE_FALSE'; text: string; marks: string; options?: string[]; correct?: number[] },
) {
  await page.getByRole('button', { name: '+ Add Question' }).first().click()
  if (type !== 'MCQ') await page.getByLabel('Question type').selectOption(type)
  await page.getByLabel('Question', { exact: true }).fill(text)
  await page.getByLabel('Marks').fill(marks)
  for (const [index, option] of (options ?? []).entries()) {
    await page.getByRole('textbox', { name: `Option ${index + 1}`, exact: true }).fill(option)
  }
  for (const index of correct ?? []) {
    const label = `Mark option ${index} correct`
    const control = type === 'MULTIPLE_SELECT' ? page.getByRole('checkbox', { name: label }) : page.getByRole('radio', { name: label })
    await control.click()
  }
  await page.getByRole('button', { name: 'Save question' }).click()
  await expect(page.getByText(text)).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
})

test('admin builds an assessment end to end and marks it ready', async ({ page, request }) => {
  await signIn(page, request, DEV_ADMIN)
  const title = unique('Builder Flow')
  await newAssessment(page, title)

  // --- Basic information ------------------------------------------------------------------
  await builderStep(page, 'Basic information')
  await page.getByLabel('Description').fill('Covers modules 1-3')
  await page.getByLabel('Instructions').fill('Answer every question.')
  await page.getByRole('button', { name: 'Save basic information' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()

  // --- Questions ---------------------------------------------------------------------------
  await builderStep(page, 'Questions')
  await addQuestion(page, { type: 'MCQ', text: 'Binary search complexity?', marks: '2', options: ['O(n)', 'O(log n)', 'O(n^2)', 'O(1)'], correct: [2] })
  await addQuestion(page, { type: 'MULTIPLE_SELECT', text: 'Which are sorting algorithms?', marks: '3', options: ['Merge Sort', 'BFS', 'Quick Sort', 'DFS'], correct: [1, 3] })
  await addQuestion(page, { type: 'TRUE_FALSE', text: 'A stack follows LIFO.', marks: '1' })
  await expect(page.getByText('3 question(s) · 6 of 6 marks allocated')).toBeVisible()

  // Edit a question's marks, then put them back so the totals still reconcile.
  await page.getByRole('button', { name: 'Edit' }).first().click()
  await page.getByLabel('Marks').fill('4')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('3 question(s) · 8 of 6 marks allocated')).toBeVisible()
  await page.getByRole('button', { name: 'Edit' }).first().click()
  await page.getByLabel('Marks').fill('2')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('3 question(s) · 6 of 6 marks allocated')).toBeVisible()

  // --- Preview -------------------------------------------------------------------------------
  await page.getByRole('button', { name: 'Preview' }).first().click()
  const preview = page.getByRole('dialog')
  await expect(preview.getByRole('heading', { name: 'Question 1 preview' })).toBeVisible()
  await expect(preview.getByText('Binary search complexity?')).toBeVisible()
  await expect(preview.getByText('O(log n)')).toBeVisible()
  await preview.getByRole('button', { name: 'Close preview' }).click()

  // --- Reorder ---------------------------------------------------------------------------------
  const questionOrder = async () =>
    (await page.getByRole('main').locator('li p.font-medium').allInnerTexts()).map((t) => t.replace(/^\d+\.\s*/, ''))
  expect(await questionOrder()).toEqual(['Binary search complexity?', 'Which are sorting algorithms?', 'A stack follows LIFO.'])

  await page.getByRole('button', { name: 'Move question 3 up' }).click()
  await expect
    .poll(questionOrder)
    .toEqual(['Binary search complexity?', 'A stack follows LIFO.', 'Which are sorting algorithms?'])

  // The order came from the server: reloading proves it was persisted.
  await page.reload()
  await builderStep(page, 'Questions')
  expect(await questionOrder()).toEqual(['Binary search complexity?', 'A stack follows LIFO.', 'Which are sorting algorithms?'])

  // --- Duplicate --------------------------------------------------------------------------------
  await page.getByRole('button', { name: 'Duplicate' }).first().click()
  await expect.poll(questionOrder).toEqual([
    'Binary search complexity?',
    'Binary search complexity?',
    'A stack follows LIFO.',
    'Which are sorting algorithms?',
  ])
  await expect(page.getByText('4 question(s) · 8 of 6 marks allocated')).toBeVisible()

  // Remove the copy again so the assessment can become ready.
  await page.getByRole('button', { name: 'Delete' }).nth(1).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText('3 question(s) · 6 of 6 marks allocated')).toBeVisible()

  // --- Settings ---------------------------------------------------------------------------------
  await builderStep(page, 'Settings')
  await page.getByLabel('Maximum attempts').fill('2')
  await page.getByLabel('Question navigation').selectOption('SEQUENTIAL')
  await page.getByLabel('Randomise question order').check()
  await page.getByLabel('Show results to the candidate after submission').check()
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()

  // --- Review and READY ----------------------------------------------------------------------
  await builderStep(page, 'Review')
  await expect(page.getByText('All checks passed.')).toBeVisible()
  await expect(page.getByText('Sequential — one question at a time')).toBeVisible()
  await page.getByRole('button', { name: 'Mark as Ready' }).click()

  await expect(page.getByRole('button', { name: 'Return to draft' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('main').getByText('Ready', { exact: true }).first()).toBeVisible()

  // Settings survived the round trip.
  await builderStep(page, 'Settings')
  await expect(page.getByLabel('Maximum attempts')).toHaveValue('2')
  await expect(page.getByLabel('Question navigation')).toHaveValue('SEQUENTIAL')
})

test('an incomplete assessment cannot be marked ready and says why', async ({ page, request }) => {
  await signIn(page, request, DEV_ADMIN)
  await newAssessment(page, unique('Incomplete'), 50)

  await builderStep(page, 'Review')

  await expect(page.getByText('Not ready yet')).toBeVisible()
  await expect(page.getByText('Add at least one question.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mark as Ready' })).toBeDisabled()

  // The "Fix" shortcut takes the admin to the step that owns the problem.
  await page.getByRole('button', { name: 'Fix' }).first().click()
  await expect(page.getByRole('button', { name: '+ Add Question' }).first()).toBeVisible()
})

test('marks that do not add up block readiness', async ({ page, request }) => {
  await signIn(page, request, DEV_ADMIN)
  await newAssessment(page, unique('Marks Mismatch'), 50)

  await builderStep(page, 'Questions')
  await addQuestion(page, { type: 'TRUE_FALSE', text: 'The sky is blue.', marks: '1' })

  await builderStep(page, 'Review')
  await expect(page.getByText(/add up to 1, but the assessment is set to 50/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mark as Ready' })).toBeDisabled()
})

test('a candidate cannot use any builder endpoint', async ({ page, request }) => {
  // Build a real assessment as the admin first.
  await signIn(page, request, DEV_ADMIN)
  await newAssessment(page, unique('Guarded'))
  await builderStep(page, 'Questions')
  await addQuestion(page, { type: 'TRUE_FALSE', text: 'Guarded question.', marks: '1' })

  const adminToken = await storedToken(page)
  const detail = await (
    await request.get(`${API_BASE_URL}/api/v1/assessments`, { headers: { Authorization: `Bearer ${adminToken}` } })
  ).json()
  const assessmentId = detail[0].id
  const questions = await (
    await request.get(`${API_BASE_URL}/api/v1/assessments/${assessmentId}/questions`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
  ).json()
  const questionId = questions[0].id

  // A candidate's own token, obtained from the API so no UI session juggling is involved.
  const token = await apiToken(request, DEV_CANDIDATE)
  const auth = { Authorization: `Bearer ${token}` }
  const base = `${API_BASE_URL}/api/v1/assessments/${assessmentId}`

  for (const response of await Promise.all([
    request.patch(base, { headers: auth, data: { max_attempts: 5 } }),
    request.post(`${base}/ready`, { headers: auth }),
    request.post(`${base}/draft`, { headers: auth }),
    request.post(`${base}/questions/reorder`, { headers: auth, data: { question_ids: [questionId] } }),
    request.post(`${base}/questions/${questionId}/duplicate`, { headers: auth }),
  ])) {
    expect(response.status()).toBe(403)
    expect((await response.json()).error.code).toBe('forbidden')
  }
})
