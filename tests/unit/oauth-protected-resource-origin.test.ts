import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { GET } from '@/app/.well-known/oauth-protected-resource/route'

// The protected-resource metadata must point at the host the caller reached,
// not the internal address the server bound to behind a proxy.

const ENV_KEYS = ['APP_URL', 'NEXT_PUBLIC_APP_URL'] as const
let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = {}
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

const url = 'http://localhost:3000/.well-known/oauth-protected-resource'

describe('GET /.well-known/oauth-protected-resource', () => {
  it('uses the forwarded origin, not the internal address', async () => {
    const res = GET(
      new Request(url, {
        headers: { 'x-forwarded-host': 'docs.example.test', 'x-forwarded-proto': 'https' },
      }),
    )
    const body = await res.json()
    expect(body.resource).toBe('https://docs.example.test')
    expect(body.resource_documentation).toBe('https://docs.example.test/docs/integrations/agent-api')
  })

  it('prefers the configured APP_URL over forwarded headers', async () => {
    process.env.APP_URL = 'https://app.example.test'
    const res = GET(new Request(url, { headers: { 'x-forwarded-host': 'other.example.test' } }))
    expect((await res.json()).resource).toBe('https://app.example.test')
  })

  it('falls back to the request origin with no proxy headers', async () => {
    const res = GET(new Request(url))
    expect((await res.json()).resource).toBe('http://localhost:3000')
  })
})
