import type { APIRequestContext, Page } from '@playwright/test'

export const API_BASE_URL = process.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000'
export const TOKEN_KEY = 'assessx.session-token'

/** Development accounts created by `python -m app.cli seed-dev-users` (backend/README.md). */
export interface AdminAccount {
  kind: 'admin'
  username: string
  email: string
  password: string
}
export interface CandidateAccount {
  kind: 'candidate'
  rollNumber: string
  email: string
  password: string
}
export type Account = AdminAccount | CandidateAccount

export const DEV_ADMIN: AdminAccount = {
  kind: 'admin',
  username: 'admin',
  email: 'admin@assessx.local',
  password: process.env.DEV_ADMIN_PASSWORD ?? 'AssessX-admin-dev1',
}
export const DEV_CANDIDATE: CandidateAccount = {
  kind: 'candidate',
  rollNumber: 'DEV2026001',
  email: 'candidate@assessx.local',
  password: process.env.DEV_CANDIDATE_PASSWORD ?? 'AssessX-candidate-dev1',
}
export const DEV_INACTIVE: CandidateAccount = {
  kind: 'candidate',
  rollNumber: 'DEV2026002',
  email: 'inactive@assessx.local',
  password: process.env.DEV_INACTIVE_PASSWORD ?? 'AssessX-inactive-dev1',
}

interface SolvedChallenge {
  challenge_id: string
  image_svg: string
  expires_at: string
  answer: string
}

/**
 * Makes the sign-in security check solvable. The backend's development-only endpoint issues a
 * real challenge and reveals its answer; the UI's next challenge request is answered with that
 * challenge. The backend still verifies the typed answer for real on login.
 */
const CHALLENGE_ROUTE = '**/api/v1/auth/challenge'

export async function armSolvableChallenge(page: Page, request: APIRequestContext): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/api/v1/dev/login-challenges`)
  if (!response.ok()) throw new Error(`dev challenge endpoint failed: ${response.status()}`)
  const solved = (await response.json()) as SolvedChallenge
  // Stays armed until `disarmChallenge` so React StrictMode's double effect run sees the same
  // challenge both times.
  await page.route(CHALLENGE_ROUTE, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        challenge_id: solved.challenge_id,
        image_svg: solved.image_svg,
        expires_at: solved.expires_at,
      }),
    })
  })
  return solved.answer
}

export async function disarmChallenge(page: Page) {
  await page.unroute(CHALLENGE_ROUTE)
}

export async function signIn(
  page: Page,
  request: APIRequestContext,
  account: Account,
  options: { remember?: boolean; answer?: string } = {},
) {
  // Leave any login screen first: the form fetches its challenge when it mounts, so signing in
  // twice in one page would otherwise keep the challenge issued before the route was armed.
  if (hashOf(page).startsWith('#/login')) await page.goto('/#/welcome')
  const answer = options.answer ?? (await armSolvableChallenge(page, request))
  await page.goto('/#/login')
  await page.getByRole('tab', { name: account.kind === 'candidate' ? 'Candidate' : 'Administrator' }).click()
  if (account.kind === 'candidate') {
    await page.getByLabel('University roll number').fill(account.rollNumber)
  } else {
    await page.getByLabel('Username').fill(account.username)
  }
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(account.password)
  await page.locator('img[data-challenge-id]').waitFor()
  await disarmChallenge(page)
  await page.getByLabel('Security check').fill(answer)
  if (options.remember) await page.getByLabel('Keep me signed in on this device').check()
  await page.getByRole('button', { name: /Sign in as/ }).click()
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: 'Sign out' }).click()
}

export function hashOf(page: Page): string {
  return new URL(page.url()).hash
}

export function storedToken(page: Page): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key) ?? sessionStorage.getItem(key), TOKEN_KEY)
}

export type BuilderStepName = 'Basic information' | 'Questions' | 'Settings' | 'Review' | 'Assign'

/** Switches the assessment builder to a step. Scoped to the stepper so "+ Add Question" cannot match. */
export async function builderStep(page: Page, name: BuilderStepName) {
  await page
    .getByRole('navigation', { name: 'Assessment builder steps' })
    .getByRole('button', { name: new RegExp(name) })
    .click()
}

/** Signs in through the API and returns the bearer token. Used where no UI session is needed. */
export async function apiToken(request: APIRequestContext, account: Account): Promise<string> {
  const challenge = await request.post(`${API_BASE_URL}/api/v1/dev/login-challenges`)
  // Checked explicitly: otherwise a failed challenge request surfaces later as a confusing
  // `challenge_invalid`, because `challenge_id` would be undefined.
  if (!challenge.ok()) {
    throw new Error(`dev challenge endpoint failed: ${challenge.status()} ${await challenge.text()}`)
  }
  const solved = (await challenge.json()) as SolvedChallenge
  const body =
    account.kind === 'candidate'
      ? { roll_number: account.rollNumber, email: account.email, password: account.password }
      : { username: account.username, email: account.email, password: account.password }
  const response = await request.post(`${API_BASE_URL}/api/v1/auth/login/${account.kind}`, {
    data: { ...body, challenge_id: solved.challenge_id, challenge_answer: solved.answer },
  })
  if (!response.ok()) throw new Error(`api sign-in failed: ${response.status()} ${await response.text()}`)
  return (await response.json()).token as string
}
