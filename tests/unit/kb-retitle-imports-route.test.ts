import { describe, it, expect, vi } from 'vitest'
import fs from 'fs'

// The bot's re-title sweep POSTs here with BOT_SECRET; the app lists
// workspaces with earlier page imports still to re-title and runs each, so
// model and billing config live only in the app service.

const mocks = (o: { authorized?: boolean; list?: () => Promise<number[]>; run?: (orgId: number) => Promise<unknown> } = {}) => {
  vi.doMock('@/lib/http/bearer-auth', () => ({ isPlatformBotRequest: () => o.authorized ?? true }))
  vi.doMock('@/lib/kb/retitle-imports', () => ({
    listRetitleCandidates: o.list ?? vi.fn(async () => []),
    runRetitlePass: o.run ?? vi.fn(async () => ({ retitled: 0, sourcesDone: 0, remainingSources: 0 })),
  }))
  vi.doMock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
}
const post = async () => {
  const { POST } = await import('@/app/api/kb/retitle-imports/run/route')
  return POST(new Request('https://x.test/api', { method: 'POST' }))
}

describe('POST /api/kb/retitle-imports/run', () => {
  it('401 without the bot secret, touching nothing', async () => {
    vi.resetModules()
    const list = vi.fn()
    mocks({ authorized: false, list })
    expect((await post()).status).toBe(401)
    expect(list).not.toHaveBeenCalled()
  })

  it('runs every candidate as a scheduled pass and continues past a failure', async () => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
    const run = vi.fn(async (orgId: number) => {
      if (orgId === 2) throw new Error('boom')
      return { retitled: 1, sourcesDone: 1, remainingSources: 0 }
    })
    mocks({ list: async () => [1, 2, 3], run })
    expect(await (await post()).json()).toEqual({ ok: true, orgs: 3 })
    expect(run).toHaveBeenCalledTimes(3)
    expect(run).toHaveBeenCalledWith(1, { mode: 'scheduled' })
  })

  it('runs nothing on a self-hosted install, where the owner runs it from Settings', async () => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.stubEnv('DEPLOYMENT_MODE', 'self-hosted')
    const list = vi.fn(async () => [1])
    mocks({ list })
    expect(await (await post()).json()).toEqual({ ok: true, orgs: 0 })
    expect(list).not.toHaveBeenCalled()
  })

  it('stops starting new workspaces once its time budget is spent', async () => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
    let now = 1_000_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)
    const run = vi.fn(async () => {
      now += 3 * 60_000
      return { retitled: 1, sourcesDone: 1, remainingSources: 0 }
    })
    mocks({ list: async () => [1, 2, 3, 4], run })
    try {
      const { ROUTE_TIME_BUDGET_MS } = await import('@/app/api/kb/retitle-imports/run/route')
      const res = await post()
      expect(run.mock.calls.length).toBe(Math.ceil(ROUTE_TIME_BUDGET_MS / (3 * 60_000)))
      expect(await res.json()).toEqual({ ok: true, orgs: run.mock.calls.length })
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('is force-dynamic on the nodejs runtime and checks the bot secret first', () => {
    const src = fs.readFileSync('app/api/kb/retitle-imports/run/route.ts', 'utf-8')
    expect(src).toMatch(/export const dynamic = 'force-dynamic'/)
    expect(src).toMatch(/export const runtime = 'nodejs'/)
    const body = src.slice(src.indexOf('export async function POST'))
    expect(body.split('\n')[1].trim()).toBe("if (!isPlatformBotRequest(request)) return new Response('Unauthorized', { status: 401 })")
  })
})

describe('bot/index.ts re-title sweep', () => {
  const s = fs.readFileSync('bot/index.ts', 'utf-8')
  const fn = s.slice(s.indexOf('function startRetitleImportsSweep()'))
  const body = fn.slice(0, fn.indexOf('\n}\n'))

  it('posts to the app route with BOT_SECRET and is started with the other sweeps', () => {
    expect(s).toContain('function startRetitleImportsSweep()')
    expect(body).toContain('/api/kb/retitle-imports/run')
    expect(body).toMatch(/Authorization: `Bearer \$\{botSecret\}`/)
    expect(s).toMatch(/startRetitleImportsSweep\(\)\s*\n/)
  })

  it('never overlaps sweeps and gives up on a hung request', () => {
    expect(body).toMatch(/if \(inFlight\) return/)
    expect(body).toMatch(/signal: AbortSignal\.timeout\(/)
    expect(body).toMatch(/finally \{\s*inFlight = false/)
  })
})
