import { expect, test, type APIRequestContext } from '@playwright/test'
import { API_BASE_URL, DEV_ADMIN, DEV_CANDIDATE, apiToken, signIn } from './helpers'
import { unique } from './proctoring-helpers'

/**
 * Phase 7C: an administrator opens an interview's report — the AI-generated summary, each answer with its
 * AI evaluation, the adaptive timeline — and records a human review: a note, a disagreement with one AI
 * evaluation, an explicit, confirmed outcome, then a revision; the history shows each step. The dev API runs
 * with `LLM_PROVIDER=stub` (a labelled test double), so no AI provider is involved. Candidates cannot
 * reach any of it.
 */

async function completedInterview(request: APIRequestContext, title: string) {
  const admin = { Authorization: `Bearer ${await apiToken(request, DEV_ADMIN)}` }
  const candidate = { Authorization: `Bearer ${await apiToken(request, DEV_CANDIDATE)}` }
  const created = await request.post(`${API_BASE_URL}/api/v1/interviews`, {
    headers: admin,
    data: { title, interview_type: 'TECHNICAL', difficulty: 'MEDIUM', topics: ['Databases'], duration_minutes: 20, question_count: 2, follow_ups_enabled: false, max_follow_ups: 0 },
  })
  const { id } = (await created.json()) as { id: string }
  for (const text of ['What is a database index?', 'When would you denormalise a schema?']) {
    await request.post(`${API_BASE_URL}/api/v1/interviews/${id}/questions`, {
      headers: admin,
      data: { text, question_type: 'TECHNICAL', topic: 'Databases', difficulty: 'EASY', expected_concepts: ['lookup speed'] },
    })
  }
  expect((await request.post(`${API_BASE_URL}/api/v1/interviews/${id}/publish`, { headers: admin })).ok()).toBeTruthy()
  const people = (await (await request.get(`${API_BASE_URL}/api/v1/candidates`, { headers: admin })).json()) as Array<{ id: string; email: string }>
  const me = people.find((p) => p.email === DEV_CANDIDATE.email)!
  await request.post(`${API_BASE_URL}/api/v1/interviews/${id}/assignments`, { headers: admin, data: { candidate_ids: [me.id] } })

  let state = (await (await request.post(`${API_BASE_URL}/api/v1/candidates/me/interviews/${id}/session`, { headers: candidate })).json()) as {
    session_id: string
    status: string
    processing: boolean
    current: { item_id: string } | null
  }
  for (const text of ['[[stub:strong]] An index speeds up lookups by keeping a sorted structure.', '[[stub:weak]] Not sure.']) {
    await request.post(`${API_BASE_URL}/api/v1/candidates/me/interview-sessions/${state.session_id}/answers`, {
      headers: candidate,
      data: { item_id: state.current!.item_id, answer_text: text },
    })
    await expect
      .poll(async () => {
        state = await (await request.get(`${API_BASE_URL}/api/v1/candidates/me/interview-sessions/${state.session_id}`, { headers: candidate })).json()
        return state.processing
      })
      .toBe(false)
  }
  expect(state.status).toBe('COMPLETED')
  return { interviewId: id, sessionId: state.session_id, candidate }
}

test('an admin reads the report and records a confirmed human review, then revises it', async ({ page, request }) => {
  test.setTimeout(120_000)
  const title = unique('Report Interview')
  const { interviewId, sessionId, candidate } = await completedInterview(request, title)

  // Candidates cannot read the report or touch the review.
  const reportUrl = `${API_BASE_URL}/api/v1/interviews/${interviewId}/sessions/${sessionId}/report`
  expect((await request.get(reportUrl, { headers: candidate })).status()).toBe(403)

  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await signIn(page, request, DEV_ADMIN)
  await expect(page).toHaveURL(/#\/admin$/)
  await page.getByRole('link', { name: 'Interviews' }).click()
  await page.getByRole('link', { name: 'Reports & reviews' }).click()
  const row = page.getByRole('table', { name: 'Interview reports' }).getByRole('row').filter({ hasText: title })
  await expect(row).toContainText('55 / 100') // mean(90, 20): an AI signal, shown — never used to rank
  await expect(row).toContainText('Unreviewed')
  await row.getByRole('link').click()

  // --- the report ---------------------------------------------------------------------------------------
  const summary = page.getByLabel('AI evaluation summary')
  await expect(summary).toContainText('AI-generated assessment signal')
  await expect(summary).toContainText('55 / 100')
  await expect(summary).toContainText('2 of 2 answers')
  await expect(summary).toContainText('does not make hiring decisions')
  const questions = page.getByRole('list', { name: 'Question analysis' })
  await expect(questions.locator('[data-report="answer"]').first()).toContainText('An index speeds up lookups')
  await expect(questions.locator('[data-evaluation="result"]').first()).toContainText('90 / 100')
  await expect(page.getByRole('list', { name: 'Adaptive timeline' })).toContainText('Q2')
  await expect(page.getByText('Not applicable: interviews are not proctored')).toBeVisible()

  // --- the human review ------------------------------------------------------------------------------------
  const review = page.getByRole('region', { name: 'Human review' })
  await review.getByRole('button', { name: 'Start review' }).click()
  await expect(review).toContainText('In review')
  await review.getByLabel('Add a human review note').fill('The second answer was brief; the first was solid.')
  await review.getByRole('button', { name: 'Add note' }).click()
  await expect(review.getByRole('list', { name: 'Human review notes' })).toContainText('the first was solid')

  const second = questions.locator('[data-report="question"]').nth(1)
  await second.getByRole('button', { name: 'Disagree' }).click()
  await expect(second.locator('[data-report="human-mark"]')).toContainText('Disagrees')
  await expect(second.locator('[data-evaluation="result"]')).toContainText('20 / 100') // the AI score stays

  const complete = review.getByRole('button', { name: 'Complete review' })
  await expect(complete).toBeDisabled() // nothing pre-selected
  await review.getByRole('radio', { name: /Needs further assessment/ }).check()
  await review.getByLabel('Rationale').fill('Follow up on schema design in a second conversation.')
  await complete.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('It is not an AI decision')
  await dialog.getByRole('button', { name: 'Record outcome' }).click()
  const outcome = review.locator('[data-review="outcome"]')
  await expect(outcome).toContainText('Needs further assessment')
  await expect(outcome).toContainText('(AI-generated)')

  await review.getByRole('button', { name: 'Revise outcome' }).click()
  await review.getByRole('radio', { name: /Meets expectations/ }).check()
  await review.getByLabel('Reason for the revision').fill('Second conversation completed satisfactorily.')
  await review.getByRole('button', { name: 'Record revision' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Record outcome' }).click()
  await expect(outcome).toContainText('Meets expectations')
  await expect(review.getByRole('list', { name: 'Earlier decisions' })).toContainText('Revision 1: Needs further assessment — superseded')
  await review.getByText(/Review history/).click()
  await expect(review.getByRole('list', { name: 'Review history' })).toContainText('Revised the outcome: Needs further assessment → Meets expectations')
  await expect(review).not.toContainText(/hire|reject|cheat/i)
})
