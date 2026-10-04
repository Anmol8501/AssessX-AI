import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'
import { API_BASE_URL, DEV_ADMIN, DEV_CANDIDATE, apiToken, signIn } from './helpers'
import { examDetail, openDetails, seedExam, syntheticDevices, unique } from './proctoring-helpers'

/**
 * Exam rules and exam control, end to end:
 * * the rules are shown before a proctored exam starts;
 * * leaving the exam window for more than 2 s is a tab switch: "Warning 1 of 2", "Warning 2 of 2"
 *   (the last), and the third locks the exam — the candidate sees a lock screen;
 * * an administrator releases it, locks and unlocks it from live monitoring, and ends the exam.
 * Leaving the window is simulated with the window's own blur/focus events, as the environment spec does.
 */

const counter = (page: Page) => page.getByRole('banner').getByText(/^Question \d+ of \d+$/)

async function newPage(browser: Browser, devices: boolean): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  const page = await context.newPage()
  if (devices) await syntheticDevices(page)
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  return page
}

/** Leaves the exam window for `ms`, then comes back. */
async function leave(page: Page, ms: number) {
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await page.waitForTimeout(ms)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
}

async function adminPost(request: APIRequestContext, attemptId: string, action: string) {
  const token = await apiToken(request, DEV_ADMIN)
  const response = await request.post(`${API_BASE_URL}/api/v1/admin/attempts/${attemptId}/${action}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {},
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  return response.json()
}

test('two warnings for leaving the exam window, then the exam locks until released', async ({ browser, request }) => {
  test.setTimeout(150_000)
  const title = unique('Rules Exam')
  const { id } = await seedExam(request, title, true)
  const candidate = await newPage(browser, true)
  await signIn(candidate, request, DEV_CANDIDATE)
  await openDetails(candidate, title)
  await candidate.getByRole('button', { name: 'Start Exam' }).click()

  // The rules come before the exam.
  const rules = candidate.getByLabel('Exam rules')
  await expect(rules).toContainText('2 warnings')
  await expect(rules).toContainText('Windows key')
  await candidate.getByRole('button', { name: 'Start Exam' }).click()
  await expect(counter(candidate)).toHaveText('Question 1 of 2')
  const attemptId = (await examDetail(request, id)).active_attempt_id!

  // A short blip is not a tab switch.
  await leave(candidate, 500)
  await candidate.waitForTimeout(3500)
  await expect(candidate.getByRole('alertdialog', { name: /Warning/ })).toHaveCount(0)

  // First and second switches: warnings.
  await leave(candidate, 2600)
  const first = candidate.getByRole('alertdialog', { name: 'Warning 1 of 2: you left the exam window' })
  await expect(first).toBeVisible({ timeout: 15_000 })
  await expect(first).toContainText('1 warning left')
  await first.getByRole('button', { name: 'I understand' }).click()

  await leave(candidate, 2700)
  const second = candidate.getByRole('alertdialog', { name: 'Warning 2 of 2: you left the exam window' })
  await expect(second).toBeVisible({ timeout: 15_000 })
  await expect(second).toContainText('last warning')
  await second.getByRole('button', { name: 'I understand' }).click()

  // Third: locked.
  await leave(candidate, 2800)
  const lock = candidate.getByTestId('exam-on-hold')
  await expect(lock).toBeVisible({ timeout: 15_000 })
  await expect(lock).toContainText('You left the exam window 3 times')
  await expect(lock).toContainText('Your answers are saved')

  // Released by an administrator: the candidate continues.
  await adminPost(request, attemptId, 'release')
  await expect(lock).toBeHidden({ timeout: 15_000 })
  await expect(counter(candidate)).toHaveText('Question 1 of 2')
  await candidate.context().close()
})

test('an administrator locks, unlocks and ends an exam from live monitoring', async ({ browser, request }) => {
  test.setTimeout(150_000)
  const title = unique('Control Exam')
  const { id } = await seedExam(request, title, true)
  const candidate = await newPage(browser, true)
  await signIn(candidate, request, DEV_CANDIDATE)
  await openDetails(candidate, title)
  await candidate.getByRole('button', { name: 'Start Exam' }).click()
  await candidate.getByRole('button', { name: 'Start Exam' }).click()
  await expect(counter(candidate)).toHaveText('Question 1 of 2')
  expect((await examDetail(request, id)).active_attempt_id).toBeTruthy()

  const admin = await newPage(browser, false)
  await signIn(admin, request, DEV_ADMIN)
  await admin.getByRole('link', { name: 'Monitoring' }).click()
  await expect(admin.getByText(title).first()).toBeVisible({ timeout: 15_000 })
  await admin.getByText(title).first().click()
  const control = admin.getByRole('region', { name: 'Exam control' })
  await expect(control).toContainText('Tab switches: 0')

  // Lock, with a private note.
  await control.getByRole('button', { name: 'Lock exam' }).click()
  const confirm = admin.locator('dialog[open]')
  await confirm.getByLabel('Note for administrators (optional)').fill('Phone visible on the desk.')
  await confirm.getByRole('button', { name: 'Lock exam' }).click()
  await expect(control).toContainText('Locked by an administrator', { timeout: 15_000 })
  const lock = candidate.getByTestId('exam-on-hold')
  await expect(lock).toBeVisible({ timeout: 15_000 })
  await expect(lock).toContainText('The exam supervisor has locked your exam.')
  await expect(candidate.getByText('Phone visible on the desk.')).toHaveCount(0)

  // Unlock.
  await control.getByRole('button', { name: 'Unlock exam' }).click()
  await expect(lock).toBeHidden({ timeout: 15_000 })

  // End the exam: the candidate's screen shows it finished.
  await control.getByRole('button', { name: 'End exam' }).click()
  await admin.locator('dialog[open]').getByRole('button', { name: 'End exam' }).click()
  await expect.poll(async () => (await examDetail(request, id)).active_attempt_id, { timeout: 15_000 }).toBeNull()

  await admin.context().close()
  await candidate.context().close()
})
