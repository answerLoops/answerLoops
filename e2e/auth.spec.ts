import { test, expect } from '@playwright/test'
import { STORAGE_STATE } from '../playwright.config'

// Auth flow: unauthenticated redirects, login page render, session cookie.
// The default storageState (pre-baked JWT) is applied globally; these tests
// deliberately override it to test the unauthenticated paths.

test.describe('auth: unauthenticated redirects', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  const protectedRoutes = [
    '/dashboard',
    '/tickets',
    '/kb',
    '/analytics',
    '/settings',
    '/knowledge-gaps',
    '/simulation',
    '/faq',
    '/leads',
    '/billing',
  ]

  for (const route of protectedRoutes) {
    test(`${route} redirects to /login`, async ({ page }) => {
      await page.goto(route)
      await expect(page).toHaveURL(/\/login/)
    })
  }

  test('login page renders sign-in form', async ({ page }) => {
    // Bare /login defaults to the signup variant ("Create your account");
    // ?mode=signin is what renders the sign-in copy this test checks for.
    await page.goto('/login?mode=signin')
    await expect(page.getByText('Sign in to your workspace.')).toBeVisible()
    // The configured provider's button is offered (the e2e server sets Google
    // credentials; with none configured the page shows an explanation instead).
    await expect(page.getByRole('button', { name: /sign in with google/i })).toBeVisible()
  })
})

test.describe('auth: authenticated session', () => {
  test.use({ storageState: STORAGE_STATE })

  test('authenticated user can reach dashboard', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).not.toHaveURL(/\/login/)
    // The page heading is a personalized greeting, not a static "Dashboard"
    // title — assert a stable dashboard element instead.
    await expect(page.getByText('Auto-Answered')).toBeVisible()
  })
})
