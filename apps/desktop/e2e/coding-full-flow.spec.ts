import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { API_BASE_URL, DEV_ADMIN, DEV_CANDIDATE, apiToken, signIn } from './helpers'
import { unique } from './proctoring-helpers'

/**
 * Coding assessments, stage C5: a whole mixed exam, end to end, with the real code runner.
 *
 * The administrator's order is True/False, Coding, True/False, Coding (5 + 10 + 5 + 10 = 30 marks).
 * The candidate:
 * * answers Question 1 correctly and Question 3 wrongly (multiple choice: 5 / 10);
 * * solves Coding 1 in C++ (accepted: 10 / 10);
 * * gets Coding 2 partly right in Java — `int` overflows on the large hidden test, so 2 of 3 tests pass
 *   and partial scoring gives floor(10 × 2/3) = 6;
 * * submits the exam.
 *
 * The result is 21 / 30 with multiple choice 5 / 10 and coding 16 / 20. Each coding line names its
 * language and verdict, and no hidden data appears. The administrator sees the same sections and the
 * coding analytics. (MCQ-only and coding-only exams are covered by results.spec and coding-results.spec.)
 *
 * Needs the dev API started with RUNNER_TOKEN and CODING_EXECUTION_ENABLED=true and the runner running,
 * so it only runs when ASSESSX_RUNNER_E2E=1.
 */

test.skip(!process.env.ASSESSX_RUNNER_E2E, 'needs the code runner (set ASSESSX_RUNNER_E2E=1)')

const HIDDEN_BIG = '400000 24242'

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
  async function problem(name: string, op: '+' | '*') {
    const created = await post('/coding-problems', { title: `${name} ${title}` })
    const base = `/coding-problems/${created.id}/versions/${created.draft.id}`
    await patch(base, { statement: `Read a and b and print a ${op} b.`, languages: ['cpp', 'java'] })
    await post(`${base}/test-cases`, { visibility: 'PUBLIC', input: '2 3', expected_output: op === '+' ? '5' : '6' })
    await post(`${base}/test-cases`, { visibility: 'HIDDEN', input: HIDDEN_BIG, expected_output: op === '+' ? '424242' : '9696800000' })
    await post(`${base}/test-cases`, { visibility: 'HIDDEN', input: '-1 1', expected_output: op === '+' ? '0' : '-1' })
    await post(`${base}/publish`)
    return created.draft.id as string
  }
  const trueFalse = (text: string) => ({
    type: 'TRUE_FALSE',
    text,
    marks: 5,
    options: [
      { text: 'True', is_correct: true },
      { text: 'False', is_correct: false },
    ],
  })
  const assessment = await post('/assessments', { title, assessment_type: 'MIXED', duration_minutes: 30, total_marks: 30, passing_marks: 15 })
  await post(`/assessments/${assessment.id}/questions`, trueFalse('A stack is LIFO.'))
  await post(`/assessments/${assessment.id}/coding-questions`, { problem_version_id: await problem('Sum', '+'), marks: 10 })
  await post(`/assessments/${assessment.id}/questions`, trueFalse('A queue is FIFO.'))
  await post(`/assessments/${assessment.id}/coding-questions`, { problem_version_id: await problem('Product', '*'), marks: 10 })
  await patch(`/assessments/${assessment.id}`, { show_results: true })
  await post(`/assessments/${assessment.id}/ready`)
  await post(`/assessments/${assessment.id}/publish`)
  const people = (await (await request.get(`${API_BASE_URL}/api/v1/candidates`, { headers: admin })).json()) as Array<{ id: string; email: string }>
  await post(`/assessments/${assessment.id}/assignments`, { candidate_ids: [people.find((p) => p.email === DEV_CANDIDATE.email)!.id] })
  return assessment.id as string
}

async function solve(page: Page, language: string, code: string, verdict: string) {
  await page.getByLabel('Language').selectOption(language)
  const editor = page.getByTestId('code-editor').locator('.cm-content')
  await editor.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Delete')
  await editor.fill(code)
  await page.getByRole('button', { name: 'Submit', exact: true }).click()
  await page.locator('dialog[open]').getByRole('button', { name: 'Submit' }).click()
  await expect(page.getByLabel('Execution result')).toContainText(`Submission: ${verdict}`, { timeout: 120_000 })
}

test('a mixed exam end to end: multiple choice, C++ and Java, scored by section', async ({ browser, page, request }) => {
  test.setTimeout(360_000)
  const title = unique('Full Stack Mixed')
  const id = await seed(request, title)

  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await signIn(page, request, DEV_CANDIDATE)
  await expect(page).toHaveURL(/#\/candidate$/)
  await page.goto(`/#/candidate/exams/${id}`)
  await page.getByRole('button', { name: 'Start Exam' }).click()
  await expect(page).toHaveURL(/#\/candidate\/exams\/.+\/attempt$/)
  const nav = page.getByRole('navigation', { name: 'Questions' })

  // Question 1: right. Question 3: wrong.
  await page.getByRole('radio', { name: 'True' }).check()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
  await nav.getByRole('button', { name: /^Question 3, / }).click()
  await page.getByRole('radio', { name: 'False' }).check()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()

  // Coding 1 in C++: accepted.
  await nav.getByRole('button', { name: /^Coding 1, / }).click()
  await expect(page.getByRole('region', { name: 'Problem' })).toContainText('print a + b')
  await solve(page, 'cpp', '#include <iostream>\nint main() { long long a, b; std::cin >> a >> b; std::cout << a + b << "\\n"; }\n', 'Accepted · 3/3 tests passed')

  // Coding 2 in Java: int overflows on the large hidden test.
  await nav.getByRole('button', { name: /^Coding 2, / }).click()
  await expect(page.getByRole('region', { name: 'Problem' })).toContainText('print a * b')
  await solve(
    page,
    'java',
    'import java.util.*;\npublic class Main { public static void main(String[] x) { Scanner s = new Scanner(System.in); int a = s.nextInt(), b = s.nextInt(); System.out.println(a * b); } }\n',
    'Wrong answer · 2/3 tests passed',
  )
  // Each hidden test shows only its verdict: the large one overflowed, the other passed.
  await expect(page.getByRole('list', { name: 'Hidden test results' }).getByRole('listitem')).toHaveText([
    'Hidden test 1Wrong answer',
    'Hidden test 2Passed',
  ])
  await expect(page.getByLabel('Execution result')).not.toContainText(HIDDEN_BIG)
  await expect(nav.getByRole('button', { name: 'Coding 1, passed' })).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: 'Submit Exam' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Submit Exam' }).click()

  // --- The candidate's result ------------------------------------------------------------------------------
  await expect(page.getByText('Exam submitted successfully.')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('21 / 30')).toBeVisible()
  await expect(page.getByText('Passed', { exact: true })).toBeVisible()
  const sections = page.getByLabel('Score by section')
  await expect(sections).toContainText('Multiple choice5 / 10')
  await expect(sections).toContainText('Coding16 / 20')
  const breakdown = page.getByRole('list').filter({ hasText: 'Question 1' })
  await expect(breakdown).toContainText('3 / 3 tests passed · Accepted · C++')
  await expect(breakdown).toContainText('2 / 3 tests passed · Wrong answer · Java')
  await expect(breakdown.getByText('Partly correct', { exact: true })).toBeVisible()
  const html = await page.content()
  expect(html).not.toContain('9696800000')
  expect(html).not.toContain('24242')

  // --- The administrator --------------------------------------------------------------------------------------
  const admin = await browser.newPage()
  await admin.goto('/')
  await signIn(admin, request, DEV_ADMIN)
  await expect(admin).toHaveURL(/#\/admin$/)
  await admin.goto(`/#/admin/results/${id}`)
  await expect(admin.getByRole('heading', { name: title })).toBeVisible()
  await expect(admin.getByText('MCQ 5 / 10 · Code 16 / 20')).toBeVisible()
  const problems = admin.getByRole('region', { name: 'Coding analytics' }).getByRole('table', { name: 'Problems' })
  await expect(problems).toContainText(`Sum ${title}`)
  await expect(problems).toContainText(`Product ${title}`)
  await expect(problems).toContainText('C++ 1')
  await expect(problems).toContainText('Java 1')
  expect(await admin.content()).not.toContain('9696800000')
})
