import { test, expect } from '@playwright/test'
import { randomUUID } from 'crypto'
import { waitFor } from './helpers'

interface KBArticle {
  id: number
  question: string
  answer: string
  source_ticket_id: number | null
  source_id: number | null
  published: number
}

/** Random words only, so the mock bag-of-words embedding matches nothing else in the KB. */
function uniqueQuestion() {
  const words = Array.from({ length: 6 }, () => `qz${randomUUID().replace(/-/g, '').slice(0, 10)}`)
  return { topic: words[0], question: `Does ${words.join(' ')} apply?` }
}

test.describe('add knowledge by hand', () => {
  test('an article written in the dashboard is published, listed, and searchable', async ({ page, request }) => {
    const { topic, question } = uniqueQuestion()
    const answer = `Yes, ${topic} applies to every workspace on the Pro plan.`

    await page.goto('/kb')
    await page.locator('#add-knowledge-question').fill(question)
    await page.locator('#add-knowledge-answer').fill(answer)
    await page.getByRole('button', { name: 'Add to knowledge base' }).click()

    await expect(page.getByRole('status').filter({ hasText: 'Added' })).toBeVisible()
    // The form is ready for the next entry.
    await expect(page.locator('#add-knowledge-question')).toHaveValue('')
    await expect(page.locator('#add-knowledge-answer')).toHaveValue('')

    // Stored as a published, hand-written article: no source file, no ticket.
    const stored = (await waitFor(async () => {
      const all = (await request.get('/api/kb').then((r) => r.json())) as KBArticle[]
      return all.find((a) => a.question === question) ?? false
    })) as KBArticle
    expect(stored.answer).toBe(answer)
    expect(stored.published).toBe(1)
    expect(stored.source_ticket_id).toBeNull()
    expect(stored.source_id).toBeNull()

    // It appears in the page's list without a reload...
    await expect(page.getByText(question).first()).toBeVisible()

    // ...and the assistant's own lookup can find it straight away.
    const { results } = (await request
      .get(`/api/kb/search?q=${encodeURIComponent(question)}`)
      .then((r) => r.json())) as { results: { id: number }[] }
    expect(results.some((a) => a.id === stored.id)).toBe(true)
  })

  test('the button stays disabled until both fields have text, and typing alone writes nothing', async ({ page, request }) => {
    const { topic, question } = uniqueQuestion()
    await page.goto('/kb')
    const button = page.getByRole('button', { name: 'Add to knowledge base' })

    await expect(button).toBeDisabled()
    await page.locator('#add-knowledge-question').fill(question)
    await expect(button).toBeDisabled()
    await page.locator('#add-knowledge-answer').fill('   ')
    await expect(button).toBeDisabled()
    await page.locator('#add-knowledge-answer').fill(`Answer for ${topic}.`)
    await expect(button).toBeEnabled()

    // Nothing was written by merely typing.
    const all = (await request.get('/api/kb').then((r) => r.json())) as KBArticle[]
    expect(all.some((a) => a.question === question)).toBe(false)
  })

  test('two articles in a row both land', async ({ page, request }) => {
    const first = uniqueQuestion()
    const second = uniqueQuestion()
    await page.goto('/kb')
    for (const { question, topic } of [first, second]) {
      await page.locator('#add-knowledge-question').fill(question)
      await page.locator('#add-knowledge-answer').fill(`Answer for ${topic}.`)
      await page.getByRole('button', { name: 'Add to knowledge base' }).click()
      await expect(page.locator('#add-knowledge-question')).toHaveValue('')
    }
    await waitFor(async () => {
      const all = (await request.get('/api/kb').then((r) => r.json())) as KBArticle[]
      return all.some((a) => a.question === first.question) && all.some((a) => a.question === second.question)
    })
  })
})
