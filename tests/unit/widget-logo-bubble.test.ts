import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

/**
 * public/widget.js and the workspace logo: the launcher bubble shows it inside a
 * white circle when the settings lookup gives an address of the one exact shape
 * we serve, falls back to the chat icon for anything else or if the image fails,
 * and shows the close icon, not the logo, while the chat is open.
 */

const SOURCE = fs.readFileSync(path.join(process.cwd(), 'public/widget.js'), 'utf8')
const TOKEN = 'a1'.repeat(24)
const VERSION = '0123456789abcdef'
const LOGO_PATH = `/api/widget/logo/${TOKEN}?v=${VERSION}`

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

function run(config: unknown) {
  const script = el('script')
  script.attrs['data-base-url'] = 'https://app.test'
  script.attrs['data-widget-id'] = TOKEN
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

const withLogo = (logoPath: unknown) => ({ token: TOKEN, display: { windowSize: 'small', bubbleColor: '#2563eb', bubbleIconColor: '#ffffff', logoPath } })
const ready = async (w: ReturnType<typeof run>) => {
  for (let i = 0; i < 50 && !w.bubble(); i++) await new Promise((r) => setTimeout(r, 5))
}

describe('widget.js: the launcher bubble and a workspace logo', () => {
  it('shows the logo, from our own site, in the bubble', async () => {
    const w = run(withLogo(LOGO_PATH))
    await ready(w)
    const img = w.logoImage()
    expect(img?.tag).toBe('img')
    expect(img?.src).toBe(`https://app.test${LOGO_PATH}`)
    expect(img?.className).toBe('cp-logo')
    expect(img?.alt).toBe('')
    expect(img?.getAttribute('aria-hidden')).toBe('true')
  })

  it('puts the logo in a white circle, so it reads on any brand color', async () => {
    const w = run(withLogo(LOGO_PATH))
    await ready(w)
    const css = w.css()
    expect(css).toMatch(/\.cp-logo\{[^}]*border-radius:50%/)
    expect(css).toMatch(/\.cp-logo\{[^}]*background:#ffffff/)
    expect(css).toMatch(/\.cp-logo\{[^}]*object-fit:cover/)
  })

  it('never puts the address into markup text', async () => {
    const w = run(withLogo(LOGO_PATH))
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
    ['another host', `https://evil.test${LOGO_PATH}`],
    ['a protocol-relative address', `//evil.test${LOGO_PATH}`],
    ['a javascript address', 'javascript:alert(1)'],
    ['a data address', 'data:image/png;base64,AAAA'],
    ['a slug instead of the token', `/api/widget/logo/acme-support?v=${VERSION}`],
    ['an extra query', `${LOGO_PATH}&x=1`],
    ['a trailing path', `/api/widget/logo/${TOKEN}/x?v=${VERSION}`],
    ['a quote', `${LOGO_PATH}"`],
    ['a number', 42],
    ['an object', {}],
  ])('ignores %s and shows the chat icon', async (_label, value) => {
    const w = run(withLogo(value))
    await ready(w)
    expect(w.logoImage()).toBeUndefined()
    expect(w.icon()?.tag).toBe('svg')
    expect(pathOf(w.icon())).toBe(CHAT_PATH)
  })

  it('falls back to the chat icon if the image cannot load', async () => {
    const w = run(withLogo(LOGO_PATH))
    await ready(w)
    w.logoImage()?.onerror?.()
    expect(w.logoImage()).toBeUndefined()
    expect(pathOf(w.icon())).toBe(CHAT_PATH)
  })

  it('shows the close icon, not the logo, while the chat is open, and the logo again when it closes', async () => {
    const w = run(withLogo(LOGO_PATH))
    await ready(w)
    w.click() // open
    expect(w.logoImage()).toBeUndefined()
    expect(pathOf(w.icon())).toBe(CLOSE_PATH)
    expect(w.bubble()?.getAttribute('aria-label')).toBe('Close support chat')
    w.click() // close
    expect(w.bubble()?.getAttribute('aria-label')).toBe('Open support chat')
    expect(w.icon()).toBeUndefined()
    expect(w.logoImage()?.src).toBe(`https://app.test${LOGO_PATH}`)
  })

  it('does not try the logo again once it has failed', async () => {
    const w = run(withLogo(LOGO_PATH))
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
