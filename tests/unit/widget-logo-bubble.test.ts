import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

/**
 * public/widget.js and the workspace logo: the launcher bubble shows it inside a
 * white circle when the settings lookup gives a version number, builds the logo
 * address from its own base address, the widget token and that number, falls
 * back to the chat icon for any other value or if the image fails, and shows
 * the close icon, not the logo, while the chat is open.
 */

const SOURCE = fs.readFileSync(path.join(process.cwd(), 'public/widget.js'), 'utf8')
const TOKEN = 'a1'.repeat(24)
const LOGO_VERSION = 786432123456
const LOGO_ADDRESS = `https://app.test/api/widget/logo/${TOKEN}?v=${LOGO_VERSION}`

interface El {
  tag: string
  id: string
  src: string
  className: string
  alt: string
  innerHTML: string
  textContent: string
  attrs: Record<string, string>
  children: El[]
  onerror: (() => void) | null
  listeners: Record<string, () => void>
  setAttribute(k: string, v: string): void
  getAttribute(k: string): string | null
  addEventListener(type: string, fn: () => void): void
  appendChild(c: El): void
  classList: { add(): void; remove(): void }
}

function el(tag: string): El {
  const e: El = {
    tag,
    id: '',
    src: '',
    className: '',
    alt: '',
    innerHTML: '',
    textContent: '',
    attrs: {},
    children: [],
    onerror: null,
    listeners: {},
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
    classList: { add() {}, remove() {} },
  }
  let text = ''
  Object.defineProperty(e, 'textContent', {
    get: () => text,
    set: (v: string) => {
      text = v
      if (v === '') e.children.length = 0
    },
  })
  return e
}

function run(config: unknown, widgetId: string = TOKEN) {
  const script = el('script')
  script.attrs['data-base-url'] = 'https://app.test'
  script.attrs['data-widget-id'] = widgetId
  const head = el('head')
  const body = el('body')
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
    location: { origin: 'https://customer.test' },
    setTimeout,
    clearTimeout,
    Promise,
    AbortController,
    encodeURIComponent,
    Object,
    Date,
    fetch: async () => ({ ok: true, json: async () => config }),
  }
  sandbox.window = sandbox
  vm.createContext(sandbox)
  vm.runInContext(SOURCE, sandbox)
  const bubble = () => body.children.find((c) => c.id === 'cp-widget-bubble')
  return {
    bubble,
    css: () => head.children.map((c) => c.textContent).join(''),
    click: () => bubble()?.listeners.click?.(),
    logoImage: () => bubble()?.children.find((c) => c.tag === 'img'),
    icon: () => bubble()?.children.find((c) => c.tag === 'svg'),
  }
}

const CHAT_PATH = 'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z'
const CLOSE_PATH = 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'
const pathOf = (svg?: El) => svg?.children.find((c) => c.tag === 'path')?.attrs.d

const withLogo = (logoVersion: unknown, extra: Record<string, unknown> = {}) => ({
  token: TOKEN,
  display: { windowSize: 'small', bubbleColor: '#2563eb', bubbleIconColor: '#ffffff', logoVersion, ...extra },
})
const ready = async (w: ReturnType<typeof run>) => {
  for (let i = 0; i < 50 && !w.bubble(); i++) await new Promise((r) => setTimeout(r, 5))
}

describe('widget.js: the launcher bubble and a workspace logo', () => {
  it('builds the logo address from the token and the version number', async () => {
    const w = run(withLogo(LOGO_VERSION))
    await ready(w)
    const img = w.logoImage()
    expect(img?.tag).toBe('img')
    expect(img?.src).toBe(LOGO_ADDRESS)
    expect(img?.className).toBe('cp-logo')
    expect(img?.alt).toBe('')
    expect(img?.getAttribute('aria-hidden')).toBe('true')
  })

  it('puts the logo in a white circle, so it reads on any brand color', async () => {
    const w = run(withLogo(LOGO_VERSION))
    await ready(w)
    const css = w.css()
    expect(css).toMatch(/\.cp-logo\{[^}]*border-radius:50%/)
    expect(css).toMatch(/\.cp-logo\{[^}]*background:#ffffff/)
    expect(css).toMatch(/\.cp-logo\{[^}]*object-fit:cover/)
  })

  it('never puts the address into markup text', async () => {
    const w = run(withLogo(LOGO_VERSION))
    await ready(w)
    expect(w.icon()).toBeUndefined()
    expect(w.bubble()?.children.map((c) => c.tag)).toEqual(['img'])
    expect(JSON.stringify(w.bubble()?.attrs)).not.toContain('/api/widget/logo')
  })

  it('shows the normal chat icon when the workspace has no logo', async () => {
    const w = run(withLogo(null))
    await ready(w)
    expect(w.logoImage()).toBeUndefined()
    expect(w.icon()?.tag).toBe('svg')
    expect(pathOf(w.icon())).toBe(CHAT_PATH)
  })

  it.each([
    ['a string', '786432123456'],
    ['a path', `/api/widget/logo/${TOKEN}?v=1`],
    ['a negative number', -1],
    ['not a number', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY],
    ['an object', {}],
    ['an array', [1]],
    ['a boolean', true],
  ])('ignores %s as the version and shows the chat icon', async (_label, value) => {
    const w = run(withLogo(value))
    await ready(w)
    expect(w.logoImage()).toBeUndefined()
    expect(w.icon()?.tag).toBe('svg')
    expect(pathOf(w.icon())).toBe(CHAT_PATH)
  })

  it('shows the chat icon for a version too large to print as plain digits', async () => {
    const w = run(withLogo(1e21))
    await ready(w)
    expect(w.logoImage()).toBeUndefined()
    expect(pathOf(w.icon())).toBe(CHAT_PATH)
  })

  it('rounds a fractional version down to a whole number', async () => {
    const w = run(withLogo(42.9))
    await ready(w)
    expect(w.logoImage()?.src).toBe(`https://app.test/api/widget/logo/${TOKEN}?v=42`)
  })

  it('accepts a version of zero', async () => {
    const w = run(withLogo(0))
    await ready(w)
    expect(w.logoImage()?.src).toBe(`https://app.test/api/widget/logo/${TOKEN}?v=0`)
  })

  it('takes nothing from a reply that offers its own address', async () => {
    const hostile = `https://evil.test/x.png`
    for (const reply of [
      withLogo(null, { logoPath: hostile, logoUrl: hostile, logoSrc: hostile }),
      withLogo('/evil', { logoPath: hostile }),
      withLogo(hostile),
    ]) {
      const w = run(reply)
      await ready(w)
      expect(w.logoImage()).toBeUndefined()
      expect(pathOf(w.icon())).toBe(CHAT_PATH)
    }
    const w = run(withLogo(LOGO_VERSION, { logoPath: hostile, logoUrl: hostile, logoSrc: hostile }))
    await ready(w)
    expect(w.logoImage()?.src).toBe(LOGO_ADDRESS)
  })

  it('uses the token the lookup resolves to for a slug snippet', async () => {
    const resolved = 'b2'.repeat(24)
    const w = run({ ...withLogo(LOGO_VERSION), token: resolved }, 'acme-support')
    await ready(w)
    expect(w.logoImage()?.src).toBe(`https://app.test/api/widget/logo/${resolved}?v=${LOGO_VERSION}`)
  })

  it('does not show a logo for a slug snippet the lookup could not resolve', async () => {
    const w = run({ display: withLogo(LOGO_VERSION).display }, 'acme-support')
    await new Promise((r) => setTimeout(r, 30))
    expect(w.bubble()).toBeUndefined()
  })

  it('falls back to the chat icon if the image cannot load', async () => {
    const w = run(withLogo(LOGO_VERSION))
    await ready(w)
    w.logoImage()?.onerror?.()
    expect(w.logoImage()).toBeUndefined()
    expect(pathOf(w.icon())).toBe(CHAT_PATH)
  })

  it('shows the close icon, not the logo, while the chat is open, and the logo again when it closes', async () => {
    const w = run(withLogo(LOGO_VERSION))
    await ready(w)
    w.click() // open
    expect(w.logoImage()).toBeUndefined()
    expect(pathOf(w.icon())).toBe(CLOSE_PATH)
    expect(w.bubble()?.getAttribute('aria-label')).toBe('Close support chat')
    w.click() // close
    expect(w.bubble()?.getAttribute('aria-label')).toBe('Open support chat')
    expect(w.icon()).toBeUndefined()
    expect(w.logoImage()?.src).toBe(LOGO_ADDRESS)
  })

  it('does not try the logo again once it has failed', async () => {
    const w = run(withLogo(LOGO_VERSION))
    await ready(w)
    w.logoImage()?.onerror?.()
    w.click()
    w.click()
    expect(w.logoImage()).toBeUndefined()
    expect(pathOf(w.icon())).toBe(CHAT_PATH)
  })

  it('works with no logo field at all, as an older settings reply would give', async () => {
    const w = run({ token: TOKEN, display: { windowSize: 'small', bubbleColor: '#2563eb', bubbleIconColor: '#ffffff' } })
    await ready(w)
    expect(pathOf(w.icon())).toBe(CHAT_PATH)
  })
})
