import { expect, test } from '@playwright/test'
import { API_BASE_URL, DEV_ADMIN, apiToken, armSolvableChallenge, disarmChallenge, hashOf, signIn, signOut, type CandidateAccount } from './helpers'

// Phase 8A (AX-06): account controls — an administrator's one-time reset code, redeemed on the
// sign-in screen, and a signed-in user's own "Account security" dialog.

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
})

async function newCandidate(request: Parameters<typeof apiToken>[0]): Promise<CandidateAccount & { name: string }> {
  const tag = `${Date.now()}${Math.floor(Math.random() * 1000)}`
  const account = {
    kind: 'candidate' as const,
    name: `Reset Candidate ${tag}`,
    rollNumber: `RST${tag}`,
    email: `reset-${tag}@example.org`,
    password: 'Initial-pass-123',
  }
  const created = await request.post(`${API_BASE_URL}/api/v1/candidates`, {
    headers: { Authorization: `Bearer ${await apiToken(request, DEV_ADMIN)}` },
    data: { name: account.name, email: account.email, roll_number: account.rollNumber, initial_password: account.password },
  })
  expect(created.ok()).toBeTruthy()
  return account
}

test('an administrator issues a reset code and the candidate sets a new password with it', async ({ page, request }) => {
  const candidate = await newCandidate(request)

  await signIn(page, request, DEV_ADMIN)
  await page.getByRole('link', { name: 'Candidates' }).click()
  // The list is paged; the search finds a candidate beyond the first page.
  await page.getByRole('searchbox', { name: 'Search candidates' }).fill(candidate.email)
  const row = page.getByRole('listitem').filter({ hasText: candidate.email })
  await row.getByRole('button', { name: 'Reset code' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Issue code' }).click()
  const shown = page.getByRole('dialog').filter({ hasText: 'Reset code issued' })
  const code = (await shown.locator('p.font-mono').innerText()).trim()
  expect(code).toMatch(/^[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}$/)
  await shown.getByRole('button', { name: 'Done' }).click()
  await signOut(page)

  // The candidate redeems it from the sign-in screen.
  const answer = await armSolvableChallenge(page, request)
  await page.goto('/#/login')
  await page.getByRole('button', { name: 'Forgot password?' }).click()
  await page.getByRole('button', { name: 'enter the reset code' }).click()
  const form = page.getByRole('form', { name: 'Reset password with a code' })
  await form.getByLabel('Email').fill(candidate.email)
  await form.getByLabel('Reset code').fill(code)
  await form.getByLabel('New password', { exact: true }).fill('Changed-pass-456')
  await form.getByLabel('Confirm new password').fill('Changed-pass-456')
  await form.locator('img[data-challenge-id]').waitFor()
  await disarmChallenge(page)
  await form.getByLabel('Security check').fill(answer)
  await form.getByRole('button', { name: 'Set new password' }).click()
  await expect(page.getByText('Your password has been changed. Sign in with the new password.')).toBeVisible()

  // The old password no longer works; the new one does.
  await signIn(page, request, { ...candidate, password: 'Changed-pass-456' })
  await expect.poll(() => hashOf(page)).toBe('#/candidate')
})

test('a wrong current password in Account security is an error, not a sign-out', async ({ page, request }) => {
  await signIn(page, request, DEV_ADMIN)
  await expect.poll(() => hashOf(page)).toBe('#/admin')
  await page.getByRole('button', { name: 'Account security' }).click()
  const dialog = page.getByRole('dialog').filter({ hasText: 'Account security' })
  await dialog.getByLabel('Current password').fill('not-the-password')
  await dialog.getByLabel('New password', { exact: true }).fill('Another-admin-pass-1')
  await dialog.getByLabel('Confirm new password').fill('Another-admin-pass-1')
  await dialog.getByRole('button', { name: 'Change password' }).click()
  await expect(dialog.getByRole('alert')).toContainText('The current password is not correct.')
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  // Still signed in.
  expect(hashOf(page)).toBe('#/admin')
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
})
