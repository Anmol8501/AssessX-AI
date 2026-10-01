import { expect, test, type Browser, type APIRequestContext, type Page } from '@playwright/test'
import { API_BASE_URL, DEV_ADMIN, DEV_CANDIDATE, apiToken, signIn } from './helpers'
import { unique } from './proctoring-helpers'

/**
 * Phase 7A: an administrator configures an interview through the UI — details, two questions and a
 * follow-up — publishes it and assigns the candidate. The candidate takes it full-screen: questions in
 * order, the configured follow-up after question 1, a refresh mid-interview that returns the same
 * question (never advancing it), and completion. The admin then sees progress — not answers. Nothing
 * is scored: Phase 7A does not evaluate answers.
 */

async function freshPage(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage()
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  return page
}

async function signedIn(browser: Browser, request: APIRequestContext, admin: boolean): Promise<Page> {
  const page = await freshPage(browser)
  await signIn(page, request, admin ? DEV_ADMIN : DEV_CANDIDATE)
  await expect(page).toHaveURL(admin ? /#\/admin$/ : /#\/candidate$/)
  return page
}

async function addQuestion(page: Page, text: string) {
  await page.getByRole('button', { name: 'Add question' }).click()
  const form = page.getByLabel('New question')
  await form.getByLabel('Question', { exact: true }).fill(text)
  await form.getByLabel('Expected concepts / response dimensions').fill('memory, scheduling')
  await form.getByRole('button', { name: 'Save question' }).click()
  await expect(page.getByRole('list', { name: 'Interview questions' })).toContainText(text)
}

test('an admin configures an interview and a candidate takes it, with a follow-up and a refresh', async ({ browser, request }) => {
  test.setTimeout(120_000)
  const title = unique('AI Interview')

  // --- admin: configure, add questions and a follow-up, publish, assign ------------------------------
  const admin = await signedIn(browser, request, true)
  await admin.getByRole('link', { name: 'Interviews' }).click()
  await admin.getByRole('button', { name: 'New interview' }).click()
  const form = admin.getByRole('form', { name: 'Interview configuration' })
  await form.getByLabel('Title').fill(title)
  await form.getByLabel('Instructions').fill('Answer each question in your own words.')
  await form.getByLabel('Topics').fill('Python, Operating Systems')
  await form.getByLabel('Questions asked').fill('2')
  await form.getByLabel('Follow-up limit').fill('1')
  await form.getByRole('button', { name: 'Create interview' }).click()
  await expect(admin.getByRole('heading', { name: title })).toBeVisible()
  await expect(admin.getByRole('list', { name: 'Publishing issues' })).toContainText('only 0 active primary')

  await addQuestion(admin, 'Explain the difference between a process and a thread.')
  await addQuestion(admin, 'What does the Python GIL do?')
  await admin.getByRole('button', { name: 'Add follow-up' }).first().click()
  await admin.getByLabel('New follow-up').getByLabel('Follow-up question').fill('How does memory isolation differ between the two?')
  await admin.getByRole('button', { name: 'Save follow-up' }).click()
  await expect(admin.getByRole('list', { name: 'Interview questions' })).toContainText('How does memory isolation differ')

  await admin.getByRole('button', { name: 'Publish' }).click()
  await expect(admin.getByText('Published', { exact: true })).toBeVisible()
  await expect(admin.getByRole('button', { name: 'Add question' })).toHaveCount(0) // locked once published
  await admin.getByLabel(/· DEV2026001$/).check()
  await admin.getByRole('button', { name: /^Assign/ }).click()
  const assigned = admin.getByRole('list', { name: 'Assigned candidates' })
  await expect(assigned).toContainText('Not started')

  // --- candidate: take the interview ------------------------------------------------------------------
  const candidate = await signedIn(browser, request, false)
  await candidate.getByRole('link', { name: 'My Interviews' }).click()
  await candidate.getByRole('link', { name: title }).click()
  await expect(candidate.getByText('Answer each question in your own words.')).toBeVisible()
  await candidate.getByRole('link', { name: 'Start interview' }).click()

  const question = candidate.locator('[data-interview="question"]')
  await expect(question).toHaveText('Explain the difference between a process and a thread.')
  await expect(candidate.getByText('Question 1 of 2')).toBeVisible()
  await expect(candidate.getByRole('timer')).toBeVisible()
  await expect(candidate.locator('body')).not.toContainText('memory, scheduling') // expected concepts stay hidden
  const submit = candidate.getByRole('button', { name: 'Submit answer' })
  await expect(submit).toBeDisabled()
  await candidate.getByLabel('Your answer').fill('A process has its own address space; threads share their process memory.')
  await submit.click()

  // The configured follow-up comes next, numbered with its question.
  await expect(question).toHaveText('How does memory isolation differ between the two?')
  await expect(candidate.getByText('Follow-up to question 1')).toBeVisible()

  // A refresh mid-interview returns the same question — and keeps a typed draft.
  await candidate.getByLabel('Your answer').fill('Draft before refresh')
  await candidate.reload()
  await expect(question).toHaveText('How does memory isolation differ between the two?')
  await expect(candidate.getByLabel('Your answer')).toHaveValue('Draft before refresh')
  await candidate.getByLabel('Your answer').fill('Processes are isolated by the OS; threads are not isolated from each other.')
  await submit.click()

  await expect(question).toHaveText('What does the Python GIL do?')
  await expect(candidate.getByText('Question 2 of 2')).toBeVisible()
  await candidate.getByLabel('Your answer').fill('It lets only one thread execute Python bytecode at a time.')
  await submit.click()

  await expect(candidate.getByRole('heading', { name: 'Interview complete' })).toBeVisible()
  await expect(candidate.getByText(/All questions answered\. You answered 2 of 2 questions and 1 follow-up/)).toBeVisible()
  await expect(candidate.locator('body')).not.toContainText(/score|passed|failed|hire|reject/i)

  // Reopening shows the finished interview — no restart.
  await candidate.getByRole('button', { name: 'Back to My Interviews' }).click()
  await candidate.getByRole('link', { name: title }).click()
  await expect(candidate.getByText(/Completed — all questions answered/)).toBeVisible()
  await expect(candidate.getByRole('link', { name: /Start interview|Resume interview/ })).toHaveCount(0)

  // --- admin: progress only --------------------------------------------------------------------------
  await admin.reload()
  await expect(assigned).toContainText('Completed')
  await expect(assigned).toContainText('2/2 answered · 1 follow-up(s)')
  await expect(admin.locator('body')).not.toContainText('threads share their process memory')

  await admin.context().close()
  await candidate.context().close()
})

test('a candidate cannot reach interview configuration, by screen or by API', async ({ page, request }) => {
  const candidateAuth = { Authorization: `Bearer ${await apiToken(request, DEV_CANDIDATE)}` }
  expect((await request.get(`${API_BASE_URL}/api/v1/interviews`, { headers: candidateAuth })).status()).toBe(403)
  expect(
    (
      await request.post(`${API_BASE_URL}/api/v1/interviews`, {
        headers: candidateAuth,
        data: { title: 'x', interview_type: 'TECHNICAL', difficulty: 'EASY', duration_minutes: 10, question_count: 1 },
      })
    ).status(),
  ).toBe(403)
  const adminAuth = { Authorization: `Bearer ${await apiToken(request, DEV_ADMIN)}` }
  expect((await request.get(`${API_BASE_URL}/api/v1/candidates/me/interviews`, { headers: adminAuth })).status()).toBe(403)

  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await signIn(page, request, DEV_CANDIDATE)
  await expect(page).toHaveURL(/#\/candidate$/)
  await page.goto('/#/admin/interviews')
  await expect(page).not.toHaveURL(/\/admin\/interviews/)
})
