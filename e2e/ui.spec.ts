import { test, expect } from '@playwright/test'
import { ingest } from './helpers'

// Read-only rendering of every dashboard surface, after seeding a ticket so the
// lists and stat cards have something to show.
test.describe('dashboard surfaces', () => {
  test('dashboard renders stats cards and recent tickets', async ({ request, page }) => {
    await ingest(request, { content: 'How do I configure the client?', authorName: 'dashuser' })

    await page.goto('/dashboard')
    // The page heading is a personalized greeting ("Good to see you, <name>"),
    // not a static "Dashboard" title — assert the stable elements instead.
    await expect(page.getByText('Auto-Answered')).toBeVisible()
    await expect(page.getByText('Needs Review')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Open tickets' })).toBeVisible()
    // At least one recent open ticket links through to its detail page.
    await expect(page.getByRole('link', { name: /configure the client/i }).first()).toBeVisible()
  })

  test('tickets list shows tickets and filters by status', async ({ request, page }) => {
    await ingest(request, { content: 'How do I configure the client?' })

    await page.goto('/tickets')
    await expect(page.getByRole('heading', { name: 'Tickets' })).toBeVisible()
    await expect(page.getByText(/\d+ conversations?/)).toBeVisible()

    // Nothing is ever closed by the suite → filter yields an empty list.
    await page.goto('/tickets?status=closed')
    await expect(page.getByText('0 conversations')).toBeVisible()
  })

  test('settings shows SLA config and the configured repo', async ({ page }) => {
    await page.goto('/settings')
    // SLA priorities seeded by schema.
    await expect(page.getByText('critical', { exact: false }).first()).toBeVisible()
    // Repo seeded by global setup — lives under the GitHub tab.
    await page.goto('/settings?tab=github')
    await expect(page.getByText('acme/demo')).toBeVisible()
  })

  test('faq page renders after generation', async ({ request, page }) => {
    await request.post('/api/faq/generate')
    await page.goto('/faq')
    await expect(page.getByText(/FAQ/i).first()).toBeVisible()
  })
})
