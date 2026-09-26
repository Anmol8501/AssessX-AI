import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { API_BASE_URL, apiToken, DEV_ADMIN, DEV_CANDIDATE } from './helpers'

/**
 * Shared set-up for the proctoring specs (Phase 4A/4B): seeding exams, synthetic camera and
 * microphone, and reading back what the server recorded.
 *
 * Devices: `getUserMedia` is replaced in the page with synthetic streams — a canvas for the camera,
 * an oscillator for the microphone — which a test can refuse, hide, or end on demand with the same
 * `DOMException`s and `ended` events real hardware produces. Edge's built-in fake devices are not
 * used: once the fake microphone opens, Edge intermittently ends the fake camera and reports no
 * camera for the rest of the browser session.
 */

export const unique = (label: string) => `${label} ${Date.now().toString().slice(-6)}`
export const ME = `${API_BASE_URL}/api/v1/candidates/me`

const QUESTIONS = [
  {
    type: 'MCQ',
    text: 'Which data structure is first-in, first-out?',
    marks: 2,
    options: [
      { text: 'Queue', is_correct: true },
      { text: 'Stack', is_correct: false },
    ],
  },
  {
    type: 'TRUE_FALSE',
    text: 'A binary search needs sorted input.',
    marks: 1,
    options: [
      { text: 'True', is_correct: true },
      { text: 'False', is_correct: false },
    ],
  },
]

/** Publishes an exam — proctored or not — and assigns it to the development candidate. */
export async function seedExam(
  request: APIRequestContext,
  title: string,
  proctored: boolean,
  durationMinutes = 30,
): Promise<{ id: string }> {
  const token = await apiToken(request, DEV_ADMIN)
  const headers = { Authorization: `Bearer ${token}` }

  const created = await request.post(`${API_BASE_URL}/api/v1/assessments`, {
    headers,
    data: { title, instructions: 'Seeded for the Phase 4A proctoring flow.', duration_minutes: durationMinutes, total_marks: 3, passing_marks: 2 },
  })
  expect(created.ok()).toBeTruthy()
  const assessment = (await created.json()) as { id: string }

  for (const question of QUESTIONS) {
    const added = await request.post(`${API_BASE_URL}/api/v1/assessments/${assessment.id}/questions`, {
      headers,
      data: question,
    })
    expect(added.ok()).toBeTruthy()
  }
  const configured = await request.patch(`${API_BASE_URL}/api/v1/assessments/${assessment.id}`, {
    headers,
    data: { proctoring_required: proctored, show_results: true },
  })
  expect(configured.ok()).toBeTruthy()
  expect((await request.post(`${API_BASE_URL}/api/v1/assessments/${assessment.id}/publish`, { headers })).ok()).toBeTruthy()

  const candidates = (await (await request.get(`${API_BASE_URL}/api/v1/candidates`, { headers })).json()) as Array<{
    id: string
    email: string
  }>
  const candidate = candidates.find((row) => row.email === DEV_CANDIDATE.email)
  expect(candidate).toBeDefined()
  const assigned = await request.post(`${API_BASE_URL}/api/v1/assessments/${assessment.id}/assignments`, {
    headers,
    data: { candidate_ids: [candidate!.id] },
  })
  expect(assigned.ok()).toBeTruthy()
  return assessment
}

export async function candidateAuth(request: APIRequestContext) {
  return { Authorization: `Bearer ${await apiToken(request, DEV_CANDIDATE)}` }
}

export async function examDetail(request: APIRequestContext, id: string) {
  const response = await request.get(`${ME}/assessments/${id}`, { headers: await candidateAuth(request) })
  expect(response.ok()).toBeTruthy()
  return (await response.json()) as { active_attempt_id: string | null; attempts_used: number; proctoring_required: boolean }
}

export async function proctoringSession(request: APIRequestContext, attemptId: string) {
  const response = await request.get(`${ME}/attempts/${attemptId}/proctoring`, { headers: await candidateAuth(request) })
  expect(response.ok()).toBeTruthy()
  return (await response.json()) as { status: string; camera_state: string; microphone_state: string; started_at: string | null }
}

/**
 * Replaces `getUserMedia` with synthetic devices a test can refuse, hide, or end. Installed before
 * the first page load of every test (init scripts only run when a document loads).
 */
export async function syntheticDevices(page: Page) {
  await page.addInitScript(() => {
    const control = {
      deny: { video: false, audio: false },
      missing: { video: false, audio: false },
      streams: [] as MediaStream[],
    }
    ;(window as unknown as { __media: typeof control }).__media = control

    const camera = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 320
      canvas.height = 180
      const context = canvas.getContext('2d')!
      let hue = 0
      const draw = () => {
        context.fillStyle = `hsl(${(hue += 7) % 360} 55% 45%)`
        context.fillRect(0, 0, canvas.width, canvas.height)
      }
      draw()
      window.setInterval(draw, 200)
      return canvas.captureStream(5)
    }
    const microphone = () => {
      const audio = new AudioContext()
      const tone = audio.createOscillator()
      const destination = audio.createMediaStreamDestination()
      tone.connect(destination)
      tone.start()
      return destination.stream
    }

    navigator.mediaDevices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      const kind = constraints?.video ? 'video' : 'audio'
      await new Promise((resolve) => setTimeout(resolve, 50)) // a device takes a moment to open
      if (control.deny[kind]) throw new DOMException('Permission denied', 'NotAllowedError')
      if (control.missing[kind]) throw new DOMException('Requested device not found', 'NotFoundError')
      const stream = kind === 'video' ? camera() : microphone()
      control.streams.push(stream)
      return stream
    }
  })
}

export type MediaControl = { deny: Record<'video' | 'audio', boolean>; missing: Record<'video' | 'audio', boolean>; streams: MediaStream[] }

export function setDevice(page: Page, kind: 'video' | 'audio', condition: 'deny' | 'missing', on: boolean) {
  return page.evaluate(
    ([k, c, value]) => {
      ;(window as unknown as { __media: MediaControl }).__media[c as 'deny' | 'missing'][k as 'video' | 'audio'] =
        value as boolean
    },
    [kind, condition, on] as const,
  )
}

/** The status cell of one row of the readiness check. */
export const check = (page: Page, label: string) => page.getByRole('status', { name: new RegExp(`^${label}:`) })

export async function openDetails(page: Page, title: string) {
  await page.getByRole('link', { name: 'My Exams' }).click()
  await page
    .getByRole('heading', { name: title })
    .locator('xpath=ancestor::*[contains(@class,"rounded-lg")][1]')
    .getByRole('link', { name: 'View Details' })
    .click()
  await expect(page.getByRole('heading', { name: 'Instructions' })).toBeVisible()
}

/** What the server recorded for an attempt, oldest first (development-only, admin-only view). */
export async function recordedEvents(request: APIRequestContext, attemptId: string) {
  const token = await apiToken(request, DEV_ADMIN)
  const response = await request.get(`${API_BASE_URL}/api/v1/dev/attempts/${attemptId}/proctoring-events`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(response.ok()).toBeTruthy()
  return (await response.json()) as Array<{
    event_type: string
    category: string
    source: string
    metadata: Record<string, unknown>
    recorded_at: string
  }>
}
