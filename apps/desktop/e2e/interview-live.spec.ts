import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'
import { API_BASE_URL, DEV_ADMIN, DEV_CANDIDATE, apiToken, signIn } from './helpers'
import { unique } from './proctoring-helpers'

/**
 * Phase 7D: a live video interview, end to end, with an administrator context and a candidate context.
 *
 * The administrator starts the call from the interview's candidates; the candidate joins from their
 * interview page; video flows both ways (peer-to-peer — the server only relays signaling); they chat;
 * the candidate shares their screen; the administrator mutes, writes a private note and ends the call; the
 * call's record shows its chat, the note and the duration. The candidate never sees the question guide or
 * the notes, and cannot rejoin an ended call.
 *
 * Devices are synthetic (a canvas camera, an oscillator microphone, a canvas "screen"), installed before
 * the app loads, so no hardware or permission prompt is involved.
 */

async function callDevices(page: Page) {
  await page.addInitScript(() => {
    const canvasStream = (width: number, height: number, label: string) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')!
      let hue = 0
      const draw = () => {
        context.fillStyle = `hsl(${(hue += 9) % 360} 55% 45%)`
        context.fillRect(0, 0, width, height)
        context.fillStyle = '#fff'
        context.fillText(label, 10, 20)
      }
      draw()
      window.setInterval(draw, 150)
      return canvas.captureStream(10)
    }
    navigator.mediaDevices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      const tracks: MediaStreamTrack[] = []
      if (constraints?.video) tracks.push(...canvasStream(320, 180, 'camera').getVideoTracks())
      if (constraints?.audio) {
        const audio = new AudioContext()
        const tone = audio.createOscillator()
        const destination = audio.createMediaStreamDestination()
        tone.connect(destination)
        tone.start()
        tracks.push(...destination.stream.getAudioTracks())
      }
      return new MediaStream(tracks)
    }
    navigator.mediaDevices.getDisplayMedia = async () => canvasStream(640, 360, 'screen')
  })
}

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await callDevices(page)
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  return page
}

async function liveInterview(request: APIRequestContext, title: string) {
  const admin = { Authorization: `Bearer ${await apiToken(request, DEV_ADMIN)}` }
  const created = await request.post(`${API_BASE_URL}/api/v1/interviews`, {
    headers: admin,
    data: {
      title,
      format: 'LIVE',
      interview_type: 'BEHAVIORAL',
      difficulty: 'MEDIUM',
      topics: ['Teamwork'],
      duration_minutes: 30,
      question_count: 1,
      follow_ups_enabled: false,
      max_follow_ups: 0,
    },
  })
  expect(created.ok()).toBeTruthy()
  const { id } = (await created.json()) as { id: string }
  await request.post(`${API_BASE_URL}/api/v1/interviews/${id}/questions`, {
    headers: admin,
    data: { text: 'Tell me about a disagreement in your team.', question_type: 'BEHAVIORAL', topic: 'Teamwork', difficulty: 'MEDIUM', expected_concepts: ['secretconcept'] },
  })
  expect((await request.post(`${API_BASE_URL}/api/v1/interviews/${id}/publish`, { headers: admin })).ok()).toBeTruthy()
  const people = (await (await request.get(`${API_BASE_URL}/api/v1/candidates`, { headers: admin })).json()) as Array<{ id: string; email: string; name: string }>
  const me = people.find((p) => p.email === DEV_CANDIDATE.email)!
  await request.post(`${API_BASE_URL}/api/v1/interviews/${id}/assignments`, { headers: admin, data: { candidate_ids: [me.id] } })
  return { id, admin, candidateName: me.name }
}

/** A <video> with this label is showing live frames. */
const showing = (page: Page, label: string | RegExp) =>
  page.evaluate(
    ({ source, flags }) => {
      const match = new RegExp(source, flags)
      return [...document.querySelectorAll('video')].some((v) => {
        const track = (v.srcObject as MediaStream | null)?.getVideoTracks()[0]
        return match.test(v.getAttribute('aria-label') ?? '') && track?.readyState === 'live' && v.videoWidth > 0 && !v.classList.contains('invisible')
      })
    },
    typeof label === 'string' ? { source: `^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, flags: '' } : { source: label.source, flags: label.flags },
  )

test('an interviewer and a candidate hold a live video interview, then the call record is kept', async ({ browser, request }) => {
  test.setTimeout(180_000)
  const title = unique('Live Interview')
  const { id, admin: adminHeaders, candidateName } = await liveInterview(request, title)
  const candidateHeaders = { Authorization: `Bearer ${await apiToken(request, DEV_CANDIDATE)}` }

  // A live interview has no AI session.
  const refused = await request.post(`${API_BASE_URL}/api/v1/candidates/me/interviews/${id}/session`, { headers: candidateHeaders })
  expect(refused.status()).toBe(409)
  expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('live_interview')

  // --- The interviewer starts the call --------------------------------------------------------------------
  const admin = await newPage(browser)
  await signIn(admin, request, DEV_ADMIN)
  await expect(admin).toHaveURL(/#\/admin$/)
  await admin.goto(`/#/admin/interviews/${id}`)
  const rows = admin.getByRole('list', { name: 'Assigned candidates' })
  await rows.getByRole('listitem').filter({ hasText: candidateName }).getByRole('button', { name: 'Start live call' }).click()
  await expect(admin).toHaveURL(new RegExp(`#/admin/interviews/${id}/calls/`))
  const callId = admin.url().split('/calls/')[1]
  await expect(admin.getByRole('status').filter({ hasText: 'Waiting for the other person to join' })).toBeVisible({ timeout: 20_000 })
  const guide = admin.getByRole('list', { name: 'Question guide' })
  await expect(guide).toContainText('Tell me about a disagreement in your team.')
  await expect(guide).toContainText('Listen for: secretconcept')

  // --- The candidate joins ---------------------------------------------------------------------------------
  const candidate = await newPage(browser)
  await signIn(candidate, request, DEV_CANDIDATE)
  await expect(candidate).toHaveURL(/#\/candidate$/)
  await candidate.goto(`/#/candidate/interviews/${id}`)
  await candidate.getByRole('link', { name: 'Join live call' }).click()
  await expect(candidate).toHaveURL(new RegExp(`#/candidate/interviews/${id}/call/${callId}$`))

  // Video both ways.
  const call = await (await request.get(`${API_BASE_URL}/api/v1/interviews/${id}/calls/${callId}`, { headers: adminHeaders })).json()
  const interviewerName = (call as { opened_by: { name: string } }).opened_by.name
  await expect.poll(() => showing(admin, candidateName), { timeout: 45_000 }).toBe(true)
  await expect.poll(() => showing(candidate, interviewerName), { timeout: 45_000 }).toBe(true)
  await expect(admin.locator('[data-testid="live-call"]')).toHaveAttribute('data-phase', 'connected')
  await expect(candidate.locator('[data-testid="live-call"]')).toHaveAttribute('data-phase', 'connected')

  // The candidate never receives the guide (or anything from it).
  await expect(candidate.getByText('secretconcept')).toHaveCount(0)
  await expect(candidate.getByRole('list', { name: 'Question guide' })).toHaveCount(0)

  // --- Chat, both ways -------------------------------------------------------------------------------------
  await candidate.getByLabel('Chat message').fill('Hello, can you hear me?')
  await candidate.getByRole('button', { name: 'Send' }).click()
  await admin.getByRole('tab', { name: /Chat/ }).click()
  await expect(admin.getByRole('log', { name: 'Chat history' })).toContainText('Hello, can you hear me?')
  await admin.getByLabel('Chat message').fill('Yes, loud and clear.')
  await admin.getByRole('button', { name: 'Send' }).click()
  await expect(candidate.getByRole('log', { name: 'Chat history' })).toContainText('Yes, loud and clear.')

  // --- Screen share from the candidate; mute from the interviewer --------------------------------------
  await candidate.getByRole('button', { name: 'Share screen' }).click()
  await expect.poll(() => showing(admin, `${candidateName}’s screen`), { timeout: 30_000 }).toBe(true)
  await candidate.getByRole('button', { name: 'Stop sharing' }).click()
  await expect.poll(() => showing(admin, `${candidateName}’s screen`), { timeout: 15_000 }).toBe(false)
  await admin.getByRole('button', { name: 'Mute microphone' }).click()
  await expect(candidate.locator(`video[aria-label="${interviewerName}"]`)).toHaveCount(0, { timeout: 10_000 })
  await expect(candidate.getByText(`${interviewerName} (muted)`)).toBeVisible()

  // --- A private note ----------------------------------------------------------------------------------
  await admin.getByRole('tab', { name: /Notes/ }).click()
  await admin.getByLabel('New note').fill('Clear, structured answers; strong ownership.')
  await admin.getByRole('button', { name: 'Save note' }).click()
  await expect(admin.getByRole('list', { name: 'Interviewer notes' })).toContainText('strong ownership')
  const seen = await (await request.get(`${API_BASE_URL}/api/v1/candidates/me/interview-calls/${callId}`, { headers: candidateHeaders })).json()
  expect(JSON.stringify(seen)).not.toContain('strong ownership')
  expect(seen).not.toHaveProperty('notes')

  // --- The interviewer ends the call ---------------------------------------------------------------------
  await admin.getByRole('button', { name: 'End call' }).click()
  await admin.getByRole('dialog').getByRole('button', { name: 'End call' }).click()
  await expect(candidate.getByRole('status').filter({ hasText: 'The interviewer has ended the call' })).toBeVisible({ timeout: 15_000 })
  await expect(admin.getByRole('heading', { name: `Call record — ${candidateName}` })).toBeVisible({ timeout: 15_000 })
  await expect(admin.getByLabel('Chat transcript')).toContainText('Hello, can you hear me?')
  await expect(admin.getByRole('list', { name: 'Interviewer notes' })).toContainText('strong ownership')
  await expect(admin.getByTestId('call-duration')).toHaveText(/^\d+:\d\d$/)

  // An ended call cannot be joined again; the call history lists it.
  const rejoin = await request.post(`${API_BASE_URL}/api/v1/candidates/me/interview-calls/${callId}/join`, { headers: candidateHeaders })
  expect(rejoin.status()).toBe(409)
  await admin.getByRole('button', { name: 'Back to the interview' }).click()
  await expect(admin.getByRole('list', { name: 'Calls' })).toContainText('Ended')

  await admin.context().close()
  await candidate.context().close()
})

test('a candidate cannot open calls or reach the interviewer screens', async ({ request }) => {
  const title = unique('Live Interview Access')
  const { id, admin } = await liveInterview(request, title)
  const people = (await (await request.get(`${API_BASE_URL}/api/v1/candidates`, { headers: admin })).json()) as Array<{ id: string; email: string }>
  const me = people.find((p) => p.email === DEV_CANDIDATE.email)!
  const candidate = { Authorization: `Bearer ${await apiToken(request, DEV_CANDIDATE)}` }

  expect((await request.post(`${API_BASE_URL}/api/v1/interviews/${id}/assignments/${me.id}/call`, { headers: candidate })).status()).toBe(403)
  const opened = await request.post(`${API_BASE_URL}/api/v1/interviews/${id}/assignments/${me.id}/call`, { headers: admin })
  expect(opened.status()).toBe(201)
  const { call_id } = (await opened.json()) as { call_id: string }
  expect((await request.get(`${API_BASE_URL}/api/v1/interviews/${id}/calls/${call_id}`, { headers: candidate })).status()).toBe(403)
  expect((await request.post(`${API_BASE_URL}/api/v1/interviews/${id}/calls/${call_id}/notes`, { headers: candidate, data: { body: 'x' } })).status()).toBe(403)
  expect((await request.post(`${API_BASE_URL}/api/v1/interviews/${id}/calls/${call_id}/end`, { headers: candidate })).status()).toBe(403)
  expect((await request.post(`${API_BASE_URL}/api/v1/interviews/${id}/calls/${call_id}/end`, { headers: admin })).ok()).toBeTruthy()
})
