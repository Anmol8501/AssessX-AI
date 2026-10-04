import { expect, test, type APIRequestContext } from '@playwright/test'
import { API_BASE_URL, DEV_ADMIN, DEV_CANDIDATE, apiToken, signIn } from './helpers'
import { unique } from './proctoring-helpers'

/**
 * Coding assessments, stage C4: scoring and results, with the real code runner.
 *
 * * A submission that passes 2 of 3 equally weighted tests earns floor(10 × 2/3) = 6 marks (partial
 *   scoring). The candidate's result shows the coding section, "Partly correct", and the tests passed,
 *   verdict and language — never which tests, never the hidden data.
 * * The administrator's results show the section totals, and the coding analytics list the problem
 *   and the candidate (by name, not ranked).
 *
 * Needs the dev API started with RUNNER_TOKEN and CODING_EXECUTION_ENABLED=true and the runner running,
 * so it only runs when ASSESSX_RUNNER_E2E=1.
 */

test.skip(!process.env.ASSESSX_RUNNER_E2E, 'needs the code runner (set ASSESSX_RUNNER_E2E=1)')

const HIDDEN_MARKER = '424242'

async function seed(request: APIRequestContext, title: string) {
  const admin = { Authorization: `Bearer ${await apiToken(request, DEV_ADMIN)}` }
  const post = async (path: string, data?: object) => {
    const response = await request.post(`${API_BASE_URL}/api/v1${path}`, { headers: admin, data })
    expect(response.ok(), await response.text()).toBeTruthy()
    return response.json()
  }
  const patch = async (path: string, data: object) => {
    const response = await request.patch(`${API_BASE_URL}/api/v1${path}`, { headers: admin, data })
    expect(response.ok(), await response.text()).toBeTruthy()
  }
  const created = await post('/coding-problems', { title: `Sum ${title}` })
  const base = `/coding-problems/${created.id}/versions/${created.draft.id}`
  await patch(base, { statement: 'Read a and b and print a + b.', languages: ['python'] })
  await post(`${base}/test-cases`, { visibility: 'PUBLIC', input: '2 3', expected_output: '5' })
  await post(`${base}/test-cases`, { visibility: 'HIDDEN', input: '400000 24242', expected_output: HIDDEN_MARKER })
  await post(`${base}/test-cases`, { visibility: 'HIDDEN', input: '-1 1', expected_output: '0' })
  await post(`${base}/publish`)

  const assessment = await post('/assessments', { title, assessment_type: 'CODING', duration_minutes: 30, total_marks: 10, passing_marks: 5 })
  await post(`/assessments/${assessment.id}/coding-questions`, { problem_version_id: created.draft.id, marks: 10 })
  await patch(`/assessments/${assessment.id}`, { show_results: true })
  await post(`/assessments/${assessment.id}/ready`)
  await post(`/assessments/${assessment.id}/publish`)
  const people = (await (await request.get(`${API_BASE_URL}/api/v1/candidates`, { headers: admin })).json()) as Array<{ id: string; email: string }>
  await post(`/assessments/${assessment.id}/assignments`, { candidate_ids: [people.find((p) => p.email === DEV_CANDIDATE.email)!.id] })
  return assessment.id as string
}

test('a partly correct submission scores partial marks, shown by section with coding analytics', async ({ browser, page, request }) => {
  test.setTimeout(240_000)
  const title = unique('Partial Coding')
  const id = await seed(request, title)

  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await signIn(page, request, DEV_CANDIDATE)
  await expect(page).toHaveURL(/#\/candidate$/)
  await page.goto(`/#/candidate/exams/${id}`)
  await page.getByRole('button', { name: 'Start Exam' }).click()
  await expect(page).toHaveURL(/#\/candidate\/exams\/.+\/attempt$/)

  // Right for positive a, wrong for the "-1 1" hidden test: 2 of 3 tests.
  const editor = page.getByTestId('code-editor').locator('.cm-content')
  await editor.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Delete')
  await editor.fill('a, b = map(int, input().split())\nprint(a + b if a > 0 else 99)\n')
  await page.getByRole('button', { name: 'Submit', exact: true }).click()
  await page.locator('dialog[open]').getByRole('button', { name: 'Submit' }).click()
  await expect(page.getByLabel('Execution result')).toContainText('Submission: Wrong answer · 2/3 tests passed', { timeout: 90_000 })

  await page.getByRole('button', { name: 'Submit Exam' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Submit Exam' }).click()

  // --- The candidate's result ------------------------------------------------------------------------------
  await expect(page.getByText('Exam submitted successfully.')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByLabel('Score by section')).toContainText('6 / 10')
  const breakdown = page.getByRole('list').filter({ hasText: 'Question 1' })
  await expect(breakdown).toContainText('2 / 3 tests passed · Wrong answer · Python')
  await expect(breakdown.getByText('Partly correct', { exact: true })).toBeVisible()
  const html = await page.content()
  expect(html).not.toContain(HIDDEN_MARKER)
  expect(html).not.toContain('400000')

  // --- The administrator's results and coding analytics ----------------------------------------------------
  // A fresh page: the candidate's session lives in the first one.
  const admin = await browser.newPage()
  await admin.goto('/')
  await signIn(admin, request, DEV_ADMIN)
  await expect(admin).toHaveURL(/#\/admin$/)
  await admin.goto(`/#/admin/results/${id}`)
  await expect(admin.getByRole('heading', { name: title })).toBeVisible()
  await expect(admin.getByText('Code 6 / 10')).toBeVisible()
  const analytics = admin.getByRole('region', { name: 'Coding analytics' })
  await expect(analytics.getByRole('table', { name: 'Problems' })).toContainText(`Sum ${title}`)
  await expect(analytics.getByRole('table', { name: 'Problems' })).toContainText('Wrong answer')
  await expect(analytics.getByRole('table', { name: 'Coding by candidate' })).toContainText('6 / 10')
  expect(await admin.content()).not.toContain(HIDDEN_MARKER)
})
