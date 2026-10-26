// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { render } from '@testing-library/react'
import { StrictMode } from 'react'

// The loader keeps one widget per page in module state, so each test imports a
// fresh copy.
async function load() {
  vi.resetModules()
  return import('@/packages/widget/src/index')
}

const BASE = 'https://app.example.com'
const scripts = () => Array.from(document.head.querySelectorAll('script'))

// Stands in for what public/widget.js adds once it has run.
function simulateWidgetDom() {
  const style = document.createElement('style')
  style.textContent = '#cp-widget-bubble{position:fixed;}'
  document.head.appendChild(style)
  for (const id of ['cp-widget-bubble', 'cp-widget-panel']) {
    const el = document.createElement('div')
    el.id = id
    document.body.appendChild(el)
  }
}

const widgetDomPresent = () =>
  Boolean(document.getElementById('cp-widget-bubble')) ||
  Boolean(document.getElementById('cp-widget-panel')) ||
  Array.from(document.head.querySelectorAll('style')).some((s) => s.textContent?.includes('#cp-widget-bubble'))

async function loaded(script: HTMLScriptElement) {
  simulateWidgetDom()
  script.dispatchEvent(new Event('load'))
  await Promise.resolve()
}

beforeEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''

  // happy-dom throws when a script with a real JavaScript type is attached
  // while file loading is disabled. A non-JS type keeps the element inert, so
  // each test fires load or error itself.
  const create = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string, options?: ElementCreationOptions) => {
    const el = create(tag, options)
    if (tag === 'script') (el as HTMLScriptElement).type = 'text/plain'
    return el
  }) as typeof document.createElement)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('mountWidget', () => {
  it('injects the loader script with the token and base URL the widget reads', async () => {
    const { mountWidget } = await load()
    mountWidget({ widgetId: 'tok_abc', baseUrl: BASE })

    await vi.waitFor(() => expect(scripts()).toHaveLength(1))
    const [script] = scripts()
    expect(script.getAttribute('src')).toBe(`${BASE}/widget.js`)
    expect(script.getAttribute('data-widget-id')).toBe('tok_abc')
    expect(script.getAttribute('data-base-url')).toBe(BASE)
    expect(script.async).toBe(true)
  })

  it('normalises trailing slashes and keeps a path prefix', async () => {
    const { mountWidget } = await load()
    mountWidget({ widgetId: 'tok', baseUrl: `${BASE}/support///` })

    await vi.waitFor(() => expect(scripts()).toHaveLength(1))
    expect(scripts()[0].getAttribute('src')).toBe(`${BASE}/support/widget.js`)
    expect(scripts()[0].getAttribute('data-base-url')).toBe(`${BASE}/support`)
  })

  it.each([
    ['an empty widgetId', { widgetId: '  ', baseUrl: BASE }, /widgetId is required/],
    ['a baseUrl that is not a URL', { widgetId: 'tok', baseUrl: 'app.example.com' }, /full URL/],
    ['a non-http baseUrl', { widgetId: 'tok', baseUrl: 'javascript:alert(1)' }, /https:\/\/ or http:\/\//],
    ['a baseUrl with credentials', { widgetId: 'tok', baseUrl: 'https://user:pw@app.example.com' }, /credentials/],
  ])('rejects %s without touching the page', async (_label, options, message) => {
    const { mountWidget } = await load()
    expect(() => mountWidget(options)).toThrow(message)
    await Promise.resolve()
    expect(scripts()).toHaveLength(0)
  })

  it('unmount removes the script, the bubble, the panel and the styles', async () => {
    const { mountWidget } = await load()
    const handle = mountWidget({ widgetId: 'tok', baseUrl: BASE })
    await vi.waitFor(() => expect(scripts()).toHaveLength(1))
    await loaded(scripts()[0])
    expect(widgetDomPresent()).toBe(true)

    handle.unmount()

    expect(scripts()).toHaveLength(0)
    expect(widgetDomPresent()).toBe(false)
  })

  it('leaves unrelated styles and elements alone on unmount', async () => {
    const other = document.createElement('style')
    other.textContent = 'body{margin:0}'
    document.head.appendChild(other)

    const { mountWidget } = await load()
    const handle = mountWidget({ widgetId: 'tok', baseUrl: BASE })
    await vi.waitFor(() => expect(scripts()).toHaveLength(1))
    await loaded(scripts()[0])
    handle.unmount()

    expect(document.head.contains(other)).toBe(true)
  })

  it('cleans up after a script that finishes loading once it was unmounted', async () => {
    const { mountWidget } = await load()
    const handle = mountWidget({ widgetId: 'tok', baseUrl: BASE })
    await vi.waitFor(() => expect(scripts()).toHaveLength(1))
    const [script] = scripts()

    handle.unmount()
    expect(scripts()).toHaveLength(1)

    await loaded(script)
    expect(widgetDomPresent()).toBe(false)
    expect(scripts()).toHaveLength(0)
  })

  it('never injects a script for a mount that was unmounted before its turn', async () => {
    const { mountWidget } = await load()
    mountWidget({ widgetId: 'tok', baseUrl: BASE }).unmount()
    await new Promise((r) => setTimeout(r, 10))
    expect(scripts()).toHaveLength(0)
  })

  it('returns the same handle and one script for identical options', async () => {
    const { mountWidget } = await load()
    const a = mountWidget({ widgetId: 'tok', baseUrl: BASE })
    const b = mountWidget({ widgetId: 'tok', baseUrl: `${BASE}/` })
    expect(b).toBe(a)

    await vi.waitFor(() => expect(scripts()).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 10))
    expect(scripts()).toHaveLength(1)
  })

  it('replaces the widget when the options change, one script at a time', async () => {
    const { mountWidget } = await load()
    mountWidget({ widgetId: 'first', baseUrl: BASE })
    await vi.waitFor(() => expect(scripts()).toHaveLength(1))
    const first = scripts()[0]

    mountWidget({ widgetId: 'second', baseUrl: BASE })
    await new Promise((r) => setTimeout(r, 10))
    // The second script waits for the first to finish so widget.js never runs twice at once.
    expect(scripts()).toEqual([first])

    await loaded(first)
    await vi.waitFor(() => expect(scripts()).toHaveLength(1))
    expect(scripts()[0].getAttribute('data-widget-id')).toBe('second')
    expect(widgetDomPresent()).toBe(false)
  })

  it('reports a script that cannot be loaded and removes it', async () => {
    const { mountWidget } = await load()
    const onError = vi.fn()
    mountWidget({ widgetId: 'tok', baseUrl: BASE, onError })
    await vi.waitFor(() => expect(scripts()).toHaveLength(1))

    scripts()[0].dispatchEvent(new Event('error'))
    await Promise.resolve()

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0].message).toContain(`${BASE}/widget.js`)
    expect(scripts()).toHaveLength(0)
  })

  it('does not report an error for a widget that was unmounted first', async () => {
    const { mountWidget } = await load()
    const onError = vi.fn()
    const handle = mountWidget({ widgetId: 'tok', baseUrl: BASE, onError })
    await vi.waitFor(() => expect(scripts()).toHaveLength(1))
    handle.unmount()

    scripts()[0].dispatchEvent(new Event('error'))
    await Promise.resolve()
    expect(onError).not.toHaveBeenCalled()
  })

  it('waits for the document to finish parsing before injecting', async () => {
    const readyState = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading')
    const { mountWidget } = await load()
    mountWidget({ widgetId: 'tok', baseUrl: BASE })
    await new Promise((r) => setTimeout(r, 10))
    expect(scripts()).toHaveLength(0)

    readyState.mockReturnValue('complete')
    document.dispatchEvent(new Event('DOMContentLoaded'))
    await vi.waitFor(() => expect(scripts()).toHaveLength(1))
  })
})

describe('AnswerLoopsWidget', () => {
  async function loadReact() {
    vi.resetModules()
    return import('@/packages/widget/src/react')
  }

  it('renders no markup of its own and mounts the widget', async () => {
    const { AnswerLoopsWidget } = await loadReact()
    const { container } = render(<AnswerLoopsWidget widgetId="tok" baseUrl={BASE} />)

    expect(container.innerHTML).toBe('')
    await vi.waitFor(() => expect(scripts()).toHaveLength(1))
    expect(scripts()[0].getAttribute('data-widget-id')).toBe('tok')
  })

  it('removes the widget when the component unmounts', async () => {
    const { AnswerLoopsWidget } = await loadReact()
    const { unmount } = render(<AnswerLoopsWidget widgetId="tok" baseUrl={BASE} />)
    await vi.waitFor(() => expect(scripts()).toHaveLength(1))
    await loaded(scripts()[0])

    unmount()

    expect(widgetDomPresent()).toBe(false)
    expect(scripts()).toHaveLength(0)
  })

  it('ends up with exactly one script under StrictMode double effects', async () => {
    const { AnswerLoopsWidget } = await loadReact()
    render(
      <StrictMode>
        <AnswerLoopsWidget widgetId="tok" baseUrl={BASE} />
      </StrictMode>,
    )
    await vi.waitFor(() => expect(scripts()).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 10))
    expect(scripts()).toHaveLength(1)
  })

  it('does not reload the widget when only an inline onError changes', async () => {
    const { AnswerLoopsWidget } = await loadReact()
    const { rerender } = render(<AnswerLoopsWidget widgetId="tok" baseUrl={BASE} onError={() => {}} />)
    await vi.waitFor(() => expect(scripts()).toHaveLength(1))
    const first = scripts()[0]

    rerender(<AnswerLoopsWidget widgetId="tok" baseUrl={BASE} onError={() => {}} />)
    await new Promise((r) => setTimeout(r, 10))

    expect(scripts()).toEqual([first])
  })

  it('calls the latest onError when the script fails', async () => {
    const { AnswerLoopsWidget } = await loadReact()
    const stale = vi.fn()
    const latest = vi.fn()
    const { rerender } = render(<AnswerLoopsWidget widgetId="tok" baseUrl={BASE} onError={stale} />)
    await vi.waitFor(() => expect(scripts()).toHaveLength(1))
    rerender(<AnswerLoopsWidget widgetId="tok" baseUrl={BASE} onError={latest} />)

    scripts()[0].dispatchEvent(new Event('error'))
    await Promise.resolve()

    expect(stale).not.toHaveBeenCalled()
    expect(latest).toHaveBeenCalledTimes(1)
  })
})

// Guards the pieces of packaging that only fail after publish.
describe('@answerloops/widget packaging', () => {
  const root = process.cwd()
  const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8')
  const pkg = JSON.parse(read('packages/widget/package.json'))

  it('points the package at this repository so GitHub lists dependents under "Used by"', () => {
    expect(pkg.name).toBe('@answerloops/widget')
    expect(pkg.repository).toMatchObject({
      type: 'git',
      url: 'git+https://github.com/answerLoops/answerLoops.git',
      directory: 'packages/widget',
    })
  })

  it('exposes the loader and the React component with types, ESM and CJS', () => {
    for (const [entry, file] of [
      ['.', 'index'],
      ['./react', 'react'],
    ]) {
      expect(pkg.exports[entry]).toEqual({
        types: `./dist/${file}.d.ts`,
        import: `./dist/${file}.js`,
        require: `./dist/${file}.cjs`,
      })
    }
  })

  it('treats react as an optional peer so plain JavaScript sites need not install it', () => {
    expect(pkg.peerDependencies.react).toBeDefined()
    expect(pkg.peerDependenciesMeta.react.optional).toBe(true)
    expect(pkg.dependencies).toBeUndefined()
  })

  it('marks only the React entry as a client module', () => {
    const config = read('packages/widget/tsup.config.ts')
    const banners = config.match(/banner/g) ?? []
    expect(banners).toHaveLength(1)
    expect(config.indexOf("'use client'") ).toBeGreaterThan(config.indexOf("react: 'src/react.tsx'"))
  })

  it('publishes on its own tag namespace, checked against package.json', () => {
    const wf = read('.github/workflows/publish-widget.yml')
    expect(wf).toContain("- 'widget-v*.*.*'")
    expect(wf).toContain('GITHUB_REF_NAME#widget-v')
    expect(wf).toContain('pnpm --filter @answerloops/widget build')
    expect(wf).toContain('npm publish --provenance --access public')
    expect(wf).toContain('id-token: write')
  })
})
