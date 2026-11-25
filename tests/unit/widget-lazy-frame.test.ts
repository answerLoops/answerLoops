import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

/**
 * public/widget.js against a stub DOM: the chat frame is created the first
 * time the bubble is opened, so a visitor who reads a page for a while and then
 * opens the chat gets a frame loaded at that moment, and reopening it after a
 * long gap loads it again.
 */

const SOURCE = fs.readFileSync(path.join(process.cwd(), 'public/widget.js'), 'utf8')
const TOKEN = 'a1'.repeat(24)

interface El {
  tag: string
  id: string
  innerHTML: string
  textContent: string
  title: string
  attrs: Record<string, string>
  children: El[]
  listeners: Record<string, () => void>
  srcWrites: string[]
  classes: Set<string>
  src: string
  setAttribute(k: string, v: string): void
  getAttribute(k: string): string | null
  addEventListener(type: string, fn: () => void): void
  appendChild(c: El): void
  classList: { add(c: string): void; remove(c: string): void }
}

function el(tag: string): El {
  let src = ''
  const e: El = {
    tag,
    id: '',
    innerHTML: '',
    textContent: '',
    title: '',
    attrs: {},
    children: [],
    listeners: {},
    srcWrites: [],
    classes: new Set(),
    get src() {
      return src
    },
    set src(value: string) {
      src = value
      e.srcWrites.push(value)
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
    classList: {
      add: (c) => void e.classes.add(c),
      remove: (c) => void e.classes.delete(c),
    },
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

function run() {
  const script = el('script')
  script.attrs['data-base-url'] = 'https://app.test'
  script.attrs['data-widget-id'] = TOKEN
  const head = el('head')
  const body = el('body')
  const clock = { now: 1_700_000_000_000 }
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
    Date: { now: () => clock.now },
    fetch: async () => ({ ok: true, json: async () => ({ token: TOKEN, display: {} }) }),
  }
  sandbox.window = sandbox
  vm.createContext(sandbox)
  vm.runInContext(SOURCE, sandbox)
  const panel = () => body.children.find((c) => c.id === 'cp-widget-panel')
  const bubble = () => body.children.find((c) => c.id === 'cp-widget-bubble')
  return {
    clock,
    panel,
    bubble,
    frame: () => panel()?.children.find((c) => c.tag === 'iframe'),
    click: () => bubble()?.listeners.click?.(),
  }
}

async function ready() {
  const w = run()
  await new Promise((r) => setTimeout(r, 20))
  return w
}

describe('public/widget.js: the chat frame is created when the chat is opened', () => {
  it('has a panel and a bubble on load, but no frame yet', async () => {
    const w = await ready()
    expect(w.bubble()).toBeDefined()
    expect(w.panel()).toBeDefined()
    expect(w.frame()).toBeUndefined()
  })

  it('creates the frame on the first open, pointed at the chat page for the token', async () => {
    const w = await ready()
    w.click()
    expect(w.frame()).toBeDefined()
    expect(w.frame()?.srcWrites).toEqual([`https://app.test/widget/${TOKEN}`])
    expect(w.panel()?.classes.has('cp-open')).toBe(true)
  })

  it('creates it once, however often the bubble is used', async () => {
    const w = await ready()
    w.click()
    w.click()
    w.click()
    expect(w.panel()?.children.filter((c) => c.tag === 'iframe')).toHaveLength(1)
  })

  it('does not reload a frame that was loaded a moment ago', async () => {
    const w = await ready()
    w.click()
    w.click() // close
    w.clock.now += 3 * 60 * 1000
    w.click() // reopen after 3 minutes
    expect(w.frame()?.srcWrites).toHaveLength(1)
  })

  it('loads the frame again when it is reopened after more than four minutes', async () => {
    const w = await ready()
    w.click()
    w.click() // close
    w.clock.now += 4 * 60 * 1000 + 1
    w.click() // reopen
    expect(w.frame()?.srcWrites).toEqual([`https://app.test/widget/${TOKEN}`, `https://app.test/widget/${TOKEN}`])
    expect(w.panel()?.children.filter((c) => c.tag === 'iframe')).toHaveLength(1)
  })

  it('keeps the dialog role and label on the panel, and a white background so it never shows the page through', async () => {
    const w = await ready()
    expect(w.panel()?.attrs.role).toBe('dialog')
    expect(w.panel()?.attrs['aria-label']).toBe('Support chat')
    // The panel's style rule sits in the script source.
    const rule = SOURCE.split('\n').find((line) => line.includes("'#cp-widget-panel{"))
    expect(rule).toContain('background:#ffffff')
  })

  it('does not pass the embedding origin to the frame', async () => {
    const w = await ready()
    w.click()
    expect(w.frame()?.srcWrites[0]).not.toContain('parent=')
    expect(w.frame()?.srcWrites[0]).not.toContain('customer.test')
  })
})
