import { expect, test, type Page } from '@playwright/test'
import { DEV_ADMIN, builderStep, signIn } from './helpers'
import { unique } from './proctoring-helpers'

/**
 * Coding assessments, stage C1, through the admin UI:
 * * the coding-problem library — create a problem, write the statement, add a public and a hidden test,
 *   save, publish; the preview shows the sample but never the hidden test;
 * * assessment types — a Coding-only assessment offers only "+ Add Coding Problem" and takes the problem
 *   from the library picker; an MCQ-only assessment offers only "+ Add Question"; a Mixed assessment
 *   offers both;
 * * publishing an assessment with coding questions waits for the code runner (stage C2).
 */

async function createAssessment(page: Page, title: string, type: 'MCQ only' | 'Coding only' | 'Mixed', total = 10) {
  await page.getByRole('link', { name: 'Assessments' }).first().click()
  await page.getByRole('link', { name: '+ Create Assessment' }).click()
  await page.getByRole('radio', { name: new RegExp(`^${type}`) }).check()
  await page.getByLabel('Title').fill(title)
  await page.getByLabel('Duration (minutes)').fill('60')
  await page.getByLabel('Total marks').fill(String(total))
  await page.getByLabel('Passing marks').fill('3')
  await page.getByRole('button', { name: 'Create Assessment' }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await builderStep(page, 'Questions')
}

test('an admin builds a coding problem and uses it in a coding-only assessment', async ({ page, request }) => {
  test.setTimeout(120_000)
  const problemTitle = unique('Sum Two Numbers')
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await signIn(page, request, DEV_ADMIN)
  await expect(page).toHaveURL(/#\/admin$/)

  // --- The library: create, fill, test cases, publish ---------------------------------------------------
  await page.getByRole('link', { name: 'Coding Problems' }).click()
  await page.getByRole('button', { name: '+ New problem' }).click()
  const form = page.getByRole('form', { name: 'New coding problem' })
  await form.getByLabel('Title').fill(problemTitle)
  await form.getByLabel('Tags').fill('Mathematics, Basics')
  await form.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('heading', { name: problemTitle })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Publishing issues' })).toContainText('Write the problem statement.')

  await page.getByLabel('Statement').fill('Read two integers a and b, and print a + b.')
  await page.getByLabel('Constraints').fill('-10^9 <= a, b <= 10^9')
  await page.getByRole('button', { name: 'Save draft' }).click()
  await expect(page.getByText('all changes saved')).toBeVisible()

  const newTest = page.getByRole('form', { name: 'New test case' })
  await newTest.getByLabel('Input (stdin)').fill('1 2')
  await newTest.getByLabel('Expected output').fill('3')
  await newTest.getByRole('button', { name: 'Add test case' }).click()
  await expect(page.getByRole('list', { name: 'Test cases' }).getByRole('listitem')).toHaveCount(1)
  await newTest.getByLabel('Visibility').selectOption('HIDDEN')
  await newTest.getByLabel('Input (stdin)').fill('777777 222222')
  await newTest.getByLabel('Expected output').fill('999999')
  await newTest.getByRole('button', { name: 'Add test case' }).click()
  await expect(page.getByRole('list', { name: 'Test cases' }).getByRole('listitem')).toHaveCount(2)

  await page.getByRole('button', { name: 'Publish v1' }).click()
  await expect(page.getByText('Published v1 — published versions never change')).toBeVisible()

  // The candidate's view: the sample, never the hidden test.
  await page.getByRole('button', { name: 'Show preview' }).click()
  const preview = page.getByRole('article', { name: 'Problem statement' })
  await expect(preview).toContainText('Read two integers a and b')
  await expect(preview).toContainText('1 hidden test')
  await expect(preview).not.toContainText('777777')

  // --- A coding-only assessment takes it from the library -------------------------------------------------
  const codingTitle = unique('DSA Coding Assessment')
  await createAssessment(page, codingTitle, 'Coding only')
  await expect(page.getByRole('button', { name: '+ Add Question' })).toHaveCount(0)
  await page.getByRole('button', { name: '+ Add Coding Problem' }).first().click()
  const picker = page.getByLabel('Coding problem library')
  await picker.getByLabel('Search').fill(problemTitle)
  await picker.getByRole('list', { name: 'Problems to add' }).getByRole('listitem').filter({ hasText: problemTitle }).getByRole('button', { name: 'Add' }).click()
  await expect(page.getByText(problemTitle).first()).toBeVisible()
  await expect(page.getByText('v1 · easy · python, c, cpp, java')).toBeVisible()

  // The coding rules include the editor's paste policy (stage C4), off until the administrator allows it.
  await builderStep(page, 'Settings')
  const paste = page.getByRole('checkbox', { name: 'Allow copy and paste inside the code editor' })
  await expect(paste).not.toBeChecked()
  await paste.check()
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toHaveCSS('opacity', '1')
  await page.reload()
  await builderStep(page, 'Settings')
  await expect(page.getByRole('checkbox', { name: 'Allow copy and paste inside the code editor' })).toBeChecked()

  // Publishing waits for the runner (stage C2). With a runner configured (ASSESSX_RUNNER_E2E) the
  // notice must not appear; coding-runner.spec.ts covers publishing in that mode.
  await builderStep(page, 'Review')
  const runnerMissing = page.getByText("Coding questions can't be published yet: the code runner has not been set up.")
  if (process.env.ASSESSX_RUNNER_E2E) await expect(runnerMissing).toHaveCount(0)
  else await expect(runnerMissing).toBeVisible()

  // --- MCQ-only offers only MCQs; Mixed offers both ----------------------------------------------------------
  await createAssessment(page, unique('Java Fundamentals'), 'MCQ only')
  await expect(page.getByRole('button', { name: '+ Add Question' }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: '+ Add Coding Problem' })).toHaveCount(0)

  await createAssessment(page, unique('Software Engineer Assessment'), 'Mixed')
  await expect(page.getByRole('button', { name: '+ Add Question' }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: '+ Add Coding Problem' }).first()).toBeVisible()
})
