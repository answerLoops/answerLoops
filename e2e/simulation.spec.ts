import { test, expect } from '@playwright/test'
import { ingest, waitForPipeline } from './helpers'

interface SimDoneEvent {
  type: 'done'
  config: { count: number; model: string; threshold: number }
  results: Array<{ id: number; match: boolean; simConfidence: number }>
  summary: { total: number; matchRate: number }
}

// Simulation: run against seeded tickets, verify result structure.

test.describe('simulation', () => {
  test('simulation page renders', async ({ page }) => {
    await page.goto('/simulation')
    await expect(page.getByRole('heading', { name: 'Simulation Mode' })).toBeVisible()
  })

  test('POST /api/simulation/run returns results for seeded tickets', async ({ request }) => {
    // Seed some resolved tickets to simulate against
    const id1 = await ingest(request, { content: 'How do I configure the client connection?' })
    const id2 = await ingest(request, { content: 'How do I authenticate the client?' })
    await Promise.all([waitForPipeline(request, id1), waitForPipeline(request, id2)])

    const res = await request.post('/api/simulation/run', {
      data: { count: 2, threshold: 0.8 },
    })
    expect(res.ok()).toBeTruthy()

    // The route streams newline-delimited JSON progress events, not a single
    // JSON body — the result this test cares about is the final 'done' event.
    const text = await res.text()
    const events = text.trim().split('\n').map((line) => JSON.parse(line) as { type: string })
    const done = events.find((e) => e.type === 'done') as SimDoneEvent | undefined
    expect(done).toBeDefined()
    const body = done!

    expect(body.config.count).toBe(2)
    expect(Array.isArray(body.results)).toBe(true)
    expect(typeof body.summary.total).toBe('number')
    expect(typeof body.summary.matchRate).toBe('number')
    expect(body.summary.matchRate).toBeGreaterThanOrEqual(0)
    expect(body.summary.matchRate).toBeLessThanOrEqual(1)
  })

  test('rejects count out of range', async ({ request }) => {
    const res = await request.post('/api/simulation/run', { data: { count: 0 } })
    expect(res.status()).toBe(400)
  })

  test('requires authentication', async () => {
    const res = await fetch('http://localhost:3100/api/simulation/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 5 }),
    })
    expect(res.status).toBe(401)
  })
})
