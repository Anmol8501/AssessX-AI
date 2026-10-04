import { expect, test } from '@playwright/test'
import { DEV_ADMIN, signIn } from './helpers'
import { unique } from './proctoring-helpers'

/**
 * Coding assessments, stage C2, with the real code runner: an administrator writes a reference solution,
 * validates the test cases on the runner (Docker sandboxes), sees a broken test fail validation, fixes it,
 * validates again, and publishes.
 *
 * Needs the dev API started with RUNNER_TOKEN and CODING_EXECUTION_ENABLED=true and the runner
 * (`python -m assessx_runner`) running against it — so it only runs when ASSESSX_RUNNER_E2E=1.
 */

test.skip(!process.env.ASSESSX_RUNNER_E2E, 'needs the code runner (set ASSESSX_RUNNER_E2E=1)')

test('an admin validates test cases on the runner before publishing', async ({ page, request }) => {
  test.setTimeout(180_000)
  const title = unique('Runner Sum')
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await signIn(page, request, DEV_ADMIN)
  await expect(page).toHaveURL(/#\/admin$/)

  await page.getByRole('link', { name: 'Coding Problems' }).click()
  await page.getByRole('button', { name: '+ New problem' }).click()
  const form = page.getByRole('form', { name: 'New coding problem' })
  await form.getByLabel('Title').fill(title)
  await form.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()

  await page.getByLabel('Statement').fill('Read two integers and print their sum.')
  await page.getByRole('combobox', { name: 'Language' }).selectOption('python')
  await page.getByLabel('Reference solution').fill('a, b = map(int, input().split())\nprint(a + b)\n')
  await page.getByRole('button', { name: 'Save draft' }).click()
  await expect(page.getByText('all changes saved')).toBeVisible()

  const newTest = page.getByRole('form', { name: 'New test case' })
  await newTest.getByLabel('Input (stdin)').fill('1 2')
  await newTest.getByLabel('Expected output').fill('3')
  await newTest.getByRole('button', { name: 'Add test case' }).click()
  await newTest.getByLabel('Visibility').selectOption('HIDDEN')
  await newTest.getByLabel('Input (stdin)').fill('40 2')
  await newTest.getByLabel('Expected output').fill('41') // wrong on purpose
  await newTest.getByRole('button', { name: 'Add test case' }).click()
  await expect(page.getByRole('list', { name: 'Test cases' }).getByRole('listitem')).toHaveCount(2)
  await expect(page.getByRole('list', { name: 'Publishing issues' })).toContainText('Validate the test cases')

  // The broken hidden test fails validation.
  const validation = page.getByLabel('Validation', { exact: true })
  await validation.getByRole('button', { name: 'Validate test cases' }).click()
  await expect(validation.getByRole('status')).toContainText('Wrong answer · 1/2 tests', { timeout: 120_000 })
  await expect(validation.getByRole('list', { name: 'Validation results' })).toContainText('Test #2 (hidden): Wrong answer — got: 42')

  // Fix it: delete and re-add with the right answer, validate again, publish.
  const tests = page.getByRole('list', { name: 'Test cases' }).getByRole('listitem')
  await tests.nth(1).getByRole('button', { name: 'Delete' }).click()
  await expect(tests).toHaveCount(1)
  await newTest.getByLabel('Visibility').selectOption('HIDDEN')
  await newTest.getByLabel('Input (stdin)').fill('40 2')
  await newTest.getByLabel('Expected output').fill('42')
  await newTest.getByRole('button', { name: 'Add test case' }).click()
  await expect(tests).toHaveCount(2)
  await validation.getByRole('button', { name: 'Validate test cases' }).click()
  await expect(validation.getByRole('status')).toContainText('Accepted · 2/2 tests', { timeout: 120_000 })
  await expect(validation).toContainText('Validated', { timeout: 15_000 })  // refreshed without a reload
  await page.getByRole('button', { name: 'Publish v1' }).click()
  await expect(page.getByText('Published v1 — published versions never change')).toBeVisible()
})
