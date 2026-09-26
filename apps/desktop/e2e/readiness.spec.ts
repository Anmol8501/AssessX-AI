import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { DEV_CANDIDATE, signIn } from './helpers'
import { examDetail, openDetails, recordedEvents, seedExam, syntheticDevices, unique } from './proctoring-helpers'

/**
 * Phase 4B.5: the pre-exam device-readiness check (Standard mode).
 *
 * The real check is native (it inspects Windows applications), which a browser cannot do. Here a
 * scriptable readiness bridge is installed on `window` so the screen, the "Close All" flow, the
 * gate before the camera/microphone check, and the event log can be exercised end to end against
 * the real backend. The native process detection and graceful close are unit-tested in Rust and on
 * the manual checklist in docs/security/DEVICE-READINESS.md.
 */

const counter = (page: Page) => page.getByRole('banner').getByText(/^Question \d+ of \d+$/)

/**
 * Installs a fake readiness bridge whose scans return a queue of results. `closeApps` empties the
 * detected set (the graceful-close success case) unless a policy id is listed in `stubborn`.
 */
async function installReadiness(
  page: Page,
  scans: Array<Array<{ id: string; displayName: string; category: string }>>,
  stubborn: string[] = [],
) {
  await page.addInitScript(
    ([queue, stuck]) => {
      let calls = 0
      const w = window as unknown as { __assessxReadiness: unknown }
      const remembered: Array<{ id: string; displayName: string; category: string }> = []
      w.__assessxReadiness = {
        supported: true,
        scan: async () => {
          const result = queue[Math.min(calls, queue.length - 1)]
          calls += 1
          remembered.length = 0
          remembered.push(...result)
          return result
        },
        closeApps: async (ids: string[]) => {
          const remaining = remembered.filter((a) => ids.includes(a.id) && stuck.includes(a.id))
          remembered.length = 0
          remembered.push(...remaining)
          return remaining
        },
      }
    },
    [scans, stubborn] as const,
  )
}

async function typesOf(request: APIRequestContext, attemptId: string) {
  return (await recordedEvents(request, attemptId)).map((e) => e.event_type)
}

const CHROME = { id: 'chrome', displayName: 'Google Chrome', category: 'browser' }
const NOTEPAD = { id: 'notepad', displayName: 'Notepad', category: 'other' }

test.beforeEach(async ({ page }) => {
  await syntheticDevices(page)
})

async function goToReadiness(page: Page, request: APIRequestContext, title: string) {
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await signIn(page, request, DEV_CANDIDATE)
  await openDetails(page, title)
  await page.getByRole('button', { name: 'Start Exam' }).click()
}

test('a clean device goes straight to the camera and microphone check', async ({ page, request }) => {
  const title = unique('Ready Clean')
  await seedExam(request, title, true)
  await installReadiness(page, [[]])
  await goToReadiness(page, request, title)

  await expect(page.getByRole('heading', { name: 'Your device is ready' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Proctoring check' })).toBeVisible()
})

test('prohibited apps block the exam, close, and then it proceeds — all recorded', async ({ page, request }) => {
  const title = unique('Ready Close')
  const { id } = await seedExam(request, title, true)
  // First scan finds Chrome + Notepad; after Close All, the re-scan is clean.
  await installReadiness(page, [[CHROME, NOTEPAD], []])
  await goToReadiness(page, request, title)

  await expect(page.getByRole('heading', { name: 'Prepare your device' })).toBeVisible()
  await expect(page.getByText('Google Chrome')).toBeVisible()
  await expect(page.getByText('Notepad')).toBeVisible()
  // Cannot skip the check: the only way on is to close (there is no Continue while blocked).
  await expect(page.getByRole('button', { name: 'Continue' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Close All Detected Apps' }).click()
  await expect(page.getByRole('heading', { name: 'Your device is ready' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Proctoring check' })).toBeVisible()

  // Enter the exam so the buffered readiness events reach the server.
  await page.getByRole('button', { name: 'Start Exam' }).click()
  await expect(counter(page)).toHaveText('Question 1 of 2')
  const attemptId = (await examDetail(request, id)).active_attempt_id!

  await expect.poll(() => typesOf(request, attemptId)).toContain('DEVICE_CHECK_PASSED')
  const events = await recordedEvents(request, attemptId)
  const readiness = events.filter((e) => e.category === 'SYSTEM' && e.event_type.startsWith('DEVICE') || e.event_type.includes('APP'))
  const summary = readiness.map((e) => [e.event_type, e.metadata.app ?? e.metadata.app_count ?? null])
  expect(summary).toEqual([
    ['DEVICE_CHECK_STARTED', null],
    ['PROHIBITED_APP_DETECTED', 'chrome'],
    ['PROHIBITED_APP_DETECTED', 'notepad'],
    ['APP_CLOSE_REQUESTED', 'chrome'],
    ['APP_CLOSE_REQUESTED', 'notepad'],
    ['APP_CLOSED', 'chrome'],
    ['APP_CLOSED', 'notepad'],
    ['DEVICE_CHECK_PASSED', 0],
  ])
  // The app names are policy ids only — no window titles, paths or command lines.
  for (const e of readiness) {
    expect(Object.keys(e.metadata).every((k) => ['app', 'app_category', 'app_count'].includes(k))).toBe(true)
  }
})

test('an app that will not close is reported and keeps the exam blocked', async ({ page, request }) => {
  const title = unique('Ready Stubborn')
  await seedExam(request, title, true)
  // Chrome refuses to close; it is still detected after Close All.
  await installReadiness(page, [[CHROME], [CHROME]], ['chrome'])
  await goToReadiness(page, request, title)

  await page.getByRole('button', { name: 'Close All Detected Apps' }).click()
  await expect(page.getByText(/could not be closed automatically/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Prepare your device' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue' })).toHaveCount(0)
})

test('an unproctored exam has no device-readiness step', async ({ page, request }) => {
  const title = unique('Ready Unproctored')
  await seedExam(request, title, false)
  await installReadiness(page, [[CHROME]]) // present, but must be ignored for an unproctored exam
  await goToReadiness(page, request, title)

  await expect(counter(page)).toHaveText('Question 1 of 2')
  await expect(page.getByRole('heading', { name: 'Prepare your device' })).toHaveCount(0)
})
