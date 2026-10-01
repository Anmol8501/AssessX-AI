import { expect, test, type APIRequestContext } from '@playwright/test'
import { API_BASE_URL, DEV_ADMIN, DEV_CANDIDATE, apiToken, signIn } from './helpers'
import { unique } from './proctoring-helpers'

/**
 * Phase 7B: an adaptive interview evaluated by the server. The dev API runs with `LLM_PROVIDER=stub` — a
 * labelled, deterministic test double (refused in production), so no AI provider or key is involved.
 * The candidate's strong answer is processed, then the next question comes at the next difficulty; the
 * candidate never sees a score. The administrator reads the evaluation — labelled as an assessment
 * signal, with its model and rubric versions — and nothing is a decision.
 */

async function seedAdaptiveInterview(request: APIRequestContext, title: string): Promise<string> {
  const headers = { Authorization: `Bearer ${await apiToken(request, DEV_ADMIN)}` }
  const created = await request.post(`${API_BASE_URL}/api/v1/interviews`, {
    headers,
    data: {
      title,
      interview_type: 'TECHNICAL',
      difficulty: 'HARD',
      topics: ['Python'],
      duration_minutes: 20,
      question_count: 2,
      follow_ups_enabled: false,
      max_follow_ups: 0,
      adaptive_difficulty: true,
      min_difficulty: 'EASY',
      starting_difficulty: 'MEDIUM',
    },
  })
  expect(created.status()).toBe(201)
  const { id } = (await created.json()) as { id: string }
  for (const [difficulty, text] of [
    ['EASY', 'What is a Python list?'],
    ['MEDIUM', 'How does a Python dictionary find a key?'],
    ['HARD', 'Explain how the GIL affects CPU-bound threads.'],
  ]) {
    const added = await request.post(`${API_BASE_URL}/api/v1/interviews/${id}/questions`, {
      headers,
      data: { text, question_type: 'TECHNICAL', topic: 'Python', difficulty, expected_concepts: ['core idea'] },
    })
    expect(added.status()).toBe(201)
  }
  expect((await request.post(`${API_BASE_URL}/api/v1/interviews/${id}/publish`, { headers })).ok()).toBeTruthy()
  const candidates = (await (await request.get(`${API_BASE_URL}/api/v1/candidates`, { headers })).json()) as Array<{ id: string; email: string }>
  const candidate = candidates.find((c) => c.email === DEV_CANDIDATE.email)!
  expect(
    (await request.post(`${API_BASE_URL}/api/v1/interviews/${id}/assignments`, { headers, data: { candidate_ids: [candidate.id] } })).ok(),
  ).toBeTruthy()
  return id
}

test('a strong answer is evaluated server-side and the next question is harder; the admin sees the evaluation', async ({ browser, request }) => {
  test.setTimeout(120_000)
  const title = unique('Adaptive Interview')
  const interviewId = await seedAdaptiveInterview(request, title)

  // --- candidate ---------------------------------------------------------------------------------------
  const candidate = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage()
  await candidate.goto('/')
  await candidate.evaluate(() => localStorage.clear())
  await signIn(candidate, request, DEV_CANDIDATE)
  await expect(candidate).toHaveURL(/#\/candidate$/)
  await candidate.goto(`/#/candidate/interviews/${interviewId}`)
  await candidate.getByRole('link', { name: 'Start interview' }).click()

  const question = candidate.locator('[data-interview="question"]')
  await expect(question).toHaveText('How does a Python dictionary find a key?') // starts at MEDIUM
  await candidate.getByLabel('Your answer').fill('[[stub:strong]] It hashes the key and probes the table for a matching slot.')
  await candidate.getByRole('button', { name: 'Submit answer' }).click()

  // The next question follows the evaluation — one level harder — after a processing state.
  await expect(question).toHaveText('Explain how the GIL affects CPU-bound threads.', { timeout: 15_000 })
  await expect(candidate.locator('body')).not.toContainText(/\/ 100|score|feedback|evaluat|stub/i)
  await candidate.getByLabel('Your answer').fill('Only one thread runs Python bytecode at a time, so CPU-bound threads do not run in parallel.')
  await candidate.getByRole('button', { name: 'Submit answer' }).click()
  await expect(candidate.getByRole('heading', { name: 'Interview complete' })).toBeVisible({ timeout: 15_000 })
  await expect(candidate.locator('body')).not.toContainText(/\/ 100|score/i)

  // --- admin -------------------------------------------------------------------------------------------
  const admin = await (await browser.newContext({ viewport: { width: 1440, height: 1100 } })).newPage()
  await admin.goto('/')
  await admin.evaluate(() => localStorage.clear())
  await signIn(admin, request, DEV_ADMIN)
  await expect(admin).toHaveURL(/#\/admin$/)
  await admin.goto(`/#/admin/interviews/${interviewId}`)
  // Phase 7C: the evaluation is read in the session's report (the editor links to it).
  await admin.getByRole('link', { name: 'Open report' }).click()
  const summary = admin.getByLabel('AI evaluation summary')
  await expect(summary).toContainText('does not make hiring decisions')
  const first = admin.getByRole('list', { name: 'Question analysis' }).locator('[data-evaluation="result"]').first()
  await expect(first).toContainText('90 / 100')
  await expect(first).toContainText('stub/stub · evaluator 7B-v1 · rubric technical-v1')
  await expect(admin.getByRole('list', { name: 'Adaptive timeline' })).toContainText('strong answer — one level harder')
  await expect(summary).not.toContainText(/hire|reject|recommend/i)

  await admin.context().close()
  await candidate.context().close()
})

test('candidates cannot read evaluations or send scores', async ({ request }) => {
  const candidate = { Authorization: `Bearer ${await apiToken(request, DEV_CANDIDATE)}` }
  const admin = { Authorization: `Bearer ${await apiToken(request, DEV_ADMIN)}` }
  const interviewId = await seedAdaptiveInterview(request, unique('Adaptive Guard'))
  const me = (await (await request.get(`${API_BASE_URL}/api/v1/candidates/me`, { headers: candidate })).json()) as { id: string }
  const url = `${API_BASE_URL}/api/v1/interviews/${interviewId}/assignments/${me.id}/evaluations`
  expect((await request.get(url, { headers: candidate })).status()).toBe(403)

  const started = await request.post(`${API_BASE_URL}/api/v1/candidates/me/interviews/${interviewId}/session`, { headers: candidate })
  const state = (await started.json()) as { session_id: string; current: { item_id: string } }
  const forged = await request.post(`${API_BASE_URL}/api/v1/candidates/me/interview-sessions/${state.session_id}/answers`, {
    headers: candidate,
    data: { item_id: state.current.item_id, answer_text: 'x', overall_score: 100, rubric_version: 'admin-v2' },
  })
  expect(forged.status()).toBe(422)
  expect((await request.get(url, { headers: admin })).ok()).toBeTruthy()
})
