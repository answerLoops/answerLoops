// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8')
const ORIGIN = 'https://app.example.test'

type Handler = (event: Record<string, unknown>) => void

function loadWorker(openClients: Array<Record<string, unknown>> = []) {
  const handlers: Record<string, Handler> = {}
  const showNotification = vi.fn().mockResolvedValue(undefined)
  const openWindow = vi.fn().mockResolvedValue(undefined)
  const matchAll = vi.fn().mockResolvedValue(openClients)
  const self = {
    addEventListener: (type: string, fn: Handler) => { handlers[type] = fn },
    registration: { showNotification },
    location: { origin: ORIGIN },
  }
  new Function('self', 'clients', src)(self, { matchAll, openWindow })
  return { handlers, showNotification, openWindow, matchAll }
}

function push(handlers: Record<string, Handler>, payload: unknown) {
  const waitUntil = vi.fn()
  handlers.push({ data: { json: () => payload }, waitUntil })
  return waitUntil
}

describe('service worker push', () => {
  it('passes the tag and renotify when the payload has a tag', () => {
    const w = loadWorker()
    push(w.handlers, { title: 'New reply on #17', body: 'b', url: '/tickets/17', tag: 'ticket-42' })
    const [title, options] = w.showNotification.mock.calls[0]
    expect(title).toBe('New reply on #17')
    expect(options.tag).toBe('ticket-42')
    expect(options.renotify).toBe(true)
    expect(options.data).toEqual({ url: '/tickets/17' })
  })

  it('sets neither tag nor renotify without a tag', () => {
    const w = loadWorker()
    push(w.handlers, { title: 't', body: 'b' })
    const options = w.showNotification.mock.calls[0][1]
    expect('tag' in options).toBe(false)
    expect('renotify' in options).toBe(false)
    expect(options.data).toEqual({ url: '/' })
  })

  it('hands the notification promise to waitUntil', () => {
    const w = loadWorker()
    expect(push(w.handlers, { title: 't' })).toHaveBeenCalledTimes(1)
  })
})

describe('service worker notificationclick', () => {
  function click(w: ReturnType<typeof loadWorker>, url?: string) {
    const close = vi.fn()
    const waitUntil = vi.fn()
    w.handlers.notificationclick({ notification: { close, data: url ? { url } : undefined }, waitUntil })
    return { close, done: waitUntil.mock.calls[0][0] as Promise<unknown> }
  }

  it('closes the notification, then navigates and focuses an open same-origin window', async () => {
    const focus = vi.fn().mockResolvedValue(undefined)
    const navigate = vi.fn().mockResolvedValue({ focus })
    const w = loadWorker([
      { url: 'https://other.example.test/x', navigate: vi.fn(), focus: vi.fn() },
      { url: `${ORIGIN}/dashboard`, navigate, focus: vi.fn() },
    ])
    const { close, done } = click(w, '/tickets/17')
    await done
    expect(close).toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith(`${ORIGIN}/tickets/17`)
    expect(focus).toHaveBeenCalled()
    expect(w.openWindow).not.toHaveBeenCalled()
  })

  it('opens a new window with an absolute URL when no same-origin window is open', async () => {
    const w = loadWorker([{ url: 'https://other.example.test/x', navigate: vi.fn(), focus: vi.fn() }])
    const { close, done } = click(w, '/tickets/17')
    await done
    expect(close).toHaveBeenCalled()
    expect(w.openWindow).toHaveBeenCalledWith(`${ORIGIN}/tickets/17`)
  })

  it('falls back to the origin root when the payload has no url', async () => {
    const w = loadWorker([])
    const { done } = click(w)
    await done
    expect(w.openWindow).toHaveBeenCalledWith(`${ORIGIN}/`)
  })
})
