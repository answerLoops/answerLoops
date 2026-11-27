import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

/**
 * public/widget.js tells the chat page each time the panel opens: it moves
 * focus into the frame and posts { type: 'answerloops:panel-opened' } to the
 * chat's own origin, so the chat can put the cursor in the question box (the
 * chat page decides whether to, by device). A frame that is still loading is
 * announced from its load event instead, and a closed panel is never announced.
 * Run against a stub DOM, as in widget-lazy-frame.test.ts.
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
  classes: Set<string>
  src: string
  posted: Array<{ data: unknown; origin: string }>
  focusCount: number
  contentWindow: { postMessage(data: unknown, origin: string): void }
  focus(): void
  setAttribute(k: string, v: string): void
  getAttribute(k: string): string | null
  addEventListener(type: string, fn: () => void): void
  appendChild(c: El): void
  classList: { add(c: string): void; remove(c: string): void }
}

function el(tag: string): El {
  const e: El = {
    tag,
    id: '',
    innerHTML: '',
    textContent: '',
    title: '',
    attrs: {},
    children: [],
    listeners: {},
    classes: new Set(),
    src: '',
    posted: [],
    focusCount: 0,
    contentWindow: {
      postMessage: (data, origin) => void e.posted.push({ data, origin }),
    },
    focus() {
      e.focusCount++
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
      // What the child's address was at the moment it joined the page.
      c.attrs['data-src-at-append'] = c.src
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

async function ready() {
  const script = el('script')
  script.attrs['data-base-url'] = 'https://app.test'
  script.attrs['data-widget-id'] = TOKEN
  const body = el('body')
  const clock = { now: 1_700_000_000_000 }
  const sandbox: Record<string, unknown> = {
    document: {
      currentScript: script,
      readyState: 'complete',
      head: el('head'),
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
  await new Promise((r) => setTimeout(r, 20))
  const panel = () => body.children.find((c) => c.id === 'cp-widget-panel')!
  const frame = () => panel().children.find((c) => c.tag === 'iframe')!
  return {
    clock,
    frame,
    click: () => body.children.find((c) => c.id === 'cp-widget-bubble')!.listeners.click(),
    load: () => frame().listeners.load(),
  }
}

const OPENED = { type: 'answerloops:panel-opened' }

describe('public/widget.js: telling the chat the panel opened', () => {
  it('waits for a new frame to load, then focuses it and posts the open message to the chat’s origin', async () => {
    const w = await ready()
    w.click()
    expect(w.frame().posted).toEqual([])
    expect(w.frame().focusCount).toBe(0)

    w.load()
    expect(w.frame().posted).toEqual([{ data: OPENED, origin: 'https://app.test' }])
    expect(w.frame().focusCount).toBe(1)
  })

  it('announces again on every reopen of a frame that is already loaded', async () => {
    const w = await ready()
    w.click()
    w.load()
    w.click() // close
    w.click() // reopen
    expect(w.frame().posted).toHaveLength(2)
    expect(w.frame().focusCount).toBe(2)
  })

  it('never announces while the panel is closed, even if the frame finishes loading then', async () => {
    const w = await ready()
    w.click()
    w.click() // closed before the frame loaded
    w.load()
    expect(w.frame().posted).toEqual([])
    expect(w.frame().focusCount).toBe(0)
  })

  it('waits for the reload when an old frame is reloaded on reopen, so the new page receives it', async () => {
    const w = await ready()
    w.click()
    w.load()
    w.click() // close
    w.clock.now += 4 * 60 * 1000 + 1
    w.click() // reopen: the frame reloads
    expect(w.frame().posted).toHaveLength(1)
    w.load()
    expect(w.frame().posted).toHaveLength(2)
  })

  it('gives the frame its address before adding it, so no empty page loads (and reports loaded) first', async () => {
    const w = await ready()
    w.click()
    expect(w.frame().attrs['data-src-at-append']).toBe(`https://app.test/widget/${TOKEN}`)
  })

  it('sends nothing but the message type', async () => {
    const w = await ready()
    w.click()
    w.load()
    expect(Object.keys(w.frame().posted[0].data as object)).toEqual(['type'])
  })
})
