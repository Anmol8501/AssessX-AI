import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'
import { DEV_ADMIN, DEV_CANDIDATE, signIn } from './helpers'
import { examDetail, openDetails, seedExam, syntheticDevices, unique } from './proctoring-helpers'

/**
 * Phase 6A: the admin sees an attempt's server-computed risk — live in the candidate detail view,
 * and after submission from the results table. The candidate's AI is the real Phase 5B/5C code
 * driven by a TEST-ONLY scripted scene (see ai-events.spec.ts); the risk itself is the server's.
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
  const admin = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage()
  await admin.goto('/')
  await signIn(admin, request, DEV_ADMIN)
  return admin
}

const setScene = (page: Page, scene: Record<string, unknown>) =>
  page.evaluate((value) => {
    ;(window as unknown as { __assessxAI: { scene: unknown } }).__assessxAI.scene = value
  }, scene)

test('an admin sees the attempt risk live and after submission — explained, never a verdict', async ({ browser, request }) => {
  test.setTimeout(150_000)
  const title = unique('Risk Exam')
  const exam = await seedExam(request, title, true)

  // --- Candidate: produce a few factual signals ---------------------------------------------------
  const candidate = await candidatePage(browser)
  await signIn(candidate, request, DEV_CANDIDATE)
  await openDetails(candidate, title)
  await candidate.getByRole('button', { name: 'Start Exam' }).click()
  await candidate.getByRole('button', { name: 'Start Exam' }).click()
  await expect(candidate.getByRole('banner').getByText(/^Question \d+ of \d+$/)).toBeVisible()
  expect((await examDetail(request, exam.id)).active_attempt_id).not.toBeNull()

  await setScene(candidate, { faces: 0 }) // no face → FACE_NOT_DETECTED episode
  await candidate.waitForTimeout(2500)
  await candidate.keyboard.press('Control+V') // PASTE_ATTEMPT (blocked)
  await setScene(candidate, { faces: 1 })
  await candidate.waitForTimeout(2000)

  // --- Admin, live: the risk panel in the candidate detail view -------------------------------------
  const admin = await adminPage(browser, request)
  await admin.getByRole('link', { name: 'Monitoring' }).click()
  await admin.getByText(title).first().click()
  const panel = admin.getByRole('dialog').getByRole('region', { name: 'Attempt risk' })
  const signals = panel.getByRole('list', { name: 'Contributing signals' })
  await expect(signals.getByText('Face not detected')).toBeVisible({ timeout: 20_000 })
  await expect(signals.getByText('Paste blocked')).toBeVisible()
  await expect(panel.getByText(/^Risk (Normal|Low|Medium|High)$/)).toBeVisible()
  await expect(panel.locator('[data-risk="score"]')).toContainText('/ 100')
  await expect(panel.locator('[data-risk="policy"]')).toContainText('Policy 6A-v1')
  await expect(panel.getByText('not a determination that the candidate cheated', { exact: false })).toBeVisible()
  await expect(panel).not.toContainText(/cheated:|guilty|fraud|rejected/i)
  await admin.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()

  // --- Candidate submits; the admin reviews the finished attempt from the results -------------------
  await candidate.bringToFront()
  await candidate.getByRole('banner').getByRole('button', { name: 'Submit Exam' }).click()
  await candidate.getByRole('dialog').getByRole('button', { name: 'Submit Exam' }).click()
  await expect(candidate.getByRole('heading', { name: 'Exam submitted successfully.' })).toBeVisible()

  await admin.bringToFront()
  await admin.goto(`/#/admin/results/${exam.id}`)
  await admin.getByRole('button', { name: 'Risk & evidence' }).first().click()
  const dialog = admin.getByRole('dialog', { name: /Risk and evidence/ })
  await expect(dialog.getByText('Score at end:')).toBeVisible({ timeout: 15_000 })
  await expect(dialog.getByRole('list', { name: 'Contributing signals' }).getByText('Face not detected')).toBeVisible()
  await expect(dialog.locator('[data-risk="peak"]')).toContainText(/Peak:\s*\d+/)

  await admin.context().close()
  await candidate.context().close()
})
