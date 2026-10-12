import { test, expect } from '@playwright/test'
import { randomUUID } from 'crypto'
import { ingest, waitFor } from './helpers'

interface ReviewItem {
  id: number
  source: 'ticket' | 'widget'
  question: string
  answer: string
  occurrences: number
  status: 'pending' | 'approved' | 'rejected'
  article_id: number | null
}

interface ReviewResponse {
  items: ReviewItem[]
  counts: { pending: number; approved: number; rejected: number }
}

async function listItems(request: import('@playwright/test').APIRequestContext, status: string) {
  return (await request.get(`/api/kb/review?status=${status}`).then((r) => r.json())) as ReviewResponse
}

/**
 * Ingest a how-to question nothing in the KB can answer; the pipeline queues it.
 * The mock embedding is a hashed bag of words, so every word but "how do I" is
 * random — otherwise an article approved by an earlier test would match this
 * question and nothing would be queued.
 */
async function unseenQuestion(request: import('@playwright/test').APIRequestContext) {
  const words = Array.from({ length: 6 }, () => `qz${randomUUID().replace(/-/g, '').slice(0, 10)}`)
  const topic = words[0]
  const question = `How do I ${words.join(' ')}?`
  await ingest(request, { content: question })
  const item = await waitFor(async () => (await listItems(request, 'pending')).items.find((i) => i.question.includes(topic)) ?? false)
  return { question, topic, item }
}

test.describe('knowledge base review queue', () => {
  test('an unseen question lands in the queue, can be edited, and approving publishes it', async ({ request, page }) => {
    const { question, topic, item } = await unseenQuestion(request)
    expect(item.source).toBe('ticket')

    await page.goto('/kb?tab=review')
    const answer = page.locator(`#review-a-${item.id}`)
    await expect(page.locator(`#review-q-${item.id}`)).toHaveValue(new RegExp(topic))
    await answer.fill(`Open Settings and choose ${topic}, then restart the app.`)
    await page.getByRole('button', { name: /approve and add to knowledge base/i }).first().click()

    // The edited answer is what reached the knowledge base.
    const approved = await waitFor(async () => (await listItems(request, 'approved')).items.find((i) => i.id === item.id) ?? false)
    expect(approved.article_id).not.toBeNull()
    const articles = (await request.get('/api/kb').then((r) => r.json())) as { id: number; answer: string }[]
    expect(articles.find((a) => a.id === approved.article_id)?.answer).toContain(`choose ${topic}`)

    // And it is searchable now, so the same question no longer needs review.
    const { results } = (await request
      .get(`/api/kb/search?q=${encodeURIComponent(question)}`)
      .then((r) => r.json())) as { results: { id: number }[] }
    expect(results.some((a) => a.id === approved.article_id)).toBe(true)
  })

  test('asking the same unseen question again raises the count instead of adding a row', async ({ request }) => {
    const { question, topic, item } = await unseenQuestion(request)
    await ingest(request, { content: question })

    const merged = await waitFor(async () => {
      const found = (await listItems(request, 'pending')).items.filter((i) => i.question.includes(topic))
      return found.length === 1 && found[0].occurrences >= 2 ? found[0] : false
    })
    expect(merged.id).toBe(item.id)
  })

  test('rejecting removes it from the queue, and it can be moved back', async ({ request }) => {
    const { item } = await unseenQuestion(request)

    const reject = await request.patch(`/api/kb/review/${item.id}`, { data: { action: 'reject' } })
    expect(reject.status()).toBe(200)
    expect((await listItems(request, 'pending')).items.some((i) => i.id === item.id)).toBe(false)
    expect((await listItems(request, 'rejected')).items.some((i) => i.id === item.id)).toBe(true)

    // A second reject is a conflict, not a silent success.
    expect((await request.patch(`/api/kb/review/${item.id}`, { data: { action: 'reject' } })).status()).toBe(409)

    expect((await request.patch(`/api/kb/review/${item.id}`, { data: { action: 'reopen' } })).status()).toBe(200)
    expect((await listItems(request, 'pending')).items.some((i) => i.id === item.id)).toBe(true)
  })

  test('approving needs an answer and the item must exist in this workspace', async ({ request }) => {
    const { item } = await unseenQuestion(request)
    const blank = await request.patch(`/api/kb/review/${item.id}`, {
      data: { action: 'approve', question: item.question, answer: '  ' },
    })
    expect(blank.status()).toBe(400)
    const missing = await request.patch('/api/kb/review/999999', { data: { action: 'reject' } })
    expect(missing.status()).toBe(404)
  })
})
