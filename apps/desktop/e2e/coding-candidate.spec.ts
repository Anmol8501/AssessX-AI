import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { API_BASE_URL, DEV_ADMIN, DEV_CANDIDATE, apiToken, signIn } from './helpers'
import { unique } from './proctoring-helpers'

/**
 * Coding assessments, stage C3: the candidate's coding page, with the real code runner.
 *
 * * A coding-only exam names its items "Problem 1", "Problem 2". The editor opens with the starter code.
 *   The candidate's code is autosaved and survives a reload.
 * * Run checks the sample. Submit checks every test, and the hidden ones appear only as a count. The
 *   submission appears in the history, and the navigator shows the problem as passed.
 * * A wrong answer shows "Not all tests passed".
 * * A mixed exam names its items Question 1, Coding 1, Question 3, in the administrator's order.
 *
 * Needs the dev API started with RUNNER_TOKEN and CODING_EXECUTION_ENABLED=true and the runner running,
 * so it only runs when ASSESSX_RUNNER_E2E=1.
 */

test.skip(!process.env.ASSESSX_RUNNER_E2E, 'needs the code runner (set ASSESSX_RUNNER_E2E=1)')

const HIDDEN_MARKER = '424242'

async function seed(request: APIRequestContext, title: string, type: 'CODING' | 'MIXED') {
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
  async function problem(name: string, op: '+' | '*') {
    const created = await post('/coding-problems', { title: `${name} ${title}` })
    const base = `/coding-problems/${created.id}/versions/${created.draft.id}`
    await patch(base, { statement: `Read a and b and print a ${op} b.`, languages: ['python', 'java'] })
    await post(`${base}/test-cases`, { visibility: 'PUBLIC', input: '2 3', expected_output: op === '+' ? '5' : '6' })
    await post(`${base}/test-cases`, { visibility: 'HIDDEN', input: '400000 24242', expected_output: op === '+' ? '424242' : '9696800000' })
    await post(`${base}/test-cases`, { visibility: 'HIDDEN', input: '-1 1', expected_output: op === '+' ? '0' : '-1' })
    await post(`${base}/publish`)
    return created.draft.id as string
  }
  const assessment = await post('/assessments', { title, assessment_type: type, duration_minutes: 30, total_marks: 20, passing_marks: 5 })
  if (type === 'MIXED') {
    await post(`/assessments/${assessment.id}/questions`, { type: 'TRUE_FALSE', text: 'A stack is LIFO.', marks: 5, options: [{ text: 'True', is_correct: true }, { text: 'False', is_correct: false }] })
    await post(`/assessments/${assessment.id}/coding-questions`, { problem_version_id: await problem('Sum', '+'), marks: 10 })
    await post(`/assessments/${assessment.id}/questions`, { type: 'TRUE_FALSE', text: 'A queue is FIFO.', marks: 5, options: [{ text: 'True', is_correct: true }, { text: 'False', is_correct: false }] })
  } else {
    await post(`/assessments/${assessment.id}/coding-questions`, { problem_version_id: await problem('Sum', '+'), marks: 10 })
    await post(`/assessments/${assessment.id}/coding-questions`, { problem_version_id: await problem('Product', '*'), marks: 10 })
  }
  await post(`/assessments/${assessment.id}/ready`)
  await post(`/assessments/${assessment.id}/publish`)
  const people = (await (await request.get(`${API_BASE_URL}/api/v1/candidates`, { headers: admin })).json()) as Array<{ id: string; email: string }>
  await post(`/assessments/${assessment.id}/assignments`, { candidate_ids: [people.find((p) => p.email === DEV_CANDIDATE.email)!.id] })
  return assessment.id as string
}

async function startExam(page: Page, request: APIRequestContext, id: string) {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await signIn(page, request, DEV_CANDIDATE)
  await expect(page).toHaveURL(/#\/candidate$/)
  await page.goto(`/#/candidate/exams/${id}`)
  await page.getByRole('button', { name: 'Start Exam' }).click()
  await expect(page).toHaveURL(/#\/candidate\/exams\/.+\/attempt$/)
}

/** Replaces the editor's text (CodeMirror is a contenteditable). */
async function typeCode(page: Page, code: string) {
  const editor = page.getByTestId('code-editor').locator('.cm-content')
  await editor.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Delete')
  await editor.fill(code)
}

test('a candidate solves coding problems: autosave, run, submit, history and statuses', async ({ page, request }) => {
  test.setTimeout(240_000)
  const id = await seed(request, unique('DSA Coding'), 'CODING')
  await startExam(page, request, id)

  const nav = page.getByRole('navigation', { name: 'Questions' })
  await expect(nav.getByRole('button', { name: 'Problem 1, not started' })).toBeVisible()
  await expect(nav.getByRole('button', { name: 'Problem 2, not started' })).toBeVisible()
  await expect(page.getByRole('banner')).toContainText('Problem 1 · 1 of 2')
  await expect(page.getByRole('region', { name: 'Problem' })).toContainText('Read a and b and print a + b.')
  await expect(page.getByTestId('code-editor')).toContainText('def solve()')

  // --- Write, autosave, survive a reload -----------------------------------------------------------------
  await typeCode(page, 'a, b = map(int, input().split())\nprint(a + b)\n')
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('All changes saved', { timeout: 15_000 })
  await expect(nav.getByRole('button', { name: 'Problem 1, in progress' })).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('code-editor')).toContainText('print(a + b)', { timeout: 15_000 })

  // --- Run, then submit ------------------------------------------------------------------------------------
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  const result = page.getByLabel('Execution result')
  await expect(result).toContainText('Run: Accepted · 1/1 tests passed', { timeout: 60_000 })
  await expect(result).toContainText('Expected output')

  await page.getByRole('button', { name: 'Submit', exact: true }).click()
  await page.locator('dialog[open]').getByRole('button', { name: 'Submit' }).click()
  await expect(result).toContainText('Submission: Accepted · 3/3 tests passed', { timeout: 90_000 })
  await expect(result).toContainText('Hidden tests: 2 of 2 passed.')
  const hiddenResults = page.getByRole('list', { name: 'Hidden test results' })
  await expect(hiddenResults.getByRole('listitem')).toHaveText(['Hidden test 1Passed', 'Hidden test 2Passed'])
  await expect(page.getByText(HIDDEN_MARKER)).toHaveCount(0) // hidden input/output never shown
  await page.getByRole('tab', { name: /Submissions/ }).click()
  await expect(page.getByRole('table', { name: 'Your submissions' })).toContainText('Accepted')
  await expect(nav.getByRole('button', { name: 'Problem 1, passed' })).toBeVisible({ timeout: 15_000 })

  // --- Problem 2: a wrong answer --------------------------------------------------------------------------
  await nav.getByRole('button', { name: /Problem 2/ }).click()
  await expect(page.getByRole('region', { name: 'Problem' })).toContainText('print a * b')
  await typeCode(page, 'a, b = map(int, input().split())\nprint(a + b)\n')
  await page.getByRole('button', { name: 'Submit', exact: true }).click()
  await page.locator('dialog[open]').getByRole('button', { name: 'Submit' }).click()
  await expect(page.getByLabel('Execution result')).toContainText('Submission: Wrong answer', { timeout: 90_000 })
  await expect(nav.getByRole('button', { name: 'Problem 2, not all tests passed' })).toBeVisible({ timeout: 15_000 })
})

test('a mixed exam keeps the administrator’s order and names each item', async ({ page, request }) => {
  test.setTimeout(120_000)
  const id = await seed(request, unique('Software Engineer'), 'MIXED')
  await startExam(page, request, id)
  const nav = page.getByRole('navigation', { name: 'Questions' })
  await expect(nav.getByRole('button', { name: /^Question 1, / })).toBeVisible()
  await expect(nav.getByRole('button', { name: /^Coding 1, / })).toBeVisible()
  await expect(nav.getByRole('button', { name: /^Question 3, / })).toBeVisible()
  await expect(page.getByRole('banner')).toContainText('Question 1 · 1 of 3')
  await nav.getByRole('button', { name: /^Coding 1, / }).click()
  await expect(page.getByTestId('coding-workspace')).toBeVisible()
  await expect(page.getByRole('banner')).toContainText('Coding 1 · 2 of 3')
})
