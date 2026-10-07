import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Behavioural guard for the feedback board's live signal in the SSE route.
// product-feedback-infra.test.ts only pins the source text; this drives the
// real ReadableStream and checks what a browser would actually receive.

const { instances, postgresFactory, auth } = vi.hoisted(() => {
  const made: { options: Record<string, unknown> }[] = []
  const factory = vi.fn((_url: string, options: Record<string, unknown>) => {
    const sql = () => {}
    Object.assign(sql, {
      options,
      unsafe: vi.fn(async () => []),
      end: vi.fn(async () => {}),
    })
    made.push(sql as never)
    return sql
  })
  const authFn = vi.fn(async () => ({ user: { id: 1 }, orgId: 7 }))
  return { instances: made, postgresFactory: factory, auth: authFn }
})

vi.mock('postgres', () => ({ default: postgresFactory }))
vi.mock('@/auth', () => ({ auth }))
vi.mock('@/lib/db/direct-url', () => ({ getDirectDatabaseUrl: () => 'postgres://user@localhost:5432/db' }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))

import { GET } from '@/app/api/events/stream/route'

const decoder = new TextDecoder()

async function open() {
  const res = await GET(new Request('https://app.example.com/api/events/stream') as never)
  const reader = res.body!.getReader()
  const next = async () => decoder.decode((await reader.read()).value!)
  expect(await next()).toContain('event: connected')
  const notify = instances[0].options.onnotify as (channel: string, payload: string) => void
  return { reader, next, notify }
}

describe('SSE stream — product_feedback_changed forwarding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    instances.length = 0
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('forwards feedback_changed when the widget is enabled', async () => {
    vi.stubEnv('FEEDBACK_WIDGET_ENABLED', 'true')
    const { reader, next, notify } = await open()
    notify('product_feedback_changed', '')
    expect(await next()).toBe('event: feedback_changed\ndata: {}\n\n')
    await reader.cancel()
  })

  it('forwards it regardless of which org the stream belongs to (payload is not org-filtered)', async () => {
    vi.stubEnv('FEEDBACK_WIDGET_ENABLED', '1')
    const { reader, next, notify } = await open() // this stream is org 7
    // An empty payload, and a payload naming a different org, both still deliver.
    notify('product_feedback_changed', '')
    expect(await next()).toContain('event: feedback_changed')
    notify('product_feedback_changed', '999')
    expect(await next()).toContain('event: feedback_changed')
    await reader.cancel()
  })

  it('sends nothing for it when the widget is disabled', async () => {
    vi.stubEnv('FEEDBACK_WIDGET_ENABLED', '')
    const { reader, next, notify } = await open()
    notify('product_feedback_changed', '')
    // The next frame must be the later org event, proving the feedback one was skipped.
    notify('data_changed', '7')
    expect(await next()).toContain('event: data_changed')
    await reader.cancel()
  })

  it('reads the flag per notification, not once at connect time', async () => {
    vi.stubEnv('FEEDBACK_WIDGET_ENABLED', 'true')
    const { reader, next, notify } = await open()
    vi.stubEnv('FEEDBACK_WIDGET_ENABLED', 'false')
    notify('product_feedback_changed', '')
    notify('member_joined', '7')
    expect(await next()).toContain('event: member_joined')
    await reader.cancel()
  })

  it('org-scoped channels are still filtered to the stream org', async () => {
    vi.stubEnv('FEEDBACK_WIDGET_ENABLED', 'true')
    const { reader, next, notify } = await open()
    notify('data_changed', '999') // other org: dropped
    notify('product_feedback_changed', '')
    expect(await next()).toContain('event: feedback_changed')
    await reader.cancel()
  })
})
