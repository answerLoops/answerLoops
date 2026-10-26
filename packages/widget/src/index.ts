export interface WidgetOptions {
  /** The embed token from Settings → Widget (the `data-widget-id` value). */
  widgetId: string
  /** The origin of your answerLoops instance, e.g. `https://your-instance.example.com`. */
  baseUrl: string
  /** Called if the widget script cannot be loaded. */
  onError?: (error: Error) => void
}

export interface WidgetHandle {
  /** Removes the chat bubble, the panel and the loader script from the page. */
  unmount: () => void
}

interface Mount {
  key: string
  disposed: boolean
  loaded: boolean
  script: HTMLScriptElement | null
}

const NOOP_HANDLE: WidgetHandle = { unmount() {} }

// widget.js builds its DOM with fixed ids and has no teardown of its own, so
// only one widget can live on a page. `current` is that one; `tail` serialises
// script loads so a mount that follows a quick unmount (React StrictMode, a
// fast route change) never runs two copies of the script at once.
let current: Mount | null = null
let tail: Promise<void> = Promise.resolve()

function normalize(options: WidgetOptions): { widgetId: string; baseUrl: string } {
  const widgetId = options.widgetId?.trim()
  if (!widgetId) throw new Error('answerLoops widget: widgetId is required')

  let url: URL
  try {
    url = new URL(options.baseUrl)
  } catch {
    throw new Error('answerLoops widget: baseUrl must be a full URL such as https://your-instance.example.com')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('answerLoops widget: baseUrl must start with https:// or http://')
  }
  if (url.username || url.password) {
    throw new Error('answerLoops widget: baseUrl must not contain credentials')
  }

  return { widgetId, baseUrl: `${url.origin}${url.pathname}`.replace(/\/+$/, '') }
}

// Everything widget.js adds to the page. The style element has no id, so it is
// found by the selector it defines.
function removeWidgetDom(script: HTMLScriptElement | null) {
  script?.remove()
  document.getElementById('cp-widget-bubble')?.remove()
  document.getElementById('cp-widget-panel')?.remove()
  for (const style of Array.from(document.head.querySelectorAll('style'))) {
    if (style.textContent?.includes('#cp-widget-bubble')) style.remove()
  }
}

function ready(): Promise<void> {
  if (document.readyState !== 'loading') return Promise.resolve()
  return new Promise((resolve) => document.addEventListener('DOMContentLoaded', () => resolve(), { once: true }))
}

/**
 * Loads the answerLoops chat widget from your instance and shows the chat
 * bubble. Calling it again with the same options is a no-op that returns the
 * same handle; calling it with different options replaces the widget. Does
 * nothing on the server.
 */
export function mountWidget(options: WidgetOptions): WidgetHandle {
  if (typeof document === 'undefined') return NOOP_HANDLE

  const { widgetId, baseUrl } = normalize(options)
  const key = `${baseUrl}|${widgetId}`

  if (current && current.key === key) return handleFor(current)
  if (current) handleFor(current).unmount()

  const mount: Mount = { key, disposed: false, loaded: false, script: null }
  current = mount

  tail = tail
    .then(ready)
    .then(
      () =>
        new Promise<void>((resolve) => {
          if (mount.disposed) return resolve()

          const script = document.createElement('script')
          script.src = `${baseUrl}/widget.js`
          script.async = true
          script.setAttribute('data-widget-id', widgetId)
          script.setAttribute('data-base-url', baseUrl)

          script.addEventListener('load', () => {
            mount.loaded = true
            if (mount.disposed) removeWidgetDom(mount.script)
            resolve()
          })
          script.addEventListener('error', () => {
            mount.loaded = true
            script.remove()
            if (!mount.disposed) options.onError?.(new Error(`answerLoops widget: could not load ${script.src}`))
            resolve()
          })

          mount.script = script
          document.head.appendChild(script)
        }),
    )

  return handleFor(mount)
}

const handles = new WeakMap<Mount, WidgetHandle>()

function handleFor(mount: Mount): WidgetHandle {
  let handle = handles.get(mount)
  if (!handle) {
    handle = {
      unmount() {
        if (mount.disposed) return
        mount.disposed = true
        if (current === mount) current = null
        // A script still in flight cleans up after itself when it loads, so the
        // next mount cannot end up with two bubbles.
        if (mount.script === null || mount.loaded) removeWidgetDom(mount.script)
      },
    }
    handles.set(mount, handle)
  }
  return handle
}
