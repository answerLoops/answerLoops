import { randomUUID } from 'crypto'
import { test, expect, type Page } from '@playwright/test'
import { createArticle, deleteArticle, textSearchArticles } from '../lib/db/queries/kb'
import { DEFAULT_ORG_ID } from '../lib/db/schema'
import { REVIEW_EFFECT } from '../lib/kb/review-state'

// Needs-review and superseded articles in the real dashboard, on a phone-sized
// viewport: flagging keeps an article in answers, superseding takes it out and
// restoring brings it back, each behind a confirmation that states the effect.
// Answers are checked through textSearchArticles, the same query the answer
// paths fall back to, against the real database.

test.use({ viewport: { width: 375, height: 812 } })

const created: number[] = []
test.afterAll(async () => {
  for (const id of created) await deleteArticle(id, DEFAULT_ORG_ID)
})

async function newArticle(question: string, answer: string) {
  const article = await createArticle(
    { question, answer, embedding: Array.from({ length: 1536 }, () => 0.01), model: 'test-model' },
    DEFAULT_ORG_ID
  )
  created.push(article.id)
  return article
}

/** True when nothing on the page is wider than the viewport. */
async function fitsViewport(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
}

function card(page: Page, articleId: number) {
  return page.locator(`#article-${articleId}`)
}

test.describe('article review states', () => {
  test('flag an article: it stays in answers and shows under Needs review', async ({ page }) => {
    const tag = randomUUID().slice(0, 8)
    const article = await newArticle(`Flag me ${tag}`, `Answer ${tag}`)

    await page.goto('/kb')
    const c = card(page, article.id)
    await c.getByRole('button', { name: 'Flag for review' }).click()
    await expect(c.getByText(REVIEW_EFFECT.flag)).toBeVisible()
    await c.getByLabel('Reason (optional)').fill('Pricing changed')
    await c.getByRole('button', { name: 'Flag for review' }).click()

    await expect(c.getByText(/Needs review/)).toBeVisible()
    await expect(c.getByText('Pricing changed')).toBeVisible()
    expect(await fitsViewport(page)).toBe(true)

    // Still used for answers.
    expect((await textSearchArticles(tag, 10, DEFAULT_ORG_ID)).map((a) => a.id)).toContain(article.id)

    await page.getByLabel('Show').selectOption('needs_review')
    await expect(card(page, article.id)).toBeVisible()
    expect(await fitsViewport(page)).toBe(true)
    await page.screenshot({ path: 'test-results/kb-review-state-needs-review-375.png', fullPage: false })

    await card(page, article.id).getByRole('button', { name: 'Clear review flag' }).click()
    await expect(card(page, article.id).getByText(REVIEW_EFFECT.clearFlag)).toBeVisible()
    await card(page, article.id).getByRole('button', { name: 'Clear review flag' }).click()
    await expect(page.getByText('No articles need review.').or(page.locator(`#article-${article.id}`))).toBeVisible()
  })

  test('supersede an article with a link, then restore it', async ({ page }) => {
    const tag = randomUUID().slice(0, 8)
    const article = await newArticle(`Old answer ${tag}`, `Outdated ${tag}`)

    await page.goto('/kb')
    const c = card(page, article.id)
    await c.getByRole('button', { name: 'Mark as superseded' }).click()
    await expect(c.getByText(REVIEW_EFFECT.supersede)).toBeVisible()
    await c.getByLabel('A documentation link').check()
    await c.getByLabel('Documentation link', { exact: true }).fill('https://docs.example.com/new-answer')
    expect(await fitsViewport(page)).toBe(true)
    await page.screenshot({ path: 'test-results/kb-review-state-supersede-form-375.png', fullPage: false })
    await c.getByRole('button', { name: 'Mark as superseded' }).click()

    await expect(c.getByText(/Superseded/)).toBeVisible()
    await expect(c.getByRole('link', { name: 'https://docs.example.com/new-answer' })).toHaveAttribute('target', '_blank')
    expect(await fitsViewport(page)).toBe(true)

    // Out of answers.
    expect((await textSearchArticles(tag, 10, DEFAULT_ORG_ID)).map((a) => a.id)).not.toContain(article.id)

    await c.getByRole('button', { name: 'Restore to answers' }).click()
    await expect(c.getByText(REVIEW_EFFECT.restore)).toBeVisible()
    await c.getByRole('button', { name: 'Restore to answers' }).click()
    await expect(c.getByRole('button', { name: 'Flag for review' })).toBeVisible()

    // Back in answers.
    expect((await textSearchArticles(tag, 10, DEFAULT_ORG_ID)).map((a) => a.id)).toContain(article.id)
  })

  test('supersede an article with another article; the history records each step', async ({ page }) => {
    const tag = randomUUID().slice(0, 8)
    const replacement = await newArticle(`New answer ${tag}`, `Current ${tag}`)
    const article = await newArticle(`Replaced answer ${tag}`, `Stale ${tag}`)

    await page.goto('/kb')
    const c = card(page, article.id)
    await c.getByRole('button', { name: 'Mark as superseded' }).click()
    await c.getByLabel('Replacement article').selectOption(String(replacement.id))
    await c.getByRole('button', { name: 'Mark as superseded' }).click()

    await expect(c.getByRole('link', { name: `New answer ${tag}` })).toHaveAttribute('href', `#article-${replacement.id}`)
    expect((await textSearchArticles(tag, 10, DEFAULT_ORG_ID)).map((a) => a.id)).toEqual([replacement.id])

    await c.getByRole('button', { name: /Show history/ }).click()
    await expect(c.getByText('Marked as superseded')).toBeVisible()
  })
})
