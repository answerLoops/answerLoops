import { test, expect } from '@playwright/test'
import { waitFor } from './helpers'

interface KBArticle {
  id: number
  question: string
  answer: string
  source_ticket_id: number | null
}

// URL ingest: form submission, article creation, validation errors.
// Under MOCK_EXTERNALS=1 Firecrawl is stubbed — ingestUrl returns mock content.

test.describe('KB URL ingest', () => {
  test('imports a single page and creates KB articles', async ({ request, page }) => {
    await page.goto('/kb')
    await expect(page.getByRole('heading', { name: 'Knowledge Base' })).toBeVisible()

    const urlInput = page.getByPlaceholder(/https:\/\//)
    await urlInput.fill('https://example.com/docs')

    // Select single page mode
    const modeSelect = page.locator('select[name="mode"]')
    if (await modeSelect.count() > 0) {
      await modeSelect.selectOption('page')
    }

    await page.getByRole('button', { name: /import/i }).click()

    // Success message with article count
    await expect(page.getByText(/imported|article/i)).toBeVisible({ timeout: 15_000 })

    // Article appears in KB list
    const articles = await waitFor(async () => {
      const list = (await request.get('/api/kb').then((r) => r.json())) as KBArticle[]
      return list.length > 0 ? list : false
    })
    expect(articles.length).toBeGreaterThan(0)
  })

  test('imports a full site (mock returns 1 page)', async ({ page }) => {
    await page.goto('/kb')

    const urlInput = page.getByPlaceholder(/https:\/\//)
    await urlInput.fill('https://docs.example.com')

    const modeSelect = page.locator('select[name="mode"]')
    if (await modeSelect.count() > 0) {
      await modeSelect.selectOption('site')
    }

    await page.getByRole('button', { name: /import/i }).click()
    // Not a broad /article/i match: the mock content preview paragraph for
    // an already-imported page can itself contain the word "articles" in its
    // body text, so a loose match can hit two elements at once.
    await expect(page.getByText(/\d+ articles?( added| from \d+ pages)?/i).first()).toBeVisible({ timeout: 15_000 })
  })

  test('shows validation error for empty URL', async ({ page }) => {
    await page.goto('/kb')
    await page.getByRole('button', { name: /import/i }).first().click()
    // The URL field is a native `required` input — the browser blocks
    // submission itself (no custom error text is rendered), so this checks
    // the field failed constraint validation rather than page text.
    const urlInput = page.getByPlaceholder(/https:\/\//)
    await expect(urlInput).toHaveJSProperty('validity.valueMissing', true)
  })

  test('shows validation error for non-URL string', async ({ page }) => {
    await page.goto('/kb')
    const urlInput = page.getByPlaceholder(/https:\/\//)
    await urlInput.fill('not-a-url')
    await page.getByRole('button', { name: /import/i }).first().click()
    // Same native constraint validation — type="url" rejects a non-URL
    // string before the form ever submits.
    await expect(urlInput).toHaveJSProperty('validity.typeMismatch', true)
  })
})
