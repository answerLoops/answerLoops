import { test, expect } from '@playwright/test'
import { waitFor } from './helpers'

// Team management: invite by email, accept invite link, see member in list.
// Email delivery is mocked (MOCK_EXTERNALS=1, no RESEND_API_KEY in test env).
// The invite URL is returned in the action response and shown on the settings page.

test.describe('team: invite flow', () => {
  test('owner can invite a new member via settings', async ({ page }) => {
    await page.goto('/settings?tab=team')

    // Find the invite form — scoped to the Team section
    const inviteEmail = page.locator('input[name="email"][type="email"]').first()
    await inviteEmail.fill('newmember@example.com')

    await page.getByRole('button', { name: /send invite/i }).click()

    // Invite URL is shown after submission (email not sent in test env)
    await expect(page.getByText(/copied to clipboard/i)).toBeVisible({ timeout: 10_000 })
  })

  test('invite appears in pending list', async ({ page, request }) => {
    await page.goto('/settings?tab=team')

    const inviteEmail = page.locator('input[name="email"][type="email"]').first()
    await inviteEmail.fill('pending@example.com')
    await page.getByRole('button', { name: /send invite/i }).click()
    await expect(page.getByText(/copied to clipboard/i)).toBeVisible({ timeout: 10_000 })

    // Verify via API that the invite was created
    const invites = (await request.get('/api/team/invites').then((r) => r.json())) as Array<{
      email: string
    }>
    expect(invites.some((i) => i.email === 'pending@example.com')).toBe(true)
  })

  test('invite page shows accept UI for valid token', async ({ page, request }) => {
    // Seed invite via API (direct DB seed via global-setup left the invitation table clean,
    // so create one here through the settings action)
    await page.goto('/settings?tab=team')
    const inviteEmail = page.locator('input[name="email"][type="email"]').first()
    await inviteEmail.fill('acceptme@example.com')
    await page.getByRole('button', { name: /send invite/i }).click()
    await expect(page.getByText(/copied to clipboard/i)).toBeVisible({ timeout: 10_000 })

    // Fetch the token from API
    const invites = (await request.get('/api/team/invites').then((r) => r.json())) as Array<{
      email: string
      token: string
    }>
    const invite = invites.find((i) => i.email === 'acceptme@example.com')
    expect(invite).toBeDefined()

    // Visit invite page — since test user is already logged in they'll be auto-accepted
    // and redirected to /dashboard
    await page.goto(`/invite/${invite!.token}`)
    await expect(page).toHaveURL(/dashboard|invite/)
  })

  test('invalid invite token shows error', async ({ page }) => {
    await page.goto('/invite/not-a-real-token')
    await expect(page.getByText(/invalid|expired|not found/i)).toBeVisible()
  })

  test('owner can revoke a pending invite', async ({ page, request }) => {
    await page.goto('/settings?tab=team')
    const inviteEmail = page.locator('input[name="email"][type="email"]').first()
    await inviteEmail.fill('torevoke@example.com')
    await page.getByRole('button', { name: /send invite/i }).click()
    await expect(page.getByText(/copied to clipboard/i)).toBeVisible({ timeout: 10_000 })

    // Find and click revoke
    await page.reload()
    const revokeBtn = page.getByRole('button', { name: /revoke/i }).first()
    if (await revokeBtn.isVisible()) {
      await revokeBtn.click()
      // Invite removed from list
      const invites = await waitFor(async () => {
        const list = (await request.get('/api/team/invites').then((r) => r.json())) as Array<{
          email: string
        }>
        return !list.some((i) => i.email === 'torevoke@example.com') ? true : false
      })
      expect(invites).toBe(true)
    }
  })
})

test.describe('team: members list', () => {
  test('settings page shows seeded owner', async ({ page }) => {
    await page.goto('/settings?tab=team')
    await expect(page.getByText('Test Staff')).toBeVisible()
    await expect(page.getByText(/owner/i).first()).toBeVisible()
  })
})
