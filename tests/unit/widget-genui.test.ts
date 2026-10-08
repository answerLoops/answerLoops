import { describe, it, expect } from 'vitest'
import {
  calloutSchema,
  choicesSchema,
  contactSchema,
  linkCardSchema,
  parseGenuiResult,
  safeContactHref,
  safeHttpsUrl,
  stepsSchema,
} from '@/lib/widget/genui'
import { buildGenuiTools } from '@/lib/widget/genui-tools'
import { flattenMastraStream } from '@/lib/widget/mastra-stream'
// The converter CopilotKit runs on whatever the route's factory returns — the
// real consumer of flattenMastraStream's output.
import { convertAISDKStream } from '../../node_modules/@copilotkit/runtime/dist/agent/converters/aisdk.mjs'

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const x of it) out.push(x)
  return out
}
async function* from<T>(items: T[]): AsyncIterable<T> {
  for (const i of items) yield i
}

describe('genui URL and contact sanitizers', () => {
  it('accepts only plain https URLs', () => {
    expect(safeHttpsUrl('https://docs.example.com/start')).toBe('https://docs.example.com/start')
    for (const bad of [
      'http://example.com',
      'javascript:alert(1)',
      'data:text/html,<script>1</script>',
      '//evil.example',
      'https://user:pw@example.com',
      'not a url',
      '',
    ]) {
      expect(safeHttpsUrl(bad), bad).toBeNull()
    }
  })

  it('builds mailto/tel/https hrefs only from values that fit the declared kind', () => {
    expect(safeContactHref('email', 'help@example.com')).toBe('mailto:help@example.com')
    expect(safeContactHref('phone', '+1 (555) 010-2030')).toBe('tel:+15550102030')
    expect(safeContactHref('url', 'https://example.com/support')).toBe('https://example.com/support')
    expect(safeContactHref('email', 'javascript:alert(1)')).toBeNull()
    expect(safeContactHref('email', 'a@b.com?cc=x@y.com&body=hi')).toBeNull()
    expect(safeContactHref('phone', 'call me maybe')).toBeNull()
    expect(safeContactHref('url', 'javascript:alert(1)')).toBeNull()
  })
})

describe('genui catalog schemas', () => {
  it('bounds sizes so a runaway generation cannot flood the layout', () => {
    expect(stepsSchema.safeParse({ title: 'x', steps: [{ title: 'only one' }] }).success).toBe(false)
    expect(
      stepsSchema.safeParse({ title: 'x', steps: Array.from({ length: 9 }, () => ({ title: 's' })) }).success
    ).toBe(false)
    expect(choicesSchema.safeParse({ prompt: 'p', options: [{ label: 'a' }] }).success).toBe(false)
    expect(calloutSchema.safeParse({ tone: 'danger', title: 't', body: 'b' }).success).toBe(false)
    expect(calloutSchema.safeParse({ tone: 'info', title: 't', body: 'b'.repeat(401) }).success).toBe(false)
  })

  it('parseGenuiResult only yields data from a well-formed ok result', () => {
    const data = { tone: 'info', title: 'Heads up', body: 'Read this' }
    expect(parseGenuiResult(JSON.stringify({ ok: true, data }), calloutSchema)).toEqual(data)
    expect(parseGenuiResult(JSON.stringify({ ok: false }), calloutSchema)).toBeNull()
    expect(parseGenuiResult(JSON.stringify({ ok: true, data: { ...data, tone: 'x' } }), calloutSchema)).toBeNull()
    expect(parseGenuiResult('not json', calloutSchema)).toBeNull()
    expect(parseGenuiResult(undefined, calloutSchema)).toBeNull()
  })
})

describe('genui tools ground links and contact details in the knowledge base', () => {
  const kb = `1. Title: "Contact"\n   Answer: Email support@acme.test or call +1 555 010 2030. Docs: https://acme.test/docs/start`
  const tools = buildGenuiTools(kb)
  type Exec = (input: unknown) => Promise<unknown>
  const run = (name: keyof typeof tools, input: unknown) =>
    (tools[name] as unknown as { execute: Exec }).execute(input)

  it('passes a link card whose URL appears in the context', async () => {
    const r = (await run('show_link_card', { title: 'Docs', url: 'https://acme.test/docs/start' })) as { ok: boolean }
    expect(r.ok).toBe(true)
  })

  it('refuses a link card with a URL the context never mentioned', async () => {
    expect(await run('show_link_card', { title: 'Docs', url: 'https://evil.test/phish' })).toEqual({ ok: false })
  })

  it('refuses non-https links even when they appear in the context text', async () => {
    const t = buildGenuiTools('see javascript:alert(1) and http://acme.test/x')
    const exec = (t.show_link_card as unknown as { execute: Exec }).execute
    expect(await exec({ title: 'x', url: 'javascript:alert(1)' })).toEqual({ ok: false })
    expect(await exec({ title: 'x', url: 'http://acme.test/x' })).toEqual({ ok: false })
  })

  it('keeps only grounded contact options and drops invented ones', async () => {
    const r = (await run('show_contact_options', {
      message: 'Reach us',
      options: [
        { kind: 'email', label: 'Email', value: 'support@acme.test' },
        { kind: 'email', label: 'Fake', value: 'ceo@acme.test' },
        { kind: 'phone', label: 'Fake phone', value: '+1 555 999 9999' },
      ],
    })) as { ok: true; data: { options: { value: string }[] } }
    expect(r.data.options.map((o) => o.value)).toEqual(['support@acme.test'])
  })

  it('grounds phone numbers by digits, ignoring formatting', async () => {
    const r = (await run('show_contact_options', {
      message: 'Call us',
      options: [{ kind: 'phone', label: 'Phone', value: '+1 (555) 010-2030' }],
    })) as { ok: boolean }
    expect(r.ok).toBe(true)
  })

  it('refuses a contact card when nothing in it is grounded', async () => {
    expect(
      await run('show_contact_options', {
        message: 'Reach us',
        options: [{ kind: 'email', label: 'Email', value: 'nobody@else.test' }],
      })
    ).toEqual({ ok: false })
  })
})

describe('flattenMastraStream', () => {
  const chunk = (type: string, payload: Record<string, unknown>) => ({ type, payload, runId: 'r', from: 'AGENT' })

  it('flattens text deltas and reports the first one once', async () => {
    let firsts = 0
    const out = await collect(
      flattenMastraStream(
        from([chunk('text-delta', { id: '1', text: 'Hel' }), chunk('text-delta', { id: '1', text: 'lo' })]),
        () => firsts++
      )
    )
    expect(out.map((c) => (c as { text: string }).text)).toEqual(['Hel', 'lo'])
    expect(firsts).toBe(1)
  })

  it('turns Mastra tool chunks into the AG-UI events the runtime converter emits', async () => {
    const flat = flattenMastraStream(
      from([
        chunk('tool-call-input-streaming-start', { toolCallId: 't1', toolName: 'show_steps' }),
        chunk('tool-call-delta', { toolCallId: 't1', argsTextDelta: '{"title":"Set' }),
        chunk('tool-call-delta', { toolCallId: 't1', argsTextDelta: 'up"}' }),
        chunk('tool-call-input-streaming-end', { toolCallId: 't1' }),
        chunk('tool-call', { toolCallId: 't1', toolName: 'show_steps', args: { title: 'Setup' } }),
        chunk('tool-result', { toolCallId: 't1', toolName: 'show_steps', result: { ok: true, data: { title: 'Setup' } } }),
        chunk('finish', {}),
      ])
    )
    const events = (await collect(convertAISDKStream(flat, new AbortController().signal))) as {
      type: string
      toolCallId?: string
      delta?: string
      content?: string
      toolCallName?: string
    }[]
    expect(events.map((e) => e.type)).toEqual([
      'TOOL_CALL_START',
      'TOOL_CALL_ARGS',
      'TOOL_CALL_ARGS',
      'TOOL_CALL_END',
      'TOOL_CALL_RESULT',
    ])
    expect(events[0].toolCallName).toBe('show_steps')
    expect(events.filter((e) => e.type === 'TOOL_CALL_ARGS').map((e) => e.delta).join('')).toBe('{"title":"Setup"}')
    expect(JSON.parse(events[4].content!)).toEqual({ ok: true, data: { title: 'Setup' } })
  })

  it('sends args once at the end when the provider did not stream them', async () => {
    const flat = flattenMastraStream(
      from([chunk('tool-call', { toolCallId: 't2', toolName: 'show_callout', args: { tone: 'info' } }), chunk('finish', {})])
    )
    const events = (await collect(convertAISDKStream(flat, new AbortController().signal))) as { type: string; delta?: string }[]
    expect(events.map((e) => e.type)).toEqual(['TOOL_CALL_START', 'TOOL_CALL_ARGS', 'TOOL_CALL_END'])
    expect(events[1].delta).toBe('{"tone":"info"}')
  })

  it('replaces an errored tool result with a refusal so error text never reaches the visitor', async () => {
    const flat = flattenMastraStream(
      from([chunk('tool-result', { toolCallId: 't3', toolName: 'show_steps', result: 'stack trace: secret', isError: true }), chunk('finish', {})])
    )
    const events = (await collect(convertAISDKStream(flat, new AbortController().signal))) as { type: string; content?: string }[]
    expect(JSON.parse(events[0].content!)).toEqual({ ok: false })
  })
})
