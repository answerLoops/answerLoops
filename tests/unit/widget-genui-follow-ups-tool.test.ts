import { describe, expect, it, vi } from 'vitest'
import { buildGenuiTools } from '@/lib/widget/genui-tools'
import { followUpsSchema, GENUI_TOOL_NAMES } from '@/lib/widget/genui'

/**
 * The show_follow_ups tool: it exists only when follow-ups are available, it
 * keeps only the questions the workspace's knowledge base can answer, and with
 * fewer than two left it draws nothing.
 */

const exec = (tools: ReturnType<typeof buildGenuiTools>, input: unknown) =>
  (tools as unknown as Record<string, { execute: (i: unknown, c: unknown) => Promise<unknown> }>)[GENUI_TOOL_NAMES.followUps].execute(input, {})

describe('show_follow_ups', () => {
  it('does not exist unless follow-ups are available', () => {
    expect(Object.keys(buildGenuiTools(''))).not.toContain('show_follow_ups')
    expect(Object.keys(buildGenuiTools('', {}))).not.toContain('show_follow_ups')
  })

  it('is registered, beside the others, when they are available', () => {
    const tools = buildGenuiTools('', { followUps: { ground: async (l) => l } })
    expect(Object.keys(tools)).toContain('show_follow_ups')
    expect(Object.keys(tools)).toHaveLength(6)
  })

  it('draws the questions the check keeps, in order, with the lead-in', async () => {
    const ground = vi.fn(async (labels: string[]) => labels.filter((l) => l !== 'Do you sell boats?'))
    const tools = buildGenuiTools('', { followUps: { ground } })
    const out = await exec(tools, {
      prompt: 'You might also ask',
      questions: [{ label: 'How do I connect Slack?' }, { label: 'Do you sell boats?' }, { label: 'What does it cost?' }],
    })
    expect(ground).toHaveBeenCalledWith(['How do I connect Slack?', 'Do you sell boats?', 'What does it cost?'])
    expect(out).toEqual({
      ok: true,
      data: { prompt: 'You might also ask', questions: [{ label: 'How do I connect Slack?' }, { label: 'What does it cost?' }] },
    })
  })

  it('draws nothing when fewer than two survive the check', async () => {
    const tools = buildGenuiTools('', { followUps: { ground: async () => ['Only one?'] } })
    expect(await exec(tools, { questions: [{ label: 'A?' }, { label: 'B?' }] })).toEqual({ ok: false })
    const none = buildGenuiTools('', { followUps: { ground: async () => [] } })
    expect(await exec(none, { questions: [{ label: 'A?' }, { label: 'B?' }] })).toEqual({ ok: false })
  })

  it('leaves out the lead-in when none was given', async () => {
    const tools = buildGenuiTools('', { followUps: { ground: async (l) => l } })
    const out = (await exec(tools, { questions: [{ label: 'A?' }, { label: 'B?' }] })) as { data: Record<string, unknown> }
    expect(out.data).not.toHaveProperty('prompt')
  })
})

describe('followUpsSchema', () => {
  const q = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `Question ${i}?` }))

  it('takes two or three short questions', () => {
    expect(followUpsSchema.safeParse({ questions: q(2) }).success).toBe(true)
    expect(followUpsSchema.safeParse({ questions: q(3) }).success).toBe(true)
  })

  it('refuses one, or four or more', () => {
    expect(followUpsSchema.safeParse({ questions: q(1) }).success).toBe(false)
    expect(followUpsSchema.safeParse({ questions: q(4) }).success).toBe(false)
  })

  it('refuses a question over 60 characters, or an empty one, or a long lead-in', () => {
    expect(followUpsSchema.safeParse({ questions: [{ label: 'x'.repeat(61) }, { label: 'ok?' }] }).success).toBe(false)
    expect(followUpsSchema.safeParse({ questions: [{ label: '' }, { label: 'ok?' }] }).success).toBe(false)
    expect(followUpsSchema.safeParse({ prompt: 'x'.repeat(61), questions: q(2) }).success).toBe(false)
  })
})
