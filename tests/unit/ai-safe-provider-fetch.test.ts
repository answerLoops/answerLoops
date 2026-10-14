import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

// Real local server with the private-network opt-out and DNS mocked, proving the
// provider fetch streams, connects to the validated address, refuses blocked
// hosts, does not follow redirects, and enforces the response ceiling.

const h = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup: h.lookup }))

import { createSafeProviderFetch } from '@/lib/ai/safe-provider-fetch'
import { UnsafeUrlError } from '@/lib/http/safe-url'

let server: http.Server
let port = 0
const seen: { url?: string; body: string; method?: string }[] = []

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      seen.push({ url: req.url, body, method: req.method })
      if (req.url === '/stream') {
        res.setHeader('content-type', 'text/event-stream')
        res.write('data: one\n\n')
        setTimeout(() => {
          res.write('data: two\n\n')
          res.end()
        }, 50)
      } else if (req.url === '/redirect') {
        res.statusCode = 302
        res.setHeader('location', '/stream')
        res.end()
      } else if (req.url === '/big') {
        res.end('x'.repeat(5000))
      } else {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ echo: body }))
      }
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  port = (server.address() as AddressInfo).port
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))

beforeEach(() => {
  seen.length = 0
  process.env.ALLOW_PRIVATE_OUTBOUND_URLS = 'true'
  delete process.env.DEPLOYMENT_MODE
  h.lookup.mockReset()
  h.lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
})

const url = (p: string) => `http://llm.example.test:${port}${p}`

describe('createSafeProviderFetch', () => {
  it('delivers response chunks as they arrive', async () => {
    const f = createSafeProviderFetch()
    const res = await f(url('/stream'))
    const reader = res.body!.getReader()
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toContain('data: one')
    let rest = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      rest += new TextDecoder().decode(value)
    }
    expect(rest).toContain('data: two')
  })

  it('sends method, headers and string body through', async () => {
    const f = createSafeProviderFetch()
    const res = await f(url('/chat'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' })
    expect(await res.json()).toEqual({ echo: '{"a":1}' })
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/chat' })
  })

  it('refuses a host that resolves to a non-public address in production', async () => {
    process.env.ALLOW_PRIVATE_OUTBOUND_URLS = 'false'
    process.env.DEPLOYMENT_MODE = 'cloud'
    const f = createSafeProviderFetch()
    await expect(f('https://llm.example.test/v1/chat')).rejects.toBeInstanceOf(UnsafeUrlError)
    expect(seen).toHaveLength(0)
  })

  it('refuses plain http outside the private opt-out', async () => {
    process.env.ALLOW_PRIVATE_OUTBOUND_URLS = 'false'
    process.env.DEPLOYMENT_MODE = 'cloud'
    const f = createSafeProviderFetch()
    await expect(f(url('/x'))).rejects.toBeInstanceOf(UnsafeUrlError)
  })

  it('does not follow redirects', async () => {
    const f = createSafeProviderFetch()
    const res = await f(url('/redirect'))
    expect(res.status).toBe(302)
    expect(seen.map((s) => s.url)).toEqual(['/redirect'])
  })

  it('errors the stream once the response exceeds the ceiling', async () => {
    const f = createSafeProviderFetch({ maxResponseBytes: 1000 })
    const res = await f(url('/big'))
    await expect(res.text()).rejects.toThrow()
  })

  it('aborts when the caller signal fires', async () => {
    const f = createSafeProviderFetch()
    const ac = new AbortController()
    ac.abort()
    await expect(f(url('/stream'), { signal: ac.signal })).rejects.toThrow()
  })
})
