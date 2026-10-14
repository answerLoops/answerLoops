import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

// Real local HTTP server, the private-network opt-out, and DNS mocked so made-up
// hostnames resolve to the local server. Proves the connection goes to the
// validated address, every redirect hop is re-validated, and the caps hold.

const h = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup: h.lookup }))

// Wrap the real guard so a hop to "blocked.test" is refused (the opt-out would
// otherwise allow everything), proving safeFetch calls the guard on each hop.
vi.mock('@/lib/http/safe-url', async () => {
  const actual = await vi.importActual<typeof import('@/lib/http/safe-url')>('@/lib/http/safe-url')
  return {
    ...actual,
    resolvePublicHttpsUrl: async (raw: string) => {
      if (new URL(raw).hostname === 'blocked.test') throw new actual.UnsafeUrlError('blocked')
      return actual.resolvePublicHttpsUrl(raw)
    },
  }
})

import { safeFetch } from '@/lib/http/safe-fetch'
import { UnsafeUrlError } from '@/lib/http/safe-url'

let server: http.Server
let port = 0
const seen: { url?: string; headers: http.IncomingHttpHeaders; body: string; method?: string }[] = []

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      seen.push({ url: req.url, headers: req.headers, body, method: req.method })
      const redirect = (to: string, status = 302) => {
        res.statusCode = status
        res.setHeader('location', to)
        res.end()
      }
      switch (req.url) {
        case '/ok':
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ hello: 'world' }))
          break
        case '/redirect-blocked':
          redirect('http://blocked.test/secret')
          break
        case '/redirect-same':
          redirect('/ok')
          break
        case '/redirect-other-host':
          redirect(`http://other.example.test:${port}/ok`)
          break
        case '/redirect-303':
          redirect('/ok', 303)
          break
        case '/loop':
          redirect('/loop')
          break
        case '/big':
          res.end('x'.repeat(5000))
          break
        case '/slow':
          setTimeout(() => res.end('late'), 2000)
          break
        default:
          res.statusCode = 404
          res.end('missing')
      }
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  port = (server.address() as AddressInfo).port
})

afterAll(() => {
  server.closeAllConnections?.()
  server.close()
})

beforeEach(() => {
  seen.length = 0
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('ALLOW_PRIVATE_OUTBOUND_URLS', 'true')
  h.lookup.mockReset()
  h.lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
})

describe('safeFetch', () => {
  it('connects to the validated address while keeping the original Host header', async () => {
    const res = await safeFetch(`http://pinned.example.test:${port}/ok`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ hello: 'world' })
    expect(seen[0].headers.host).toBe(`pinned.example.test:${port}`)
  })

  it('resolves once per hop and never consults DNS again at connect time', async () => {
    h.lookup.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
    h.lookup.mockResolvedValue([{ address: '10.255.255.1', family: 4 }])
    const res = await safeFetch(`http://rebind.example.test:${port}/ok`)
    expect(res.status).toBe(200)
    expect(h.lookup).toHaveBeenCalledTimes(1)
  })

  it('sends method, headers and body', async () => {
    await safeFetch(`http://pinned.example.test:${port}/ok`, {
      method: 'POST',
      headers: { 'Api-Key': 'k', 'Content-Type': 'application/json' },
      body: JSON.stringify({ a: 1 }),
    })
    expect(seen[0].method).toBe('POST')
    expect(seen[0].headers['api-key']).toBe('k')
    expect(seen[0].body).toBe('{"a":1}')
  })

  it('follows a same-host redirect', async () => {
    const res = await safeFetch(`http://pinned.example.test:${port}/redirect-same`)
    expect(res.status).toBe(200)
    expect(seen.map((s) => s.url)).toEqual(['/redirect-same', '/ok'])
  })

  it('re-validates the redirect target and refuses a disallowed one without connecting', async () => {
    await expect(safeFetch(`http://pinned.example.test:${port}/redirect-blocked`)).rejects.toBeInstanceOf(UnsafeUrlError)
    expect(seen.map((s) => s.url)).toEqual(['/redirect-blocked'])
  })

  it('drops credential headers when a redirect crosses to another origin', async () => {
    await safeFetch(`http://pinned.example.test:${port}/redirect-other-host`, {
      headers: { 'Api-Key': 'k', Authorization: 'Bearer t', Accept: 'application/json' },
    })
    expect(seen[0].headers['api-key']).toBe('k')
    expect(seen[1].headers['api-key']).toBeUndefined()
    expect(seen[1].headers.authorization).toBeUndefined()
    expect(seen[1].headers.accept).toBe('application/json')
  })

  it('turns a 303 on a POST into a bodyless GET', async () => {
    await safeFetch(`http://pinned.example.test:${port}/redirect-303`, { method: 'POST', body: 'x=1' })
    expect(seen[1].method).toBe('GET')
    expect(seen[1].body).toBe('')
  })

  it('gives up after a few redirects', async () => {
    await expect(safeFetch(`http://pinned.example.test:${port}/loop`)).rejects.toThrow(/redirect/i)
    expect(seen.length).toBeLessThanOrEqual(5)
  })

  it('aborts when the response exceeds the size cap', async () => {
    await expect(safeFetch(`http://pinned.example.test:${port}/big`, { maxBytes: 1000 })).rejects.toThrow()
  })

  it('times out slow responses', async () => {
    await expect(safeFetch(`http://pinned.example.test:${port}/slow`, { timeoutMs: 100 })).rejects.toThrow()
  })

  it('rejects disallowed URLs before connecting', async () => {
    vi.stubEnv('ALLOW_PRIVATE_OUTBOUND_URLS', '')
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
    await expect(safeFetch(`http://pinned.example.test:${port}/ok`)).rejects.toBeInstanceOf(UnsafeUrlError)
    expect(seen).toHaveLength(0)
  })
})
