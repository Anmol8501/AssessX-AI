import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { API_BASE_URL, apiToken, builderStep, DEV_ADMIN, DEV_CANDIDATE, signIn, signOut } from './helpers'

/** Phase 2C: publishing an assessment, assigning candidates, and the candidate's My Exams list. */

const unique = (label: string) => `${label} ${Date.now().toString().slice(-6)}`

/** Opens an assessment's builder through the UI. A hash-only `goto` does not re-route the app. */
async function openBuilder(page: Page, title: string) {
  await page.getByRole('link', { name: 'Assessments' }).click()
  await page.getByRole('link', { name: title, exact: true }).click()
  await expect(page.getByRole('navigation', { name: 'Assessment builder steps' })).toBeVisible()
}

interface Seeded {
  id: string
  title: string
}

/**
 * Creates a READY assessment through the API so each test starts where publishing begins.
 * The builder itself is covered by builder.spec.ts.
 */
async function seedReadyAssessment(request: APIRequestContext, token: string, title: string): Promise<Seeded> {
  const auth = { Authorization: `Bearer ${token}` }
  const created = await request.post(`${API_BASE_URL}/api/v1/assessments`, {
    headers: auth,
    data: { title, description: 'Seeded for publishing', duration_minutes: 30, total_marks: 2, passing_marks: 1 },
  })
  expect(created.ok()).toBeTruthy()
  const assessment = (await created.json()) as { id: string }

  const question = await request.post(`${API_BASE_URL}/api/v1/assessments/${assessment.id}/questions`, {
    headers: auth,
    data: {
      type: 'MCQ',
      text: 'Which structure is first-in, first-out?',
      marks: 2,
      options: [
        { text: 'Stack', is_correct: false },
        { text: 'Queue', is_correct: true },
        { text: 'Tree', is_correct: false },
        { text: 'Graph', is_correct: false },
      ],
    },
  })
  expect(question.ok()).toBeTruthy()

  const ready = await request.post(`${API_BASE_URL}/api/v1/assessments/${assessment.id}/ready`, { headers: auth })
  expect(ready.ok()).toBeTruthy()
  return { id: assessment.id, title }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
})

test('admin publishes, creates a candidate, assigns them, and the candidate sees the exam', async ({
  page,
  request,
}) => {
  const adminToken = await apiToken(request, DEV_ADMIN)
  const { title } = await seedReadyAssessment(request, adminToken, unique('Publish Flow'))

  const rollNumber = `E2E${Date.now().toString().slice(-8)}`
  // A unique name: earlier runs leave their candidates behind in the development database.
  const candidateName = `E2E Candidate ${rollNumber}`
  const candidate = {
    kind: 'candidate' as const,
    rollNumber,
    email: `${rollNumber.toLowerCase()}@assessx.local`,
    password: 'AssessX-e2e-candidate1',
  }

  await signIn(page, request, DEV_ADMIN)

  // --- Create the candidate ------------------------------------------------------------------
  await page.getByRole('link', { name: 'Candidates' }).click()
  await page.getByRole('button', { name: '+ Add Candidate' }).click()
  await page.getByLabel('Full name').fill(candidateName)
  await page.getByLabel('University roll number').fill(rollNumber)
  await page.getByLabel('Email').fill(candidate.email)
  await page.getByLabel('Initial password').fill(candidate.password)
  await page.getByRole('button', { name: 'Create candidate' }).click()
  await expect(page.getByText(candidate.email)).toBeVisible()

  // --- Publish ---------------------------------------------------------------------------------
  await openBuilder(page, title)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()

  await builderStep(page, 'Assign')
  await expect(page.getByText('Publish this assessment from the Review step')).toBeVisible()

  await builderStep(page, 'Review')
  await page.getByRole('button', { name: 'Publish assessment', exact: true }).click()
  const confirm = page.getByRole('dialog')
  await expect(confirm.getByText(/locks its questions/)).toBeVisible()
  await confirm.getByRole('button', { name: 'Publish assessment', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Unpublish' })).toBeVisible()

  // Publishing locks editing: the backend refuses these writes, so the UI must not offer them.
  await builderStep(page, 'Basic information')
  await expect(page.getByRole('button', { name: 'Save basic information' })).toBeDisabled()
  await builderStep(page, 'Questions')
  await expect(page.getByRole('button', { name: '+ Add Question' })).toHaveCount(0)
  await builderStep(page, 'Settings')
  await expect(page.getByRole('button', { name: 'Save settings' })).toBeDisabled()

  // --- Assign ------------------------------------------------------------------------------------
  await builderStep(page, 'Assign')
  await page.getByLabel('Search candidates').fill(candidateName)
  await page.getByRole('checkbox', { name: `Select ${candidateName}` }).click()
  await expect(page.getByText('1 candidate selected')).toBeVisible()
  await page.getByRole('button', { name: 'Assign selected' }).click()
  await expect(page.getByText(/1 candidate\(s\) assigned successfully/)).toBeVisible()
  await expect(page.getByText('1 candidate(s) hold this assessment.')).toBeVisible()

  // --- The candidate's view ------------------------------------------------------------------------
  await signOut(page)
  await signIn(page, request, candidate)

  // The dashboard's upcoming list is the same assignment, not a placeholder.
  await expect(page.getByRole('heading', { name: 'Upcoming assessments' })).toBeVisible()
  await expect(page.getByText('1 assigned to you.')).toBeVisible()
  await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible()

  await page.getByRole('link', { name: 'My Exams' }).click()

  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await expect(page.getByText('Which structure is first-in')).toHaveCount(0) // no questions leak
  await expect(page.getByRole('button', { name: 'Start Exam' })).toBeDisabled()
  await expect(page.getByText('Taking an exam arrives in Phase 3.').first()).toBeVisible()
})

test('a draft cannot be published and an assessment somebody holds cannot be unpublished', async ({ page, request }) => {
  const adminToken = await apiToken(request, DEV_ADMIN)
  const auth = { Authorization: `Bearer ${adminToken}` }

  // A DRAFT assessment is refused by the API, whatever a client sends.
  const draftTitle = unique('Draft Publish')
  const draft = (await (
    await request.post(`${API_BASE_URL}/api/v1/assessments`, {
      headers: auth,
      data: { title: draftTitle, duration_minutes: 30, total_marks: 2, passing_marks: 1 },
    })
  ).json()) as { id: string }
  const refused = await request.post(`${API_BASE_URL}/api/v1/assessments/${draft.id}/publish`, { headers: auth })
  expect(refused.status()).toBe(422)

  // Publishing is offered in the UI only once the assessment is ready.
  await signIn(page, request, DEV_ADMIN)
  await openBuilder(page, draftTitle)
  await builderStep(page, 'Review')
  await expect(page.getByRole('button', { name: 'Publish assessment', exact: true })).toHaveCount(0)

  // An assessment somebody holds cannot be unpublished until they are unassigned.
  const { id } = await seedReadyAssessment(request, adminToken, unique('Unpublish Guard'))
  await request.post(`${API_BASE_URL}/api/v1/assessments/${id}/publish`, { headers: auth })
  const candidates = (await (
    await request.get(`${API_BASE_URL}/api/v1/candidates`, { headers: auth })
  ).json()) as Array<{ id: string; email: string }>
  const target = candidates.find((c) => c.email === DEV_CANDIDATE.email)
  expect(target).toBeDefined()
  await request.post(`${API_BASE_URL}/api/v1/assessments/${id}/assignments`, {
    headers: auth,
    data: { candidate_ids: [target!.id] },
  })

  const blocked = await request.post(`${API_BASE_URL}/api/v1/assessments/${id}/unpublish`, { headers: auth })
  expect(blocked.status()).toBe(409)
})

test('a candidate sees only their own assignments and cannot publish or assign', async ({ request }) => {
  const adminToken = await apiToken(request, DEV_ADMIN)
  const auth = { Authorization: `Bearer ${adminToken}` }
  const { id } = await seedReadyAssessment(request, adminToken, unique('Scoped'))
  await request.post(`${API_BASE_URL}/api/v1/assessments/${id}/publish`, { headers: auth })

  // A brand-new candidate, assigned nothing.
  const rollNumber = `E2EX${Date.now().toString().slice(-8)}`
  const other = {
    kind: 'candidate' as const,
    rollNumber,
    email: `${rollNumber.toLowerCase()}@assessx.local`,
    password: 'AssessX-e2e-other1',
  }
  const created = await request.post(`${API_BASE_URL}/api/v1/candidates`, {
    headers: auth,
    data: {
      name: 'Unassigned Candidate',
      email: other.email,
      roll_number: rollNumber,
      initial_password: other.password,
    },
  })
  expect(created.ok()).toBeTruthy()

  // Assign the seeded assessment to the development candidate only.
  const candidates = (await (
    await request.get(`${API_BASE_URL}/api/v1/candidates`, { headers: auth })
  ).json()) as Array<{ id: string; email: string }>
  const dev = candidates.find((c) => c.email === DEV_CANDIDATE.email)!
  await request.post(`${API_BASE_URL}/api/v1/assessments/${id}/assignments`, {
    headers: auth,
    data: { candidate_ids: [dev.id] },
  })

  const otherToken = await apiToken(request, other)
  const otherAuth = { Authorization: `Bearer ${otherToken}` }
  const mine = (await (
    await request.get(`${API_BASE_URL}/api/v1/candidates/me/assessments`, { headers: otherAuth })
  ).json()) as Array<{ assessment_id: string }>
  expect(mine.some((row) => row.assessment_id === id)).toBe(false)

  const devToken = await apiToken(request, DEV_CANDIDATE)
  const devMine = (await (
    await request.get(`${API_BASE_URL}/api/v1/candidates/me/assessments`, {
      headers: { Authorization: `Bearer ${devToken}` },
    })
  ).json()) as Array<{ assessment_id: string }>
  expect(devMine.some((row) => row.assessment_id === id)).toBe(true)

  // Admin-only endpoints stay closed to candidates.
  const base = `${API_BASE_URL}/api/v1/assessments/${id}`
  for (const response of await Promise.all([
    request.post(`${base}/publish`, { headers: otherAuth }),
    request.post(`${base}/unpublish`, { headers: otherAuth }),
    request.get(`${base}/assignments`, { headers: otherAuth }),
    request.post(`${base}/assignments`, { headers: otherAuth, data: { candidate_ids: [dev.id] } }),
    request.delete(`${base}/assignments/${dev.id}`, { headers: otherAuth }),
    request.get(`${API_BASE_URL}/api/v1/candidates`, { headers: otherAuth }),
    request.post(`${API_BASE_URL}/api/v1/candidates`, {
      headers: otherAuth,
      data: { name: 'Nope', email: 'nope@assessx.local', roll_number: 'NOPE1', initial_password: 'password123' },
    }),
  ])) {
    expect(response.status()).toBe(403)
    expect((await response.json()).error.code).toBe('forbidden')
  }
})
