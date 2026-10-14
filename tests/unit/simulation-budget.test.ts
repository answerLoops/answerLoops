import { describe, it, expect, vi, beforeEach } from 'vitest'

// A simulation run drives one generation per ticket (up to 100). On included
// usage, each of those must be checked against the workspace's budget, not
// just the first, and when the budget runs out the run stops and says why,
// keeping the results it already has.

const h = vi.hoisted(() => ({
  chatModel: vi.fn(),
  generate: vi.fn(),
  assessAnswer: vi.fn(),
  rows: [] as { id: number; content: string; category: string; status: string; aiDraftStatus: string }[],
}))

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u' }, orgId: 7 }) }))
vi.mock('@/lib/billing/entitlements-server', () => ({ orgHasFeature: async () => true, orgRateLimitPerMinute: async () => 100 }))
vi.mock('@/lib/ratelimit', () => ({ rateLimitShared: async () => ({ ok: true }) }))
vi.mock('@/lib/db/drizzle', () => ({
  getDb: () => ({ select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => h.rows }) }) }) }) }),
}))
vi.mock('@/lib/ai/models', async (orig) => ({
  ...(await orig<typeof import('@/lib/ai/models')>()),
  chatModel: (...a: unknown[]) => h.chatModel(...a),
}))
vi.mock('@mastra/core/agent', () => ({
  Agent: class { generate = (...a: unknown[]) => h.generate(...a) },
}))
vi.mock('@/lib/ai/assess', () => ({ assessAnswer: (...a: unknown[]) => h.assessAnswer(...a), AUTO_DEFLECT_THRESHOLD: 0.8 }))
vi.mock('@/lib/ai/embed', () => ({ embedText: async () => [0.1] }))
vi.mock('@/lib/db/queries/kb', () => ({ searchArticles: async () => [] }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { POST } from '@/app/api/simulation/run/route'
import { PlatformBudgetExhaustedError } from '@/lib/ai/errors'

async function run(count: number) {
  const res = await POST(new Request('https://x.test/api/simulation/run', { method: 'POST', body: JSON.stringify({ count }) }))
  const text = await res.text()
  return text.trim().split('\n').map((l) => JSON.parse(l) as { type: string; [k: string]: unknown })
}

beforeEach(() => {
  h.rows = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, content: `question ${i + 1}`, category: 'how_to', status: 'open', aiDraftStatus: 'pending' }))
  h.generate.mockReset().mockResolvedValue({ text: 'an answer' })
  h.assessAnswer.mockReset().mockResolvedValue({ confidence: 0.9, answered_fully: true, reasoning: 'ok' })
  h.chatModel.mockReset()
})

describe('simulation on included usage', () => {
  it('checks the budget before every ticket, not once per run', async () => {
    h.chatModel.mockResolvedValue({ id: 'model' })
    await run(10)
    expect(h.chatModel.mock.calls.length).toBeGreaterThanOrEqual(10)
    expect(h.generate).toHaveBeenCalledTimes(10)
  })

  it('stops generating once the budget runs out, keeps the finished results, and says why', async () => {
    const err = new PlatformBudgetExhaustedError(7, 'chat', 'plan')
    let calls = 0
    // Enough budget for the first three tickets, then used up.
    h.chatModel.mockImplementation(async () => {
      calls++
      if (calls > 4) throw err
      return { id: 'model' }
    })
    const events = await run(10)
    expect(h.generate.mock.calls.length).toBeLessThanOrEqual(3)
    const done = events.find((e) => e.type === 'done') as { results: unknown[] } | undefined
    expect(done?.results).toHaveLength(h.generate.mock.calls.length)
    expect(events.at(-1)).toEqual({ type: 'error', message: err.userMessage })
  })

  it('a budget already used up at the start says why instead of a generic failure', async () => {
    const err = new PlatformBudgetExhaustedError(7, 'chat', 'trial')
    h.chatModel.mockRejectedValue(err)
    const events = await run(10)
    expect(h.generate).not.toHaveBeenCalled()
    expect(events.find((e) => e.type === 'done')).toBeUndefined()
    expect(events.at(-1)).toEqual({ type: 'error', message: err.userMessage })
  })

  it('a grading call that runs out of budget also stops the run', async () => {
    const err = new PlatformBudgetExhaustedError(7, 'chat', 'plan')
    h.chatModel.mockResolvedValue({ id: 'model' })
    h.assessAnswer.mockResolvedValueOnce({ confidence: 0.9, answered_fully: true, reasoning: 'ok' }).mockRejectedValue(err)
    const events = await run(10)
    expect(h.generate.mock.calls.length).toBeLessThanOrEqual(2)
    expect(events.at(-1)).toEqual({ type: 'error', message: err.userMessage })
  })

  it('other per-ticket errors still record an error row and carry on', async () => {
    h.chatModel.mockResolvedValue({ id: 'model' })
    h.generate.mockRejectedValueOnce(new Error('provider hiccup'))
    const events = await run(10)
    expect(h.generate).toHaveBeenCalledTimes(10)
    const done = events.find((e) => e.type === 'done') as unknown as { results: { simAnswer: string }[] }
    expect(done.results).toHaveLength(10)
    expect(done.results[0].simAnswer).toBe('[error]')
  })
})
