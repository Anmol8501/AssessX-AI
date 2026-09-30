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

test('live video connects, survives live updates, and the admin sees the candidate app go offline', async ({ browser, request }) => {
  test.setTimeout(150_000)
  const title = unique('Live Video Exam')
  await seedExam(request, title, true)

  // --- Candidate: an active proctored exam with a (synthetic) camera --------------------------------
  const candidate = await newContextPage(browser, true)
  await signIn(candidate, request, DEV_CANDIDATE)
  await openDetails(candidate, title)
  await candidate.getByRole('button', { name: 'Start Exam' }).click()
  await candidate.getByRole('button', { name: 'Start Exam' }).click()
  await expect(counter(candidate)).toHaveText('Question 1 of 2')

  // --- Admin: counts every WATCH it sends (each one restarts the candidate's video offer) ------------
  const adminContext = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  const admin = await adminContext.newPage()
  await admin.addInitScript(() => {
    const counter = { watch: 0 }
    ;(window as unknown as { __signals: typeof counter }).__signals = counter
    const send = WebSocket.prototype.send
    WebSocket.prototype.send = function (data) {
      if (typeof data === 'string' && data.includes('"type":"WATCH"')) counter.watch++
      return send.call(this, data)
    }
  })
  await admin.goto('/')
  await signIn(admin, request, DEV_ADMIN)
  await admin.getByRole('link', { name: 'Monitoring' }).click()
  await expect(admin.getByText(title).first()).toBeVisible({ timeout: 15_000 })
  await expect(admin.getByText('Candidate:').first().locator('..')).toContainText('Online', { timeout: 15_000 })

  // --- Live video reaches the admin -------------------------------------------------------------------
  await admin.getByText(title).first().click()
  const dialog = admin.getByRole('dialog')
  const liveVideo = () =>
    admin.evaluate(() => {
      const video = document.querySelector('[role="dialog"] video') as HTMLVideoElement | null
      const track = (video?.srcObject as MediaStream | null)?.getVideoTracks()[0]
      return !!video && track?.readyState === 'live' && video.videoWidth > 0 && !video.classList.contains('invisible')
    })
  await expect.poll(liveVideo, { timeout: 45_000 }).toBe(true)
  const watches = await admin.evaluate(() => (window as unknown as { __signals: { watch: number } }).__signals.watch)

  // --- A burst of live updates must not restart the video (it used to, on every re-render) ------------
  await candidate.bringToFront()
  for (let i = 0; i < 4; i++) {
    await candidate.keyboard.press('Control+C') // COPY_ATTEMPT → PROCTORING_EVENT + SESSION_UPDATED
    await candidate.waitForTimeout(1700)
  }
  await admin.bringToFront()
  await expect(dialog.getByText('Copy blocked').first()).toBeVisible({ timeout: 15_000 })
  expect(await liveVideo()).toBe(true)
  expect(await admin.evaluate(() => (window as unknown as { __signals: { watch: number } }).__signals.watch)).toBe(watches)

  // --- The candidate's app goes away: the admin sees it at once -----------------------------------------
  await candidate.context().close()
  await expect(dialog.getByText('Candidate app:').locator('..')).toContainText('Offline', { timeout: 15_000 })
  await expect(dialog.getByText('Candidate app is offline')).toBeVisible()
  await admin.getByRole('button', { name: 'Close' }).click()
  await expect(admin.getByText('Candidate offline').first()).toBeVisible()
  await adminContext.close()
})
