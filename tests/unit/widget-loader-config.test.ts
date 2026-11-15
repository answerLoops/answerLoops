import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

/**
 * public/widget.js against a stub DOM and a fake fetch: how the loader turns a
 * widget id (token or slug) into an iframe, and that it degrades to today's
 * look when the settings lookup is slow, broken or hostile.
 */

const SOURCE = fs.readFileSync(path.join(process.cwd(), 'public/widget.js'), 'utf8')
const TOKEN = 'a1'.repeat(24)
const ROTATED = 'b2'.repeat(24)

interface El {
  tag: string
  id: string
  src: string
  title: string
  innerHTML: string
  textContent: string
  attrs: Record<string, string>
  children: El[]
  setAttribute(k: string, v: string): void
  getAttribute(k: string): string | null
  addEventListener(): void
  appendChild(c: El): void
  classList: { add(): void; remove(): void }
}

function el(tag: string): El {
  const e: El = {
    tag,
    id: '',
    src: '',
    title: '',
    innerHTML: '',
    textContent: '',
    attrs: {},
    children: [],
    setAttribute(k, v) {
      e.attrs[k] = v
    },
    getAttribute(k) {
      return k in e.attrs ? e.attrs[k] : null
    },
    addEventListener() {},
    appendChild(c) {
      e.children.push(c)
    },
    classList: { add() {}, remove() {} },
  }
  return e
}

type FakeFetch = (url: string, init?: { signal?: AbortSignal; credentials?: string }) => Promise<unknown>

function run(widgetId: string | null, fetchImpl?: FakeFetch) {
  const script = el('script')
  script.attrs['data-base-url'] = 'https://app.test'
  if (widgetId !== null) script.attrs['data-widget-id'] = widgetId
  const head = el('head')
  const body = el('body')
  const sandbox: Record<string, unknown> = {
    document: {
      currentScript: script,
      readyState: 'complete',
      head,
      body,
      createElement: (tag: string) => el(tag),
      getElementsByTagName: () => [script],
      addEventListener: () => {},
    },
    location: { origin: 'https://customer.test' },
    setTimeout,
    clearTimeout,
    Promise,
    AbortController,
    encodeURIComponent,
    Object,
    fetch: fetchImpl,
  }
  sandbox.window = sandbox
  vm.createContext(sandbox)
  vm.runInContext(SOURCE, sandbox)
  return {
    body,
    head,
    panel: () => body.children.find((c) => c.id === 'cp-widget-panel'),
    bubble: () => body.children.find((c) => c.id === 'cp-widget-bubble'),
    iframeSrc: () => body.children.find((c) => c.id === 'cp-widget-panel')?.children[0]?.src,
    css: () => head.children.map((c) => c.textContent).join(''),
  }
}

const reply = (config: unknown, ok = true) => async () => ({ ok, json: async () => config })

afterEach(() => {
  vi.useRealTimers()
})

describe('widget.js: resolving the id', () => {
  it('asks the server about the id it was given, without credentials', async () => {
    const seen: { url: string; credentials?: string }[] = []
    run('acme-support', async (url, init) => {
      seen.push({ url, credentials: init?.credentials })
      return { ok: true, json: async () => ({ token: ROTATED, display: {} }) }
    })
    await vi.waitFor(() => expect(seen.length).toBe(1))
    expect(seen[0].url).toBe('https://app.test/api/widget/config?id=acme-support')
    expect(seen[0].credentials).toBe('omit')
  })

  it('loads the panel with the token a slug resolves to', async () => {
    const w = run('acme-support', reply({ token: ROTATED, display: {} }))
    await vi.waitFor(() => expect(w.iframeSrc()).toBe(`https://app.test/widget/${ROTATED}`))
  })

  it('keeps a token snippet\'s own token when the reply carries none', async () => {
    const w = run(TOKEN, reply({ token: null, display: {} }))
    await vi.waitFor(() => expect(w.iframeSrc()).toBe(`https://app.test/widget/${TOKEN}`))
  })

  it('ignores a resolved token that is not token-shaped', async () => {
    const w = run('acme-support', reply({ token: '../../evil', display: {} }))
    await new Promise((r) => setTimeout(r, 20))
    expect(w.panel()).toBeUndefined()
  })

  it('still no-ops without a widget id, and asks nothing', async () => {
    const fetchSpy = vi.fn()
    const w = run(null, fetchSpy as unknown as FakeFetch)
    await new Promise((r) => setTimeout(r, 10))
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(w.panel()).toBeUndefined()
  })
})

describe('widget.js: when the lookup fails', () => {
  it('shows a token install exactly as before if the lookup errors', async () => {
    const w = run(TOKEN, async () => {
      throw new Error('network down')
    })
    await vi.waitFor(() => expect(w.iframeSrc()).toBe(`https://app.test/widget/${TOKEN}`))
    expect(w.css()).toContain('background:#4f46e5')
    expect(w.css()).toContain('width:380px')
  })

  it.each([
    ['a 429', reply({ token: null, display: {} }, false)],
    ['unreadable JSON', async () => ({ ok: true, json: async () => { throw new SyntaxError('bad') } })],
    ['a null body', reply(null)],
  ])('shows a token install as before after %s', async (_name, impl) => {
    const w = run(TOKEN, impl as FakeFetch)
    await vi.waitFor(() => expect(w.iframeSrc()).toBe(`https://app.test/widget/${TOKEN}`))
    expect(w.css()).toContain('background:#4f46e5')
  })

  it('shows a token install as before when fetch does not exist', async () => {
    const w = run(TOKEN, undefined)
    await vi.waitFor(() => expect(w.iframeSrc()).toBe(`https://app.test/widget/${TOKEN}`))
  })

  it('does not load a slug install it could not resolve', async () => {
    const w = run('acme-support', async () => {
      throw new Error('network down')
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(w.panel()).toBeUndefined()
    expect(w.bubble()).toBeUndefined()
  })

  it('gives up on a slow lookup after two seconds and falls back', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    const w = run(TOKEN, (_url, init) => {
      signal = init?.signal
      return new Promise(() => {})
    })
    await vi.advanceTimersByTimeAsync(1999)
    expect(w.panel()).toBeUndefined()
    await vi.advanceTimersByTimeAsync(2)
    expect(w.iframeSrc()).toBe(`https://app.test/widget/${TOKEN}`)
    expect(signal?.aborted).toBe(true)
  })
})

describe('widget.js: applying display settings', () => {
  it('uses the served bubble color and window size', async () => {
    const w = run(TOKEN, reply({ token: TOKEN, display: { windowSize: 'large', bubbleColor: '#aa00ff' } }))
    await vi.waitFor(() => expect(w.panel()).toBeDefined())
    expect(w.css()).toContain('background:#aa00ff')
    expect(w.css()).toContain('width:520px')
    expect(w.css()).toContain('height:760px')
  })

  it('never lets a hostile color reach the stylesheet', async () => {
    const w = run(
      TOKEN,
      reply({ token: TOKEN, display: { windowSize: 'small', bubbleColor: 'red;}body{display:none' } })
    )
    await vi.waitFor(() => expect(w.panel()).toBeDefined())
    expect(w.css()).not.toContain('display:none')
    expect(w.css()).toContain('background:#4f46e5')
  })

  it('treats an unknown size name, including inherited ones, as small', async () => {
    for (const windowSize of ['huge', 'constructor', '__proto__']) {
      const w = run(TOKEN, reply({ token: TOKEN, display: { windowSize, bubbleColor: '#112233' } }))
      await vi.waitFor(() => expect(w.panel()).toBeDefined())
      expect(w.css()).toContain('width:380px')
    }
  })

  it('keeps the window inside the browser window', async () => {
    const w = run(TOKEN, reply({ token: TOKEN, display: { windowSize: 'large' } }))
    await vi.waitFor(() => expect(w.panel()).toBeDefined())
    expect(w.css()).toContain('max-width:calc(100vw - 48px)')
    expect(w.css()).toContain('max-height:calc(100vh - 112px)')
  })
})
