import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GET as rootGET } from '@/app/openapi.json/route'
import { GET as agentGET } from '@/app/api/v1/agent/openapi.json/route'

// Both OpenAPI routes must advertise the host the caller reached (via the
// proxy's forwarded headers), not the internal address the server bound to,
// and fall back to the canonical hosted URL when called with no request.

const routes = [
  ['/openapi.json', rootGET],
  ['/api/v1/agent/openapi.json', agentGET],
] as const

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

describe.each(routes)('GET %s', (path, GET) => {
  it('advertises the forwarded origin, not the internal address', async () => {
    const req = new Request(`http://localhost:3000${path}`, {
      headers: {
        'x-forwarded-host': 'docs.example.test',
        'x-forwarded-proto': 'https',
      },
    })
    const body = await GET(req).json()
    expect(body.servers[0].url).toBe('https://docs.example.test')
    expect(JSON.stringify(body.servers)).not.toContain('localhost')
  })

  it('falls back to the canonical hosted URL with no request', async () => {
    const res = GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.servers[0].url).toBe('https://answerloops.com')
  })
})

describe('docs base URL and rate-limit claims', () => {
  const read = (f: string) =>
    readFileSync(join(process.cwd(), 'content/docs/integrations', f), 'utf8')

  it('mcp.mdx does not claim REST and MCP rate-limit counters are shared', () => {
    const mcp = read('mcp.mdx')
    expect(mcp).not.toMatch(/shared (across|with) (the )?(REST|Agent API)/i)
    expect(mcp).toMatch(/separate counters/i)
  })

  it.each(['mcp.mdx', 'agent-api.mdx'])('%s names the hosted base URL', (file) => {
    expect(read(file)).toContain('https://answerloops.com')
  })
})
