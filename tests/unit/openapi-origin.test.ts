import { afterEach, describe, expect, it } from 'vitest'
import { openApiOrigin } from '@/lib/agent/openapi-origin'

const req = (headers: Record<string, string> = {}) =>
  new Request('http://localhost:3000/openapi.json', { headers })

describe('openApiOrigin', () => {
  const saved = { APP_URL: process.env.APP_URL, NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL }
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  it('returns undefined with no request so the spec uses the canonical URL', () => {
    expect(openApiOrigin()).toBeUndefined()
  })

  it('prefers the configured app origin over the internal request origin', () => {
    process.env.APP_URL = 'https://app.example.test/some/path'
    expect(openApiOrigin(req())).toBe('https://app.example.test')
  })

  it('uses forwarded host and proto when no app origin is configured', () => {
    delete process.env.APP_URL
    delete process.env.NEXT_PUBLIC_APP_URL
    expect(openApiOrigin(req({ 'x-forwarded-host': 'docs.example.test', 'x-forwarded-proto': 'https' }))).toBe(
      'https://docs.example.test',
    )
  })

  it('falls back to the request origin when nothing else is available', () => {
    delete process.env.APP_URL
    delete process.env.NEXT_PUBLIC_APP_URL
    expect(openApiOrigin(req())).toBe('http://localhost:3000')
  })
})
