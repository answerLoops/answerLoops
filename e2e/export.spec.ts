import { test, expect } from '@playwright/test'
import { ingest } from './helpers'

// /api/export/tickets and /api/export/leads — CSV export endpoints.

test.describe('export: tickets CSV', () => {
  test('returns CSV with correct headers', async ({ request }) => {
    await ingest(request, { content: 'How do I configure the client?' })

    const res = await request.get('/api/export/tickets')
    expect(res.ok()).toBeTruthy()
    expect(res.headers()['content-type']).toMatch(/text\/csv/)

    const text = await res.text()
    const headers = text.split('\n')[0]
    expect(headers).toContain('id')
    expect(headers).toContain('status')
    expect(headers).toContain('category')
    expect(headers).toContain('content')
  })

  test('CSV rows match ticket count', async ({ request }) => {
    await ingest(request, { content: 'How do I configure the client?' })
    await ingest(request, { content: 'How do I authenticate the client?' })

    const res = await request.get('/api/export/tickets')
    const text = await res.text()
    // At least 2 data rows (plus header)
    const rows = text.trim().split('\n').filter(Boolean)
    expect(rows.length).toBeGreaterThanOrEqual(3) // header + 2+ tickets
  })

  test('requires authentication', async () => {
    const res = await fetch('http://localhost:3100/api/export/tickets')
    expect(res.status).toBe(401)
  })
})

test.describe('export: leads CSV', () => {
  test('returns CSV with correct headers', async ({ request }) => {
    const res = await request.get('/api/export/leads')
    expect(res.ok()).toBeTruthy()
    expect(res.headers()['content-type']).toMatch(/text\/csv/)

    const text = await res.text()
    const headers = text.split('\n')[0]
    // Leads only ever capture an email + widget token — there's no name field.
    expect(headers).toContain('id')
    expect(headers).toContain('email')
    expect(headers).toContain('widget_token')
    expect(headers).toContain('created_at')
  })

  test('requires authentication', async () => {
    const res = await fetch('http://localhost:3100/api/export/leads')
    expect(res.status).toBe(401)
  })
})
