import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'

/**
 * The chat assistant on our own public pages. What is checked: the id it reads
 * (validated, and read per request), what it renders, and exactly which pages
 * carry it. The last matters as much as the first two: it belongs on pages
 * where a visitor is deciding about answerLoops, and never inside the signed-in
 * app, where the workspace on screen belongs to a person.
 */

vi.mock('next/script', () => ({ default: () => null }))
vi.mock('next/font/google', () => ({ Source_Sans_3: () => ({ variable: 'font-var' }) }))
vi.mock('next/link', () => ({ default: () => null }))
vi.mock('@/components/marketing/chrome', () => ({ Nav: () => null, Footer: () => null }))
vi.mock('@/components/marketing/marketing-site.css', () => ({}))

import Script from 'next/script'
import { siteChatWidgetId } from '@/lib/site'
import { SiteChatWidget } from '@/components/site-chat-widget'
import { MarketingPage } from '@/components/marketing/layout'

const TOKEN = 'a1'.repeat(24)
const ORIGINAL = process.env.SITE_CHAT_WIDGET_ID

beforeEach(() => {
  delete process.env.SITE_CHAT_WIDGET_ID
})
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.SITE_CHAT_WIDGET_ID
  else process.env.SITE_CHAT_WIDGET_ID = ORIGINAL
})

describe('siteChatWidgetId', () => {
  it('is null when nothing is set', () => {
    expect(siteChatWidgetId()).toBeNull()
  })

  it('is null when the variable is empty or only spaces', () => {
    process.env.SITE_CHAT_WIDGET_ID = ''
    expect(siteChatWidgetId()).toBeNull()
    process.env.SITE_CHAT_WIDGET_ID = '   '
    expect(siteChatWidgetId()).toBeNull()
  })

  it('accepts a widget token', () => {
    process.env.SITE_CHAT_WIDGET_ID = TOKEN
    expect(siteChatWidgetId()).toBe(TOKEN)
  })

  it('accepts a widget public name', () => {
    process.env.SITE_CHAT_WIDGET_ID = 'answerloops-guide'
    expect(siteChatWidgetId()).toBe('answerloops-guide')
  })

  it('ignores surrounding whitespace', () => {
    process.env.SITE_CHAT_WIDGET_ID = `  ${TOKEN}\n`
    expect(siteChatWidgetId()).toBe(TOKEN)
  })

  it('ignores a value that is neither a token nor a valid name', () => {
    for (const bad of ['no spaces allowed', 'UPPER_case!', 'ab', 'x'.repeat(41), 'https://evil.test/widget.js', '"><script>alert(1)</script>', 'a'.repeat(47) + 'g']) {
      process.env.SITE_CHAT_WIDGET_ID = bad
      expect(siteChatWidgetId(), bad).toBeNull()
    }
  })

  it('is read every time it is asked, so a change needs no rebuild', () => {
    process.env.SITE_CHAT_WIDGET_ID = 'first-guide'
    expect(siteChatWidgetId()).toBe('first-guide')
    process.env.SITE_CHAT_WIDGET_ID = 'second-guide'
    expect(siteChatWidgetId()).toBe('second-guide')
    delete process.env.SITE_CHAT_WIDGET_ID
    expect(siteChatWidgetId()).toBeNull()
  })
})

describe('SiteChatWidget', () => {
  it('renders nothing when no widget is configured', () => {
    expect(SiteChatWidget()).toBeNull()
  })

  it('renders nothing for an id that fails validation', () => {
    process.env.SITE_CHAT_WIDGET_ID = 'not valid'
    expect(SiteChatWidget()).toBeNull()
  })

  it('loads our own widget script, after the page, with the configured id', () => {
    process.env.SITE_CHAT_WIDGET_ID = 'answerloops-guide'
    const element = SiteChatWidget() as ReactElement<Record<string, unknown>>
    expect(element.type).toBe(Script)
    expect(element.props.src).toBe('/widget.js')
    expect(element.props['data-widget-id']).toBe('answerloops-guide')
    expect(element.props.strategy).toBe('lazyOnload')
  })
})

/** Whether an element tree contains an element of the given type. */
function contains(node: ReactNode, type: unknown): boolean {
  if (Array.isArray(node)) return node.some((child) => contains(child, type))
  if (!node || typeof node !== 'object') return false
  const element = node as ReactElement<{ children?: ReactNode }>
  if (element.type === type) return true
  return contains(element.props?.children, type)
}

describe('MarketingPage', () => {
  it('has no chat assistant by default', () => {
    expect(contains(MarketingPage({ children: null }), SiteChatWidget)).toBe(false)
  })

  it('shows it when the page opts in', () => {
    expect(contains(MarketingPage({ children: null, chat: true }), SiteChatWidget)).toBe(true)
  })
})

describe('where the assistant is, and is not', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf-8')

  it('is on the home page and the pricing page', () => {
    expect(read('app/page.tsx')).toMatch(/<MarketingPage chat>/)
    expect(read('app/pricing/page.tsx')).toMatch(/<MarketingPage navState=\{navState\} chat>/)
  })

  it('is on the docs, through the docs layout', () => {
    const layout = read('app/docs/layout.tsx')
    expect(layout).toContain("import { SiteChatWidget } from '@/components/site-chat-widget'")
    expect(layout).toContain('<SiteChatWidget />')
  })

  it('is not on the legal pages, the changelog, the blog or the about page', () => {
    for (const file of ['app/privacy/page.tsx', 'app/terms/page.tsx', 'app/changelog/page.tsx', 'app/blog/page.tsx', 'app/blog/[slug]/page.tsx', 'app/about/page.tsx']) {
      expect(read(file), file).not.toMatch(/<MarketingPage[^>]*\bchat\b/)
    }
  })

  it('is never mounted inside the signed-in app', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(path.join(process.cwd(), dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`
        if (entry.isDirectory()) walk(rel)
        else if (/\.(tsx?|jsx?)$/.test(entry.name) && /SiteChatWidget|site-chat-widget/.test(read(rel))) offenders.push(rel)
      }
    }
    walk('app/(dashboard)')
    walk('components/dashboard')
    expect(offenders).toEqual([])
  })

  it('has replaced the old build-time docs variable everywhere', () => {
    for (const file of ['app/docs/layout.tsx', '.env.example', 'content/docs/reference/environment-variables.mdx', 'lib/site.ts']) {
      expect(read(file), file).not.toContain('NEXT_PUBLIC_DOCS_WIDGET_TOKEN')
    }
  })
})

describe('the variable is documented', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf-8')

  // Deliberately not in .env.example: the variable is for showing the product
  // on our own site, and someone self-hosting has no reason to set it. The
  // reference page lists it so nobody wonders what it is, and says to leave it
  // unset on a self-hosted install.
  it('is in the environment variables reference, with where it appears and that it needs no rebuild', () => {
    const row = read('content/docs/reference/environment-variables.mdx')
      .split('\n')
      .find((line) => line.includes('`SITE_CHAT_WIDGET_ID`'))
    expect(row).toBeDefined()
    expect(row).toContain('/docs')
    expect(row).toContain('home and pricing')
    expect(row).toContain('needs no rebuild')
  })
})
