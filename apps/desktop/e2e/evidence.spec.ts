import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'
import { DEV_ADMIN, DEV_CANDIDATE, signIn } from './helpers'
import { openDetails, seedExam, syntheticDevices, unique } from './proctoring-helpers'

/**
 * Phase 6B: the admin reads an attempt's evidence timeline — live and after submission. The candidate's
 * AI is the real Phase 5B/5C code driven by a TEST-ONLY scripted scene; the evidence is the server's,
 * derived from the stored events. Evidence explains what was observed — never intent.
 */

const FAST = {
  config: { inferenceIntervalMs: 100 },
  events: {
    allTiming: { startAfterMs: 800, minFrames: 3, resolveAfterMs: 800, minClearFrames: 3, cooldownMs: 500, unknownResolveMs: 1500 },
    statusStableMs: 500,
    frameStaleMs: 1000,
    tickMs: 250,
  },
}

async function candidatePage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, permissions: ['camera', 'microphone'] })
  const page = await context.newPage()
  await syntheticDevices(page)
  await page.addInitScript((value) => {
    ;(window as unknown as { __assessxAI: unknown }).__assessxAI = value
  }, { ...FAST, scene: { faces: 1 } })
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  return page
}

async function adminPage(browser: Browser, request: APIRequestContext): Promise<Page> {
  const admin = await (await browser.newContext({ viewport: { width: 1366, height: 1000 } })).newPage()
  await admin.goto('/')
  await signIn(admin, request, DEV_ADMIN)
  return admin
}

const setScene = (page: Page, scene: Record<string, unknown>) =>
  page.evaluate((value) => {
    ;(window as unknown as { __assessxAI: { scene: unknown } }).__assessxAI.scene = value
  }, scene)

test('an admin reads the evidence timeline: grouped, explained, traced to events — live and after submission', async ({ browser, request }) => {
  test.setTimeout(150_000)
  const title = unique('Evidence Exam')
  const exam = await seedExam(request, title, true)

  const candidate = await candidatePage(browser)
  await signIn(candidate, request, DEV_CANDIDATE)
  await openDetails(candidate, title)
  await candidate.getByRole('button', { name: 'Start Exam' }).click()
  await candidate.getByRole('button', { name: 'Start Exam' }).click()
  await expect(candidate.getByRole('banner').getByText(/^Question \d+ of \d+$/)).toBeVisible()

  // Face absent, and a blocked paste within the correlation window → one correlated episode.
  await setScene(candidate, { faces: 0 })
  await candidate.waitForTimeout(2500)
  await candidate.keyboard.press('Control+V')
  await setScene(candidate, { faces: 1 })
  await candidate.waitForTimeout(2000)

  // --- live, in the candidate detail view ----------------------------------------------------------
  const admin = await adminPage(browser, request)
  await admin.getByRole('link', { name: 'Monitoring' }).click()
  await admin.getByText(title).first().click()
  const section = admin.getByRole('dialog').getByRole('region', { name: 'Proctoring evidence' })
  const timeline = section.getByRole('list', { name: 'Evidence timeline' })
  await expect(timeline.getByText('Face not detected')).toBeVisible({ timeout: 20_000 })
  await expect(timeline.getByText('Paste blocked')).toBeVisible()
  await expect(section.locator('[data-evidence="episode"]').first()).toContainText('Correlated · 2 signals')

  await timeline.getByRole('button', { name: /Face not detected/ }).click()
  const details = section.locator('[data-evidence="details"]')
  await expect(details).toContainText('No face was detected in the camera view for a sustained interval.')
  await expect(details).toContainText('Source events:')
  await expect(section).toContainText('does not determine intent')
  await expect(section).not.toContainText(/cheated|guilty|fraud|violation/i)
  await admin.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()

  // --- after submission, from the results table ------------------------------------------------------
  await candidate.bringToFront()
  await candidate.getByRole('banner').getByRole('button', { name: 'Submit Exam' }).click()
  await candidate.getByRole('dialog').getByRole('button', { name: 'Submit Exam' }).click()
  await expect(candidate.getByRole('heading', { name: 'Exam submitted successfully.' })).toBeVisible()

  await admin.bringToFront()
  await admin.goto(`/#/admin/results/${exam.id}`)
  await admin.getByRole('button', { name: 'Risk & evidence' }).first().click()
  const dialog = admin.getByRole('dialog', { name: /Risk and evidence/ })
  const finished = dialog.getByRole('list', { name: 'Evidence timeline' })
  await expect(finished.getByText('Face not detected')).toBeVisible({ timeout: 15_000 })
  await expect(finished.getByText('Resolved').first()).toBeVisible()

  await admin.context().close()
  await candidate.context().close()
})
