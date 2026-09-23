import { expect, test, type Page } from '@playwright/test'
import { API_BASE_URL, builderStep, DEV_ADMIN, DEV_CANDIDATE, hashOf, signIn, storedToken } from './helpers'

/** Phase 2A: an admin authors an assessment and its questions; a candidate cannot. */

const unique = (label: string) => `${label} ${Date.now().toString().slice(-6)}`

/** Navigates the way an admin does: sidebar → Assessments → + Create Assessment. */
async function openCreateForm(page: Page) {
  await page.getByRole('link', { name: 'Assessments' }).click()
  await expect.poll(() => hashOf(page)).toBe('#/admin/assessments')
  await page.getByRole('link', { name: '+ Create Assessment' }).click()
  await expect.poll(() => hashOf(page)).toBe('#/admin/assessments/new')
}

async function createAssessment(page: Page, title: string) {
  await openCreateForm(page)
  await page.getByLabel('Title').fill(title)
  await page.getByLabel('Description').fill('Mid-term examination covering Modules 1-3')
  await page.getByLabel('Instructions').fill('Answer all questions carefully.')
  await page.getByLabel('Duration (minutes)').fill('60')
  await page.getByLabel('Total marks').fill('50')
  await page.getByLabel('Passing marks').fill('20')
  await page.getByRole('button', { name: 'Create Assessment' }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
})

test('admin creates an assessment, adds all three question types, edits and deletes', async ({ page, request }) => {
  await signIn(page, request, DEV_ADMIN)
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()

  await openCreateForm(page)

  const title = unique('Data Structures Mid-Term')
  await page.getByLabel('Title').fill(title)
  await page.getByLabel('Duration (minutes)').fill('60')
  await page.getByLabel('Total marks').fill('50')
  await page.getByLabel('Passing marks').fill('20')
  await page.getByRole('button', { name: 'Create Assessment' }).click()

  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  // The builder opens on Basic information; questions live on their own step (Phase 2B).
  await builderStep(page, 'Questions')
  await expect(page.getByText('No questions yet')).toBeVisible()

  // --- MCQ ---------------------------------------------------------------------------------
  await page.getByRole('button', { name: '+ Add Question' }).first().click()
  await page.getByLabel('Question', { exact: true }).fill('What is the time complexity of binary search?')
  await page.getByLabel('Marks').fill('2')
  await page.getByRole('textbox', { name: 'Option 1', exact: true }).fill('O(n)')
  await page.getByRole('textbox', { name: 'Option 2', exact: true }).fill('O(log n)')
  await page.getByRole('textbox', { name: 'Option 3', exact: true }).fill('O(n^2)')
  await page.getByRole('textbox', { name: 'Option 4', exact: true }).fill('O(1)')
  await page.getByRole('radio', { name: 'Mark option 2 correct' }).click()
  await page.getByRole('button', { name: 'Save question' }).click()

  await expect(page.getByText('What is the time complexity of binary search?')).toBeVisible()
  await expect(page.getByText('Multiple choice · 2 marks')).toBeVisible()

  // --- Multiple select ---------------------------------------------------------------------
  await page.getByRole('button', { name: '+ Add Question' }).first().click()
  await page.getByLabel('Question type').selectOption('MULTIPLE_SELECT')
  await page.getByLabel('Question', { exact: true }).fill('Which are sorting algorithms?')
  await page.getByLabel('Marks').fill('3')
  await page.getByRole('textbox', { name: 'Option 1', exact: true }).fill('Merge Sort')
  await page.getByRole('textbox', { name: 'Option 2', exact: true }).fill('Binary Search')
  await page.getByRole('textbox', { name: 'Option 3', exact: true }).fill('Quick Sort')
  await page.getByRole('textbox', { name: 'Option 4', exact: true }).fill('BFS')
  await page.getByRole('checkbox', { name: 'Mark option 1 correct' }).click()
  await page.getByRole('checkbox', { name: 'Mark option 3 correct' }).click()
  await page.getByRole('button', { name: 'Save question' }).click()
  await expect(page.getByText('Which are sorting algorithms?')).toBeVisible()

  // --- True / False ------------------------------------------------------------------------
  await page.getByRole('button', { name: '+ Add Question' }).first().click()
  await page.getByLabel('Question type').selectOption('TRUE_FALSE')
  await page.getByLabel('Question', { exact: true }).fill('A stack follows LIFO.')
  await page.getByLabel('Marks').fill('1')
  await page.getByRole('button', { name: 'Save question' }).click()
  await expect(page.getByText('A stack follows LIFO.')).toBeVisible()
  await expect(page.getByText('True / False · 1 mark')).toBeVisible()

  // Counts come from the server, not the client.
  await expect(page.getByText('3 question(s) · 6 of 50 marks allocated')).toBeVisible()

  // --- Edit --------------------------------------------------------------------------------
  await page.getByRole('button', { name: 'Edit' }).first().click()
  await page.getByLabel('Marks').fill('5')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Multiple choice · 5 marks')).toBeVisible()

  // --- Delete ------------------------------------------------------------------------------
  await page.getByRole('button', { name: 'Delete' }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText('What is the time complexity of binary search?')).toHaveCount(0)
  await expect(page.getByText('2 question(s) · 4 of 50 marks allocated')).toBeVisible()
})

test('a created assessment persists across a reload and appears in the list', async ({ page, request }) => {
  await signIn(page, request, DEV_ADMIN)
  const title = unique('Computer Networks Quiz')
  await createAssessment(page, title)

  await page.getByRole('link', { name: 'Assessments' }).click()
  await page.reload()  // full boot: the session is restored from storage

  await expect(page.getByRole('link', { name: title })).toBeVisible()
})

test('the assessment form rejects invalid values before submitting', async ({ page, request }) => {
  await signIn(page, request, DEV_ADMIN)
  await openCreateForm(page)

  await page.getByLabel('Title').fill('x')
  await page.getByLabel('Passing marks').fill('999')
  await page.getByRole('button', { name: 'Create Assessment' }).click()

  await expect(page.getByText('Enter a title of at least 3 characters.')).toBeVisible()
  await expect(page.getByText('Passing marks cannot exceed total marks.')).toBeVisible()
  expect(hashOf(page)).toBe('#/admin/assessments/new')
})

test('the question form requires a correct answer', async ({ page, request }) => {
  await signIn(page, request, DEV_ADMIN)
  await createAssessment(page, unique('Validation Check'))

  await builderStep(page, 'Questions')
  await page.getByRole('button', { name: '+ Add Question' }).first().click()
  await page.getByLabel('Question type').selectOption('MULTIPLE_SELECT')
  await page.getByLabel('Question', { exact: true }).fill('Pick the right ones')
  await page.getByRole('textbox', { name: 'Option 1', exact: true }).fill('Alpha')
  await page.getByRole('textbox', { name: 'Option 2', exact: true }).fill('Beta')
  // Clear the answer carried over from the default selection, leaving none marked correct.
  await page.getByRole('checkbox', { name: 'Mark option 1 correct' }).click()
  await page.getByRole('button', { name: 'Save question' }).click()

  await expect(page.getByText('Select at least one correct answer.')).toBeVisible()

  // Marking one makes it valid again.
  await page.getByRole('checkbox', { name: 'Mark option 2 correct' }).click()
  await page.getByRole('button', { name: 'Save question' }).click()
  await expect(page.getByText('Pick the right ones')).toBeVisible()
})

test('a candidate cannot reach the assessment screens or the authoring API', async ({ page, request }) => {
  await signIn(page, request, DEV_CANDIDATE)
  await expect(page.getByRole('heading', { name: /Welcome, / })).toBeVisible()

  // The route guard bounces a candidate out of the admin area…
  await page.goto('/#/admin/assessments')
  await page.reload()
  await expect.poll(() => hashOf(page)).toBe('#/candidate')

  // …and the backend rejects the API directly with the candidate's real token.
  const token = await storedToken(page)
  const list = await request.get(`${API_BASE_URL}/api/v1/assessments`, { headers: { Authorization: `Bearer ${token}` } })
  expect(list.status()).toBe(403)

  const create = await request.post(`${API_BASE_URL}/api/v1/assessments`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title: 'Forbidden', duration_minutes: 10, total_marks: 10, passing_marks: 1 },
  })
  expect(create.status()).toBe(403)
  expect((await create.json()).error.code).toBe('forbidden')
})
