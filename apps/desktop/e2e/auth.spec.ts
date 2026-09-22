import { expect, test } from '@playwright/test'
import { API_BASE_URL, DEV_ADMIN, DEV_INACTIVE, DEV_CANDIDATE, hashOf, signIn, signOut, storedToken } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
})

test('launch shows the welcome screen, then login', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Get Started' })).toBeVisible()
  expect(hashOf(page)).toBe('#/welcome')
  await page.getByRole('link', { name: 'Get Started' }).click()
  await expect(page.getByRole('button', { name: /Sign in as/ })).toBeVisible()
  expect(hashOf(page)).toBe('#/login')
})

test('CASE 1 - admin signs in against the backend and can navigate the admin shell', async ({ page, request }) => {
  await signIn(page, request, DEV_ADMIN)

  await expect(page.getByRole('heading', { name: 'Welcome back, Dev Admin' })).toBeVisible()
  expect(hashOf(page)).toBe('#/admin')
  // Real data from the admin-only endpoint.
  await expect(page.getByRole('main').getByText('candidate@assessx.local')).toBeVisible()

  for (const [name, hash] of [
    ['Assessments', '#/admin/assessments'],
    ['Candidates', '#/admin/candidates'],
    ['Monitoring', '#/admin/monitoring'],
    ['Results', '#/admin/results'],
    ['Settings', '#/admin/settings'],
    ['Dashboard', '#/admin'],
  ] as const) {
    await page.getByRole('link', { name }).click()
    await expect.poll(() => hashOf(page)).toBe(hash)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  }
})

test('CASE 2 - candidate signs in and can navigate the candidate shell', async ({ page, request }) => {
  await signIn(page, request, DEV_CANDIDATE)

  await expect(page.getByRole('heading', { name: 'Welcome, Dev Candidate' })).toBeVisible()
  expect(hashOf(page)).toBe('#/candidate')

  for (const [name, hash] of [
    ['My Exams', '#/candidate/exams'],
    ['Results', '#/candidate/results'],
    ['Profile', '#/candidate/profile'],
    ['Dashboard', '#/candidate'],
  ] as const) {
    await page.getByRole('link', { name }).click()
    await expect.poll(() => hashOf(page)).toBe(hash)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  }
  // Profile loads from the candidate-only endpoint.
  await page.getByRole('link', { name: 'Profile' }).click()
  await expect(page.getByRole('main').getByText('candidate@assessx.local')).toBeVisible()
  await expect(page.getByRole('main').getByText('DEV2026001')).toBeVisible()
})

test('CASE 3 - wrong password shows a generic error and stays on login', async ({ page, request }) => {
  await signIn(page, request, { ...DEV_ADMIN, password: 'not-the-password' })

  await expect(page.getByRole('alert')).toContainText('do not match an account')
  expect(hashOf(page)).toBe('#/login')
})

test('CASE 3b - unknown email gets the same message as a wrong password', async ({ page, request }) => {
  await signIn(page, request, { ...DEV_CANDIDATE, email: 'nobody@assessx.local', password: 'whatever' })
  await expect(page.getByRole('alert')).toContainText('do not match an account')
})

test('CASE 3c - inactive account is refused', async ({ page, request }) => {
  await signIn(page, request, DEV_INACTIVE)
  await expect(page.getByRole('alert')).toContainText('This account is inactive.')
  expect(hashOf(page)).toBe('#/login')
})

test('CASE 3d - wrong security code is rejected and a new code is issued', async ({ page, request }) => {
  await signIn(page, request, DEV_CANDIDATE, { answer: 'ZZZZZZ' })
  await expect(page.getByText('The code did not match. Try the new one.')).toBeVisible()
  expect(hashOf(page)).toBe('#/login')
})

test('CASE 3d-admin - the administrator form also requires the security code', async ({ page, request }) => {
  await signIn(page, request, DEV_ADMIN, { answer: 'ZZZZZZ' })
  await expect(page.getByText('The code did not match. Try the new one.')).toBeVisible()
  expect(hashOf(page)).toBe('#/login')
})

test('CASE 3e - empty fields are validated before anything is sent', async ({ page }) => {
  await page.goto('/#/login')
  await page.getByRole('button', { name: /Sign in as/ }).click()
  await expect(page.getByText('Enter your university roll number.')).toBeVisible()
  await expect(page.getByText('Enter your email address.')).toBeVisible()
  await expect(page.getByText('Enter your password.')).toBeVisible()
  await expect(page.getByText('Enter the verification code.')).toBeVisible()

  await page.getByRole('tab', { name: 'Administrator' }).click()
  await page.getByRole('button', { name: /Sign in as/ }).click()
  await expect(page.getByText('Enter your username.')).toBeVisible()
  await expect(page.getByText('Enter the verification code.')).toBeVisible()
})

test('CASE 3g - wrong roll number is refused even with the right password', async ({ page, request }) => {
  await signIn(page, request, { ...DEV_CANDIDATE, rollNumber: 'WRONG0001' })
  await expect(page.getByRole('alert')).toContainText('do not match an account')
})

test('CASE 3h - a candidate cannot sign in through the administrator form', async ({ page, request }) => {
  await signIn(page, request, { kind: 'admin', username: 'candidate', email: DEV_CANDIDATE.email, password: DEV_CANDIDATE.password })
  await expect(page.getByRole('alert')).toContainText('do not match an account')
  expect(hashOf(page)).toBe('#/login')
})

test('CASE 3f - backend unavailable is reported clearly', async ({ page }) => {
  await page.route('**/api/v1/**', (route) => route.abort('connectionrefused'))
  await page.goto('/#/login')
  await expect(page.getByText('Cannot reach the AssessX server.')).toBeVisible()
})

test('CASE 4 - unauthenticated access to protected areas redirects to login', async ({ page }) => {
  for (const path of ['/#/admin', '/#/admin/settings', '/#/candidate', '/#/candidate/profile']) {
    await page.goto(path)
    await expect(page.getByRole('button', { name: /Sign in as/ })).toBeVisible()
    expect(hashOf(page)).toBe('#/login')
  }
})

test('CASE 5 - a candidate cannot reach admin screens or the admin API', async ({ page, request }) => {
  await signIn(page, request, DEV_CANDIDATE)
  await expect(page.getByRole('heading', { name: 'Welcome, Dev Candidate' })).toBeVisible()

  // Changing the URL does not bypass the role guard.
  await page.goto('/#/admin')
  await expect.poll(() => hashOf(page)).toBe('#/candidate')
  await page.goto('/#/admin/settings')
  await expect.poll(() => hashOf(page)).toBe('#/candidate')

  // Calling the admin API directly with the candidate's real token is rejected by the backend.
  const token = await storedToken(page)
  expect(token).toBeTruthy()
  const forbidden = await request.get(`${API_BASE_URL}/api/v1/users`, { headers: { Authorization: `Bearer ${token}` } })
  expect(forbidden.status()).toBe(403)
  expect((await forbidden.json()).error.code).toBe('forbidden')

  // ...while the candidate endpoint works with the same token.
  const allowed = await request.get(`${API_BASE_URL}/api/v1/candidates/me`, { headers: { Authorization: `Bearer ${token}` } })
  expect(allowed.status()).toBe(200)
})

test('CASE 5b - an admin is kept out of candidate-only screens', async ({ page, request }) => {
  await signIn(page, request, DEV_ADMIN)
  await expect(page.getByRole('heading', { name: 'Welcome back, Dev Admin' })).toBeVisible()
  await page.goto('/#/candidate/profile')
  await expect.poll(() => hashOf(page)).toBe('#/admin')
})

test('CASE 6 - logout clears the session and protects the application', async ({ page, request }) => {
  await signIn(page, request, DEV_ADMIN)
  await expect(page.getByRole('heading', { name: 'Welcome back, Dev Admin' })).toBeVisible()
  const token = await storedToken(page)

  await signOut(page)
  await expect(page.getByRole('button', { name: /Sign in as/ })).toBeVisible()
  expect(hashOf(page)).toBe('#/login')

  // Token gone locally and revoked server-side.
  expect(await storedToken(page)).toBeNull()
  const revoked = await request.get(`${API_BASE_URL}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
  expect(revoked.status()).toBe(401)

  await page.goto('/#/admin')
  await expect.poll(() => hashOf(page)).toBe('#/login')
})

test('remember me survives a relaunch; a revoked token returns to login with an explanation', async ({ page, request }) => {
  await signIn(page, request, DEV_CANDIDATE, { remember: true })
  await expect(page.getByRole('heading', { name: 'Welcome, Dev Candidate' })).toBeVisible()

  // Relaunch (fresh navigation to the root) restores the session from the backend.
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Welcome, Dev Candidate' })).toBeVisible()

  // Revoke server-side (as an expiry would), then use the app: it must return to login.
  const token = await storedToken(page)
  await request.post(`${API_BASE_URL}/api/v1/auth/logout`, { headers: { Authorization: `Bearer ${token}` } })
  await page.getByRole('link', { name: 'Profile' }).click()
  await expect(page.getByText('Your session has expired. Please sign in again.')).toBeVisible()
  expect(hashOf(page)).toBe('#/login')
})

test('security check image comes from the server and the page reveals no answer', async ({ page }) => {
  await page.goto('/#/login')
  await expect(page.locator('img[data-challenge-id]')).toBeVisible()
  expect(await page.content()).not.toContain('data-challenge=')
})
