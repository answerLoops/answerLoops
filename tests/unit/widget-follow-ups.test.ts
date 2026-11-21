import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Suggested follow-up questions: when a workspace has them, and which of the
 * assistant's suggestions are kept. A suggestion survives only when the
 * knowledge base can answer it, and fewer than two survivors means none are
 * shown at all.
 */

const h = vi.hoisted(() => ({
  orgHasFeature: vi.fn(),
  embedQueryCached: vi.fn(),
  getKBContext: vi.fn(),
  mock: { value: false },
}))

vi.mock('@/lib/billing/entitlements-server', () => ({ orgHasFeature: h.orgHasFeature }))
vi.mock('@/lib/widget/embed-cache', () => ({ embedQueryCached: h.embedQueryCached }))
vi.mock('@/lib/db/queries/kb', () => ({ getKBContext: h.getKBContext }))
vi.mock('@/lib/mock-mode', () => ({
  get MOCK_EXTERNALS() {
    return h.mock.value
  },
}))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import {
  FOLLOW_UP_CHECK_TIMEOUT_MS,
  followUpsAvailable,
  groundFollowUps,
  questionIsCovered,
} from '@/lib/widget/follow-ups'
import { buildWidgetInstructions, FOLLOW_UP_INSTRUCTIONS } from '@/lib/widget/instructions'

beforeEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
  h.mock.value = false
  h.orgHasFeature.mockResolvedValue(true)
  h.embedQueryCached.mockResolvedValue([0.1, 0.2])
  h.getKBContext.mockResolvedValue([{ summary: 'x', answer: 'y' }])
})

describe('followUpsAvailable', () => {
  it('is on for a workspace on a plan that includes customization', async () => {
    expect(await followUpsAvailable({ id: 4, followUpsEnabled: true })).toBe(true)
    expect(h.orgHasFeature).toHaveBeenCalledWith(4, 'white_label_widget')
  })

  it('is off on a plan without it, whatever the owner chose', async () => {
    h.orgHasFeature.mockResolvedValue(false)
    expect(await followUpsAvailable({ id: 4, followUpsEnabled: true })).toBe(false)
  })

  it('is off when the owner switched it off, without even asking about the plan', async () => {
    expect(await followUpsAvailable({ id: 4, followUpsEnabled: false })).toBe(false)
    expect(h.orgHasFeature).not.toHaveBeenCalled()
  })
})

describe('questionIsCovered', () => {
  it('is covered when the knowledge base search finds an article, searching only the workspace asked about', async () => {
    expect(await questionIsCovered(9, 'How do I connect Slack?')).toBe(true)
    expect(h.embedQueryCached).toHaveBeenCalledWith('How do I connect Slack?', 9)
    expect(h.getKBContext).toHaveBeenCalledWith([0.1, 0.2], 1, 9)
  })

  it('is not covered when no article is close enough', async () => {
    h.getKBContext.mockResolvedValue([])
    expect(await questionIsCovered(9, 'Do you sell boats?')).toBe(false)
  })

  it('is not covered, and never throws, when the search fails', async () => {
    h.getKBContext.mockRejectedValue(new Error('db down'))
    expect(await questionIsCovered(9, 'anything')).toBe(false)
    h.embedQueryCached.mockRejectedValue(new Error('provider down'))
    expect(await questionIsCovered(9, 'anything')).toBe(false)
  })

  it('counts a slow check as not covered once the time limit passes', async () => {
    vi.useFakeTimers()
    h.embedQueryCached.mockImplementation(() => new Promise(() => {}))
    const result = questionIsCovered(9, 'never answers')
    await vi.advanceTimersByTimeAsync(FOLLOW_UP_CHECK_TIMEOUT_MS + 10)
    expect(await result).toBe(false)
  })
})

describe('groundFollowUps', () => {
  const only = (set: string[]) => async (_org: number, q: string) => set.includes(q)

  it('keeps the covered suggestions in the order proposed', async () => {
    const kept = await groundFollowUps(1, ['A?', 'B?', 'C?'], only(['A?', 'C?']))
    expect(kept).toEqual(['A?', 'C?'])
  })

  it('shows none when fewer than two are covered', async () => {
    expect(await groundFollowUps(1, ['A?', 'B?', 'C?'], only(['A?']))).toEqual([])
    expect(await groundFollowUps(1, ['A?', 'B?'], only([]))).toEqual([])
  })

  it('drops duplicates ignoring case and spacing, and keeps at most three', async () => {
    const all = async () => true
    expect(await groundFollowUps(1, ['What is it?', ' what  is it? ', 'B?', 'C?', 'D?'], all)).toEqual(['What is it?', 'B?', 'C?'])
  })

  it('drops empty suggestions', async () => {
    expect(await groundFollowUps(1, ['  ', 'A?', 'B?'], async () => true)).toEqual(['A?', 'B?'])
  })

  it('checks every candidate against the workspace it was asked for', async () => {
    const seen: Array<[number, string]> = []
    await groundFollowUps(42, ['A?', 'B?'], async (org, q) => {
      seen.push([org, q])
      return true
    })
    expect(seen).toEqual([[42, 'A?'], [42, 'B?']])
  })

  it('runs the checks side by side, not one after another', async () => {
    vi.useFakeTimers()
    let running = 0
    let peak = 0
    const slow = async () => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 50))
      running--
      return true
    }
    const pending = groundFollowUps(1, ['A?', 'B?', 'C?'], slow)
    await vi.advanceTimersByTimeAsync(60)
    await pending
    expect(peak).toBe(3)
  })

  it('in mock mode there is no knowledge base to ask, so distinct suggestions pass', async () => {
    h.mock.value = true
    const never = vi.fn(async () => false)
    expect(await groundFollowUps(1, ['A?', 'B?'], never)).toEqual(['A?', 'B?'])
    expect(never).not.toHaveBeenCalled()
  })
})

describe('the instructions', () => {
  const base = { orgName: 'Acme', answerScope: 'knowledge-base-only' as const, guidance: null, contextBlock: '' }

  it('tell the assistant about follow-up suggestions only when they are available', () => {
    expect(buildWidgetInstructions({ ...base, followUps: true })).toContain(FOLLOW_UP_INSTRUCTIONS)
    expect(buildWidgetInstructions({ ...base, followUps: false })).not.toContain('show_follow_ups')
    expect(buildWidgetInstructions(base)).not.toContain('show_follow_ups')
  })

  it('leave the text exactly as it was when they are off', () => {
    expect(buildWidgetInstructions({ ...base, followUps: false })).toBe(buildWidgetInstructions(base))
  })

  it('ask for them conservatively and name when not to', () => {
    expect(FOLLOW_UP_INSTRUCTIONS).toMatch(/only when there is a natural next question/i)
    for (const when of [/short factual answer/, /support or contact/, /don't know/, /declined/, /another card/]) {
      expect(FOLLOW_UP_INSTRUCTIONS).toMatch(when)
    }
    expect(FOLLOW_UP_INSTRUCTIONS).toMatch(/Never suggest a question the context does not cover/)
    expect(FOLLOW_UP_INSTRUCTIONS).toMatch(/never mention that you are offering suggestions/)
  })

  it('come before the knowledge base context, so the context stays last', () => {
    const text = buildWidgetInstructions({ ...base, followUps: true, contextBlock: '\n\nKnowledge base context — x' })
    expect(text.indexOf('show_follow_ups')).toBeLessThan(text.indexOf('Knowledge base context'))
  })
})
