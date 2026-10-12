import { test, expect } from '@playwright/test'
import { getDb } from '../lib/db/drizzle'
import { githubRepos } from '../lib/db/schema'
import { ingest, waitFor } from './helpers'

test.describe('GET /api/tickets', () => {
  test('lists tickets and filters by status', async ({ request }) => {
    await ingest(request, { content: 'How do I configure the client?' })

    const all = await request.get('/api/tickets')
    expect(all.ok()).toBeTruthy()
    const list = (await all.json()) as Array<{ id: number; status: string }>
    expect(Array.isArray(list)).toBe(true)
    expect(list.length).toBeGreaterThan(0)

    const open = await request.get('/api/tickets?status=open')
    const openList = (await open.json()) as Array<{ status: string }>
    expect(openList.length).toBeGreaterThan(0)
    expect(openList.every((t) => t.status === 'open')).toBe(true)

    // Nothing is ever closed by the suite → the filter yields an empty list.
    const closed = await request.get('/api/tickets?status=closed')
    expect((await closed.json()).length).toBe(0)
  })
})

test.describe('GET /api/tickets/[id]', () => {
  test('returns a ticket with replies and events, 404 otherwise', async ({ request }) => {
    const ticketId = await ingest(request, { content: 'How do I configure the client?' })

    const res = await request.get(`/api/tickets/${ticketId}`)
    expect(res.ok()).toBeTruthy()
    const body = (await res.json()) as { ticket: { id: number }; replies: unknown[]; events: unknown[] }
    expect(body.ticket.id).toBe(ticketId)
    expect(Array.isArray(body.replies)).toBe(true)
    expect(Array.isArray(body.events)).toBe(true)

    const missing = await request.get('/api/tickets/999999')
    expect(missing.status()).toBe(404)
  })
})

test.describe('FAQ', () => {
  test('generate then fetch the latest snapshot', async ({ request }) => {
    const gen = await request.post('/api/faq/generate')
    expect(gen.ok()).toBeTruthy()
    const genBody = (await gen.json()) as { ok: boolean; snapshot_id: number }
    expect(genBody.ok).toBe(true)

    const faq = await request.get('/api/faq')
    const body = (await faq.json()) as { content: string | null }
    expect(body.content).toContain('FAQ')
  })
})

test.describe('GitHub repos', () => {
  test('lists the seeded repo and deletes one', async ({ request }) => {
    // Insert a throwaway repo via the runner connection, then drive the API.
    const [inserted] = await getDb()
      .insert(githubRepos)
      .values({ installationId: 2, owner: 'temp', repo: 'todelete', isPrivate: 0, orgId: 1 })
      .returning({ id: githubRepos.id })
    const id = inserted.id

    // The runner and server are separate processes; poll until the server sees it.
    await waitFor(async () => {
      const repos = (await request.get('/api/github/repos').then((r) => r.json())) as Array<{ id: number }>
      return repos.some((r) => r.id === id)
    })

    const del = await request.delete(`/api/github/repos/${id}`)
    expect((await del.json()).ok).toBe(true)

    await waitFor(async () => {
      const repos = (await request.get('/api/github/repos').then((r) => r.json())) as Array<{ id: number }>
      return !repos.some((r) => r.id === id)
    })
  })
})

test.describe('Push', () => {
  test('rejects an invalid subscription, accepts a valid one', async ({ request }) => {
    const bad = await request.post('/api/push/subscribe', { data: { endpoint: 'not-a-url' } })
    expect(bad.status()).toBe(400)

    const good = await request.post('/api/push/subscribe', {
      data: {
        endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-subscription',
        keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
      },
    })
    expect((await good.json()).ok).toBe(true)

    // Upsert (same endpoint) is accepted too — exercises the ON CONFLICT path.
    const again = await request.post('/api/push/subscribe', {
      data: {
        endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-subscription',
        keys: { p256dh: 'p256dh-key-2', auth: 'auth-key-2' },
      },
    })
    expect((await again.json()).ok).toBe(true)
  })

  test('exposes the VAPID public key', async ({ request }) => {
    const res = await request.get('/api/push/vapid-key')
    expect((await res.json()).publicKey).toBe('BL_test_vapid_public_key')
  })
})
