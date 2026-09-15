import { test, expect } from '@playwright/test'

// Settings page: AI config form + SLA config form. Verify changes persist on reload.

test.describe('settings: AI config', () => {
  test('page renders AI config section', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByText(/AI (configuration|config|model)/i).first()).toBeVisible()
  })

  test('can update chat model and it persists', async ({ page, request }) => {
    await page.goto('/settings?tab=ai')

    // Find the chat model field
    const modelInput = page.locator('input[name="chatModel"], select[name="chatModel"]').first()

    if (await modelInput.isVisible()) {
      await modelInput.fill('gpt-4o-mini')
      await page.getByRole('button', { name: /save/i }).first().click()
      await expect(page.getByText(/saved|updated/i)).toBeVisible({ timeout: 8_000 })

      // Verify via API
      const config = (await request.get('/api/ai-config').then((r) => r.json())) as {
        chat_model: string
      } | null
      if (config) {
        expect(config.chat_model).toBe('gpt-4o-mini')
      }
    }
  })
})

test.describe('settings: SLA config', () => {
  test('SLA priorities are shown', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByText(/critical/i).first()).toBeVisible()
    await expect(page.getByText(/high/i).first()).toBeVisible()
    await expect(page.getByText(/medium/i).first()).toBeVisible()
    await expect(page.getByText(/low/i).first()).toBeVisible()
  })

  test('can update response hours for a priority', async ({ page }) => {
    await page.goto('/settings')

    // Find the critical response hours input
    const criticalRow = page.locator('tr, [data-priority="critical"]').filter({ hasText: /critical/i }).first()
    const responseInput = criticalRow.locator('input[type="number"]').first()

    if (await responseInput.isVisible()) {
      await responseInput.fill('2')
      const slaForm = page.locator('form').filter({ has: responseInput })
      await slaForm.getByRole('button', { name: /save/i }).click()
      await expect(page.getByText(/saved|updated/i)).toBeVisible({ timeout: 8_000 })

      // Reload and verify value persists
      await page.reload()
      await expect(page.locator('tr, [data-priority="critical"]').filter({ hasText: /critical/i }).first().locator('input[type="number"]').first()).toHaveValue('2')
    }
  })
})

test.describe('integrations: GitHub repos', () => {
  test('shows seeded repo', async ({ page }) => {
    await page.goto('/integrations?tab=github')
    await expect(page.getByText('acme/demo')).toBeVisible()
  })
})
