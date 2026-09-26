import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { DEV_CANDIDATE, signIn } from './helpers'
import { examDetail, openDetails, recordedEvents, seedExam, syntheticDevices, unique } from './proctoring-helpers'

/**
 * Phase 4B: exam environment enforcement and the proctoring event log, end to end.
 *
 * These run in Edge against the Vite dev server, i.e. the *browser* half of enforcement: in-page
 * restrictions (clipboard, context menu, print, developer-tool and browser shortcuts), HTML
 * fullscreen, focus tracking, the candidate notices and the event pipeline to the real backend.
 * The native half — Tauri fullscreen, always-on-top, capture exclusion and the Windows keyboard
 * guard for Alt+Tab / the Windows key / Print Screen — only exists in the packaged desktop app;
 * its shortcut table is unit-tested in Rust and the rest is on the manual checklist in
 * docs/PHASE-4-PLAN.md.
 *
 * What was recorded is read back through the development-only, admin-only event view.
 */

const counter = (page: Page) => page.getByRole('banner').getByText(/^Question \d+ of \d+$/)

async function enterProctoredExam(page: Page, request: APIRequestContext, title: string, minutes = 30) {
  const { id } = await seedExam(request, title, true, minutes)
  await signIn(page, request, DEV_CANDIDATE)
  await openDetails(page, title)
  await page.getByRole('button', { name: 'Start Exam' }).click()
  await expect(page.getByRole('heading', { name: 'Proctoring check' })).toBeVisible()
  await page.getByRole('button', { name: 'Start Exam' }).click()
  await expect(counter(page)).toHaveText('Question 1 of 2')
  const attemptId = (await examDetail(request, id)).active_attempt_id!
  return { id, attemptId }
}

async function typesOf(request: APIRequestContext, attemptId: string) {
  return (await recordedEvents(request, attemptId)).map((e) => e.event_type)
}

/** Whether a synthetic, cancelable event of this kind would be stopped by the page right now. */
function isBlocked(page: Page, kind: 'contextmenu' | 'copy' | 'ctrl-c') {
  return page.evaluate((k) => {
    const event =
      k === 'contextmenu'
        ? new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
        : k === 'copy'
          ? new Event('copy', { bubbles: true, cancelable: true })
          : new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', ctrlKey: true, bubbles: true, cancelable: true })
    document.body.dispatchEvent(event)
    return event.defaultPrevented
  }, kind)
}

const isFullscreen = (page: Page) => page.evaluate(() => document.fullscreenElement !== null)
const isLockedDown = (page: Page) => page.evaluate(() => document.body.classList.contains('exam-lockdown'))

test.beforeEach(async ({ page }) => {
  await syntheticDevices(page)
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
})

test('a proctored exam engages the environment and records what it could enforce', async ({ page, request }) => {
  const { attemptId } = await enterProctoredExam(page, request, unique('Env Engage'))

  await expect.poll(() => isFullscreen(page)).toBe(true)
  expect(await isLockedDown(page)).toBe(true)

  await expect.poll(() => typesOf(request, attemptId)).toEqual(['SESSION_STARTED', 'ENFORCEMENT_STATUS', 'FULLSCREEN_ENTER'])
  const status = (await recordedEvents(request, attemptId)).find((e) => e.event_type === 'ENFORCEMENT_STATUS')!
  expect(status.metadata.environment).toBe('browser')
  // Honest about the browser: the native protections are reported unavailable, not claimed.
  expect(status.metadata.capabilities).toMatchObject({
    fullscreen: 'ACTIVE',
    clipboard_guard: 'ACTIVE',
    system_shortcut_guard: 'UNAVAILABLE',
    capture_protection: 'UNAVAILABLE',
    print_guard: 'BEST_EFFORT',
  })
})

test('clipboard, context menu, print, developer tools and browser shortcuts are blocked and recorded', async ({
  page,
  request,
}) => {
  const { attemptId } = await enterProctoredExam(page, request, unique('Env Restrict'))
  await page.evaluate(() => ((window as unknown as { __marker: number }).__marker = 42))

  await page.keyboard.press('Control+C')
  await page.keyboard.press('Control+X')
  await page.keyboard.press('Control+V')
  await expect(page.getByText('Pasting is disabled during this assessment.')).toBeVisible()
  await page.getByText('Which data structure is first-in, first-out?').click({ button: 'right' })
  await expect(page.getByText('Right-click menus are disabled during this assessment.')).toBeVisible()
  await page.keyboard.press('Control+P')
  await page.keyboard.press('F12')
  await page.keyboard.press('Control+Shift+I')
  await page.keyboard.press('Control+F')
  await page.keyboard.press('F5')
  await page.keyboard.press('Control+R')

  // Reload shortcuts did nothing: the same page, with the same state, is still here.
  expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(42)
  // …and the exam itself still works with mouse and keyboard.
  await page.getByRole('radio', { name: 'Queue' }).check()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()

  await expect
    .poll(async () => (await recordedEvents(request, attemptId)).filter((e) => e.category === 'INPUT').length)
    .toBe(10)
  const input = (await recordedEvents(request, attemptId)).filter((e) => e.category === 'INPUT')
  expect(input.map((e) => [e.event_type, e.metadata.shortcut ?? null])).toEqual([
    ['COPY_ATTEMPT', 'CTRL+C'],
    ['CUT_ATTEMPT', 'CTRL+X'],
    ['PASTE_ATTEMPT', 'CTRL+V'],
    ['CONTEXT_MENU_ATTEMPT', null],
    ['PRINT_ATTEMPT', 'CTRL+P'],
    ['DEVTOOLS_ATTEMPT', 'F12'],
    ['DEVTOOLS_ATTEMPT', 'CTRL+SHIFT+I'],
    ['KEYBOARD_RESTRICTION_ATTEMPT', 'CTRL+F'],
    ['KEYBOARD_RESTRICTION_ATTEMPT', 'F5'],
    ['KEYBOARD_RESTRICTION_ATTEMPT', 'CTRL+R'],
  ])
  // Observations only: every event says what was attempted and that it was blocked — no content.
  for (const event of input) {
    expect(Object.keys(event.metadata).every((k) => ['shortcut', 'blocked', 'channel'].includes(k))).toBe(true)
    expect(event.metadata.blocked).toBe(true)
    expect(event.source).toBe('CLIENT')
  }
})

test('a burst of the same attempt is one event, not many', async ({ page, request }) => {
  const { attemptId } = await enterProctoredExam(page, request, unique('Env Burst'))

  for (let i = 0; i < 8; i++) await page.keyboard.press('Control+V')
  await page.keyboard.down('Control')
  await page.keyboard.down('KeyV') // held: auto-repeat
  await page.waitForTimeout(300)
  await page.keyboard.up('KeyV')
  await page.keyboard.up('Control')

  await expect.poll(() => typesOf(request, attemptId)).toContain('PASTE_ATTEMPT')
  await page.waitForTimeout(1000)
  expect((await typesOf(request, attemptId)).filter((t) => t === 'PASTE_ATTEMPT')).toHaveLength(1)
})

test('losing and regaining focus is recorded once each, with how long it lasted', async ({ page, request }) => {
  const { attemptId } = await enterProctoredExam(page, request, unique('Env Focus'))

  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'))
    window.dispatchEvent(new Event('blur')) // a second blur while away is the same departure
  })
  await page.waitForTimeout(400)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))

  await expect(page.getByText('AssessX must remain the active application during the exam.')).toBeVisible()
  await expect.poll(() => typesOf(request, attemptId)).toContain('FOCUS_REGAINED')
  const events = await recordedEvents(request, attemptId)
  expect(events.filter((e) => e.event_type === 'FOCUS_LOST')).toHaveLength(1)
  const regained = events.find((e) => e.event_type === 'FOCUS_REGAINED')!
  expect(regained.metadata.duration_ms).toBeGreaterThanOrEqual(300)
})

test('leaving fullscreen covers the exam until the candidate returns', async ({ page, request }) => {
  const { attemptId } = await enterProctoredExam(page, request, unique('Env Fullscreen'))
  await expect.poll(() => isFullscreen(page)).toBe(true)

  await page.evaluate(() => document.exitFullscreen())

  const prompt = page.getByRole('alertdialog')
  await expect(prompt.getByText('Please return to fullscreen to continue your assessment.')).toBeVisible()
  await prompt.getByRole('button', { name: 'Return to fullscreen' }).click()
  await expect(prompt).toHaveCount(0)
  await expect.poll(() => isFullscreen(page)).toBe(true)

  await expect.poll(() => typesOf(request, attemptId)).toContain('FULLSCREEN_RESTORED')
  const exit = (await recordedEvents(request, attemptId)).find((e) => e.event_type === 'FULLSCREEN_EXIT')!
  expect(exit.metadata).toMatchObject({ previous_state: 'fullscreen', current_state: 'windowed' })
})

test('an event that cannot be sent is kept and delivered once the connection returns', async ({ page, request }) => {
  const { attemptId } = await enterProctoredExam(page, request, unique('Env Offline'))
  await expect.poll(() => typesOf(request, attemptId)).toContain('FULLSCREEN_ENTER')

  await page.route('**/proctoring/events', (route) => route.abort('internetdisconnected'))
  await page.keyboard.press('Control+P')
  await expect(page.getByText('Printing is disabled during this assessment.')).toBeVisible()
  // Queued locally while offline.
  await expect
    .poll(() => page.evaluate((id) => localStorage.getItem(`assessx.proctoring-events.${id}`) ?? '', attemptId))
    .toContain('PRINT_ATTEMPT')
  expect(await typesOf(request, attemptId)).not.toContain('PRINT_ATTEMPT')

  await page.unroute('**/proctoring/events')
  await expect.poll(() => typesOf(request, attemptId), { timeout: 15_000 }).toContain('PRINT_ATTEMPT')
  expect((await typesOf(request, attemptId)).filter((t) => t === 'PRINT_ATTEMPT')).toHaveLength(1)
})

test('submitting releases every restriction and ends the event log', async ({ page, request }) => {
  const { attemptId } = await enterProctoredExam(page, request, unique('Env Submit'))
  await expect.poll(() => isFullscreen(page)).toBe(true)
  expect(await isBlocked(page, 'contextmenu')).toBe(true)

  await page.getByRole('banner').getByRole('button', { name: 'Submit Exam' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Submit Exam' }).click()
  await expect(page.getByRole('heading', { name: 'Exam submitted successfully.' })).toBeVisible()

  await expect.poll(() => isFullscreen(page)).toBe(false)
  expect(await isLockedDown(page)).toBe(false)
  expect(await isBlocked(page, 'contextmenu')).toBe(false)
  expect(await isBlocked(page, 'copy')).toBe(false)
  expect(await isBlocked(page, 'ctrl-c')).toBe(false)
  const types = await typesOf(request, attemptId)
  expect(types.at(-1)).toBe('SESSION_ENDED')
})

test('running out of time also releases every restriction', async ({ page, request }) => {
  test.setTimeout(150_000)
  const { attemptId } = await enterProctoredExam(page, request, unique('Env Timeout'), 1)
  await expect.poll(() => isFullscreen(page)).toBe(true)

  await expect(page.getByRole('heading', { name: 'Exam time has ended.' })).toBeVisible({ timeout: 100_000 })

  await expect.poll(() => isFullscreen(page)).toBe(false)
  expect(await isLockedDown(page)).toBe(false)
  expect(await isBlocked(page, 'contextmenu')).toBe(false)
  const ended = (await recordedEvents(request, attemptId)).find((e) => e.event_type === 'SESSION_ENDED')!
  expect(ended.metadata).toEqual({ attempt_status: 'TIME_EXPIRED' })
})

test('resuming re-engages the environment on the same session, without duplicates', async ({ page, request }) => {
  const { attemptId } = await enterProctoredExam(page, request, unique('Env Resume'))
  await expect.poll(() => typesOf(request, attemptId)).toEqual(['SESSION_STARTED', 'ENFORCEMENT_STATUS', 'FULLSCREEN_ENTER'])

  await page.reload() // the app restarting mid-exam
  await expect(page.getByRole('heading', { name: 'Proctoring check' })).toBeVisible()
  expect(await isLockedDown(page)).toBe(false) // nothing is locked on the check screen
  await page.getByRole('button', { name: 'Continue Exam' }).click()
  await expect(counter(page)).toHaveText('Question 1 of 2')

  await expect
    .poll(() => typesOf(request, attemptId))
    .toEqual(['SESSION_STARTED', 'ENFORCEMENT_STATUS', 'FULLSCREEN_ENTER', 'SESSION_RESUMED', 'ENFORCEMENT_STATUS', 'FULLSCREEN_ENTER'])
})

test('an exam that is not proctored is not locked down', async ({ page, request }) => {
  const title = unique('Env Unproctored')
  await seedExam(request, title, false)
  await signIn(page, request, DEV_CANDIDATE)
  await openDetails(page, title)
  await page.getByRole('button', { name: 'Start Exam' }).click()
  await expect(counter(page)).toHaveText('Question 1 of 2')

  expect(await isFullscreen(page)).toBe(false)
  expect(await isLockedDown(page)).toBe(false)
  expect(await isBlocked(page, 'contextmenu')).toBe(false)
  expect(await isBlocked(page, 'ctrl-c')).toBe(false)
})
