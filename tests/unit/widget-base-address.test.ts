import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

/**
 * The address the embed script loads everything from (the chat frame, the
 * settings lookup, the logo image). It comes from the script tag, so it is
 * checked before use: only a plain http or https address is accepted and it is
 * rebuilt from its origin and path. Anything else and the widget does not
 * start, so nothing is fetched or added to the page.
 */

const SOURCE = fs.readFileSync(path.join(process.cwd(), 'public/widget.js'), 'utf8')
const TOKEN = 'a1'.repeat(24)

interface El {
  tag: string
  id: string
  attrs: Record<string, string>
  children: El[]
  listeners: Record<string, () => void>
  src: string
  textContent: string
  className: string
  alt: string
  title: string
  setAttribute(k: string, v: string): void
  getAttribute(k: string): string | null
  addEventListener(type: string, fn: () => void): void
  appendChild(c: El): void
  classList: { add(c: string): void; remove(c: string): void }
}

function el(tag: string): El {
  let text = ''
  const e: El = {
    tag,
    id: '',
    attrs: {},
    children: [],
    listeners: {},
    src: '',
    className: '',
    alt: '',
    title: '',
    get textContent() {
      return text
    },
    set textContent(v: string) {
      text = v
      if (v === '') e.children.length = 0
    },
    setAttribute(k, v) {
      e.attrs[k] = v
    },
    getAttribute(k) {
      return k in e.attrs ? e.attrs[k] : null
    },
    addEventListener(type, fn) {
      e.listeners[type] = fn
    },
    appendChild(c) {
      e.children.push(c)
    },
    classList: { add: () => {}, remove: () => {} },
  } as El
  return e
}

function run(opts: { baseAttr?: string | null; scriptSrc?: string; withUrl: boolean }) {
  const script = el('script')
  script.attrs['data-widget-id'] = TOKEN
  if (opts.baseAttr !== undefined && opts.baseAttr !== null) script.attrs['data-base-url'] = opts.baseAttr
  if (opts.scriptSrc !== undefined) script.src = opts.scriptSrc
  const body = el('body')
  const head = el('head')
  const fetched: string[] = []
  const sandbox: Record<string, unknown> = {
    document: {
      currentScript: script,
      readyState: 'complete',
      head,
      body,
      createElement: (tag: string) => el(tag),
      createElementNS: (_ns: string, tag: string) => el(tag),
      getElementsByTagName: () => [script],
      addEventListener: () => {},
    },
    location: { origin: 'https://customer.test', href: 'https://customer.test/page' },
    setTimeout,
    clearTimeout,
    Promise,
    AbortController,
    encodeURIComponent,
    Object,
    Math,
    Date,
    isFinite,
    String,
    parseInt,
    fetch: async (url: string) => {
      fetched.push(url)
      return { ok: true, json: async () => ({ token: TOKEN, display: {} }) }
    },
  }
  if (opts.withUrl) sandbox.URL = URL
  sandbox.window = sandbox
  vm.createContext(sandbox)
  vm.runInContext(SOURCE, sandbox)
  return {
    fetched,
    body,
    bubble: () => body.children.find((c) => c.id === 'cp-widget-bubble'),
    open: () => body.children.find((c) => c.id === 'cp-widget-bubble')?.listeners.click?.(),
    frameSrc: () => body.children.find((c) => c.id === 'cp-widget-panel')?.children[0]?.src,
  }
}

const settle = () => new Promise((r) => setTimeout(r, 20))

describe.each([
  ['with the browser URL parser', true],
  ['without it (very old browsers)', false],
])('widget.js base address %s', (_label, withUrl) => {
  it.each([
    ['a javascript: address', 'javascript:alert(1)//'],
    ['a data: address', 'data:text/html,<p>x</p>'],
    ['a file: address', 'file:///etc/passwd'],
    ['a blob: address', 'blob:https://app.test/abc'],
    ['an ftp: address', 'ftp://app.test'],
    ['plain text', 'not a web address'],
    ['an address with a space and markup', 'https://app.test"><script>'],
  ])('does not start for %s', async (_name, value) => {
    const w = run({ baseAttr: value, withUrl })
    await settle()
    expect(w.fetched).toEqual([])
    expect(w.bubble()).toBeUndefined()
  })

  it('keeps working with a normal https address', async () => {
    const w = run({ baseAttr: 'https://app.test', withUrl })
    await settle()
    expect(w.fetched).toEqual([`https://app.test/api/widget/config?id=${TOKEN}`])
    expect(w.bubble()).toBeDefined()
    w.open()
    expect(w.frameSrc()).toBe(`https://app.test/widget/${TOKEN}`)
  })

  it('accepts a plain http address (local setups) and drops a trailing slash', async () => {
    const w = run({ baseAttr: 'http://localhost:3000/', withUrl })
    await settle()
    expect(w.fetched).toEqual([`http://localhost:3000/api/widget/config?id=${TOKEN}`])
  })

  it('keeps a path prefix and drops a trailing slash', async () => {
    const w = run({ baseAttr: 'https://host.test/support/', withUrl })
    await settle()
    expect(w.fetched).toEqual([`https://host.test/support/api/widget/config?id=${TOKEN}`])
    w.open()
    expect(w.frameSrc()).toBe(`https://host.test/support/widget/${TOKEN}`)
  })

  it('drops a query string and a fragment instead of carrying them into every address', async () => {
    const w = run({ baseAttr: 'https://app.test?x=1#frag', withUrl })
    await settle()
    expect(w.fetched).toEqual([`https://app.test/api/widget/config?id=${TOKEN}`])
  })

  it("uses the script's own address when the snippet names none", async () => {
    const w = run({ baseAttr: null, scriptSrc: 'https://cdn.test/widget.js', withUrl })
    await settle()
    expect(w.fetched).toEqual([`https://cdn.test/api/widget/config?id=${TOKEN}`])
  })

  it('copes with the script address carrying a version query', async () => {
    const w = run({ baseAttr: null, scriptSrc: 'https://cdn.test/widget.js?v=3', withUrl })
    await settle()
    expect(w.fetched).toEqual([`https://cdn.test/api/widget/config?id=${TOKEN}`])
  })
})

describe('widget.js base address with the browser URL parser', () => {
  it('drops credentials from the address', async () => {
    const w = run({ baseAttr: 'https://user:secret@app.test', withUrl: true })
    await settle()
    expect(w.fetched).toEqual([`https://app.test/api/widget/config?id=${TOKEN}`])
  })

  it('accepts an upper-case scheme and host', async () => {
    const w = run({ baseAttr: 'HTTPS://APP.TEST', withUrl: true })
    await settle()
    expect(w.fetched).toEqual([`https://app.test/api/widget/config?id=${TOKEN}`])
  })
})
