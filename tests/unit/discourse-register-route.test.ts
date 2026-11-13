import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import listFixture from './fixtures/discourse-web-hooks-list.json'

/**
 * Behavioural tests for "Register webhook".
 *
 * The route used to call an event-types endpoint that Discourse does not have,
 * and the earlier tests could not tell: they only looked for a substring in the
 * source. These run the real route against a response captured from a real
 * Discourse (tests/unit/fixtures/discourse-web-hooks-list.json), so an endpoint
 * or response shape that Discourse does not actually serve fails here.
 */

const { discourseFetch, getIntegration, requireOrgAccess } = vi.hoisted(() => ({
  discourseFetch: vi.fn(),
  getIntegration: vi.fn(),
  requireOrgAccess: vi.fn(),
}))

vi.mock('@/lib/auth/org', () => ({ requireOrgAccess }))
vi.mock('@/lib/db/queries/integrations', () => ({ getIntegration }))
vi.mock('@/lib/discourse/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/discourse/client')>()),
  discourseFetch,
}))

import { POST } from '@/app/api/discourse/register/route'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const request = () => new NextRequest('http://localhost:3000/api/discourse/register', { method: 'POST' })

const INTEGRATION = {
  bot_token: '<api-key>',
  bot_username: 'answerloops-bot',
  team_id: 'https://forum.example.test',
  bot_secret: '<webhook-secret>',
  channel_ids: '["5"]',
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.AUTH_URL = 'https://app.example.test'
  requireOrgAccess.mockResolvedValue({ ok: true, orgId: 1 })
  getIntegration.mockResolvedValue({ ...INTEGRATION })
})

/** The paths discourseFetch was asked for, in order. */
const calledPaths = () => discourseFetch.mock.calls.map((c) => c[1] as string)
const bodyOf = (callIndex: number) => JSON.parse(discourseFetch.mock.calls[callIndex][2].body)

describe('register webhook against the real Discourse response shape', () => {
  it('reads event types from the webhook list and never calls a separate event-types endpoint', async () => {
    discourseFetch.mockResolvedValueOnce(json({ ...listFixture, web_hooks: [] })).mockResolvedValueOnce(json({ web_hook: { id: 2 } }))
    const res = await POST(request())
    expect(res.status).toBe(200)
    expect(calledPaths()[0]).toBe('/admin/api/web_hooks.json')
    expect(calledPaths().some((p) => p.includes('event_types'))).toBe(false)
  })

  it('subscribes to the topic and post events only, using Discourse\'s own ids', async () => {
    discourseFetch.mockResolvedValueOnce(json({ ...listFixture, web_hooks: [] })).mockResolvedValueOnce(json({ web_hook: { id: 2 } }))
    await POST(request())
    const created = bodyOf(1).web_hook
    expect(created.web_hook_event_type_ids).toEqual([101, 102, 103, 104, 105, 201, 202, 203, 204])
    // Other groups share the response and must be left out: user events, and
    // the like and voting events whose names also start with post_ or topic_.
    const others = Object.entries(listFixture.extras.grouped_event_types)
      .filter(([group]) => group !== 'topic' && group !== 'post')
      .flatMap(([, events]) => events.map((e) => e.id))
    expect(others.length).toBeGreaterThan(0)
    for (const id of others) expect(created.web_hook_event_type_ids).not.toContain(id)
    const likedOrVoted = Object.values(listFixture.extras.grouped_event_types).flat().filter((e) => /^(post_liked|topic_upvote|topic_unvote)$/.test(e.name))
    expect(likedOrVoted.length).toBe(3)
    for (const e of likedOrVoted) expect(created.web_hook_event_type_ids).not.toContain(e.id)
  })

  it('creates the webhook with the payload URL, secret, and watched categories', async () => {
    discourseFetch.mockResolvedValueOnce(json({ ...listFixture, web_hooks: [] })).mockResolvedValueOnce(json({ web_hook: { id: 2 } }))
    const res = await POST(request())
    expect(await res.json()).toEqual({ ok: true, webhookUrl: 'https://app.example.test/api/discourse/webhook' })
    expect(discourseFetch.mock.calls[1][2].method).toBe('POST')
    expect(calledPaths()[1]).toBe('/admin/api/web_hooks.json')
    const created = bodyOf(1).web_hook
    expect(created.payload_url).toBe('https://app.example.test/api/discourse/webhook')
    expect(created.secret).toBe('<webhook-secret>')
    expect(created.category_ids).toEqual([5])
    expect(created.active).toBe(true)
  })

  it('updates the existing webhook in place when one already points at this app', async () => {
    // The captured list holds a webhook for this exact URL.
    process.env.AUTH_URL = 'http://host.docker.internal:3111'
    discourseFetch.mockResolvedValueOnce(json(listFixture)).mockResolvedValueOnce(json({ ok: true }))
    const res = await POST(request())
    expect(res.status).toBe(200)
    expect(calledPaths()[1]).toBe(`/admin/api/web_hooks/${listFixture.web_hooks[0].id}.json`)
    expect(discourseFetch.mock.calls[1][2].method).toBe('PUT')
  })
})

describe('register webhook failures explain what went wrong', () => {
  it.each([404, 403])('a %i from the webhook list says only an admin account can do this, and points at the manual route', async (status) => {
    // Discourse answers 404 to any non-admin account on its webhook endpoints.
    discourseFetch.mockResolvedValueOnce(json({ errors: ['not found'] }, status))
    const res = await POST(request())
    expect(res.status).toBe(502)
    const { error } = await res.json()
    expect(error).toContain('Only an admin account can')
    expect(error).toContain('Add the webhook by hand')
  })

  it('a refused private payload URL tells the owner which Discourse setting to change', async () => {
    discourseFetch
      .mockResolvedValueOnce(json({ ...listFixture, web_hooks: [] }))
      .mockResolvedValueOnce(json({ errors: ['Payload URL cannot be used because it resolves to a blocked or internal IP'] }, 422))
    const res = await POST(request())
    expect(res.status).toBe(502)
    expect((await res.json()).error).toContain('allowed internal hosts')
  })

  it('any other failure stays generic', async () => {
    discourseFetch.mockResolvedValueOnce(json({}, 500))
    const res = await POST(request())
    expect(res.status).toBe(502)
    expect((await res.json()).error).toContain('Could not register the webhook')
  })

  it('fails cleanly when the list carries no topic or post events', async () => {
    discourseFetch.mockResolvedValueOnce(json({ web_hooks: [], extras: { grouped_event_types: { user: listFixture.extras.grouped_event_types.user } } }))
    const res = await POST(request())
    expect(res.status).toBe(502)
    expect(discourseFetch).toHaveBeenCalledTimes(1)
  })

  it('fails cleanly when the response has no extras at all', async () => {
    discourseFetch.mockResolvedValueOnce(json({ web_hooks: [] }))
    const res = await POST(request())
    expect(res.status).toBe(502)
    expect(discourseFetch).toHaveBeenCalledTimes(1)
  })
})

describe('register webhook preconditions', () => {
  it('requires a signed-in member of the workspace', async () => {
    requireOrgAccess.mockResolvedValue({ ok: false, error: 'Unauthorized' })
    expect((await POST(request())).status).toBe(401)
    expect(discourseFetch).not.toHaveBeenCalled()
  })

  it('asks for the key and username to be saved first', async () => {
    getIntegration.mockResolvedValue({ ...INTEGRATION, bot_token: null })
    expect((await POST(request())).status).toBe(400)
    expect(discourseFetch).not.toHaveBeenCalled()
  })
})
