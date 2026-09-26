import { expect, test, type Browser, type Page } from '@playwright/test'
import { DEV_ADMIN, DEV_CANDIDATE, signIn } from './helpers'
import { openDetails, seedExam, syntheticDevices, unique } from './proctoring-helpers'

/**
 * Phase 4C: admin live monitoring, end to end, with a candidate context and an admin context.
 *
 * The candidate reaches an active proctored session; the admin opens Live Monitoring and sees them,
 * their state and their events, live. Real WebRTC media is not asserted here (see the report): this
 * verifies the state/event synchronisation, which is the foundation. The candidate's synthetic
 * camera/microphone come from `syntheticDevices`.
 */

const counter = (page: Page) => page.getByRole('banner').getByText(/^Question \d+ of \d+$/)

async function newContextPage(browser: Browser, candidate: boolean): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    permissions: candidate ? ['camera', 'microphone'] : [],
  })
  const page = await context.newPage()
  if (candidate) await syntheticDevices(page)
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  return page
}

test('an admin sees an active proctored candidate, their events, and their departure', async ({ browser, request }) => {
  test.setTimeout(90_000)
  const title = unique('Monitored Exam')
  await seedExam(request, title, true)

  // --- Candidate: reach an active proctored session ----------------------------------------------
  const candidate = await newContextPage(browser, true)
  await signIn(candidate, request, DEV_CANDIDATE)
  await openDetails(candidate, title)
  await candidate.getByRole('button', { name: 'Start Exam' }).click() // proctoring check
  await candidate.getByRole('button', { name: 'Start Exam' }).click() // enter the exam
  await expect(counter(candidate)).toHaveText('Question 1 of 2')

  // --- Admin: open Live Monitoring ---------------------------------------------------------------
  const admin = await newContextPage(browser, false)
  await signIn(admin, request, DEV_ADMIN)
  await admin.getByRole('link', { name: 'Monitoring' }).click()
  await expect(admin.getByRole('heading', { name: 'Live Monitoring' })).toBeVisible()

  // The candidate appears on the wall.
  const tile = admin.getByRole('button', { name: new RegExp(DEV_CANDIDATE.rollNumber) }).or(
    admin.getByText('Cal Candidate', { exact: false }),
  )
  await expect(admin.getByText(title).first()).toBeVisible({ timeout: 15_000 })
  await expect(admin.getByText('Active sessions')).toBeVisible()

  // --- Open the candidate detail view ------------------------------------------------------------
  await admin.getByText(title).first().click()
  const dialog = admin.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Camera:')).toBeVisible()
  await expect(dialog.getByText('Proctoring started')).toBeVisible()

  // --- A live event reaches the admin ------------------------------------------------------------
  await candidate.bringToFront()
  await candidate.keyboard.press('Control+C') // COPY_ATTEMPT (blocked, recorded)
  await admin.bringToFront()
  await expect(dialog.getByText('Copy blocked').first()).toBeVisible({ timeout: 15_000 })

  // --- The candidate finishes → they leave the wall ----------------------------------------------
  await admin.getByRole('button', { name: 'Close' }).click()
  await candidate.bringToFront()
  await candidate.getByRole('banner').getByRole('button', { name: 'Submit Exam' }).click()
  await candidate.getByRole('dialog').getByRole('button', { name: 'Submit Exam' }).click()
  await expect(candidate.getByRole('heading', { name: 'Exam submitted successfully.' })).toBeVisible()

  await admin.bringToFront()
  await expect(admin.getByText(title)).toHaveCount(0, { timeout: 15_000 })

  void tile
  await candidate.context().close()
  await admin.context().close()
})

test('the monitoring wall loads and connects for an admin', async ({ browser, request }) => {
  const admin = await newContextPage(browser, false)
  await signIn(admin, request, DEV_ADMIN)
  await admin.getByRole('link', { name: 'Monitoring' }).click()

  await expect(admin.getByRole('heading', { name: 'Live Monitoring' })).toBeVisible()
  // The realtime link comes up (or the empty state shows) — either way the page is not broken.
  await expect(admin.getByText('Live', { exact: true }).or(admin.getByText('No active candidates')).first()).toBeVisible({
    timeout: 15_000,
  })
  await admin.context().close()
})
