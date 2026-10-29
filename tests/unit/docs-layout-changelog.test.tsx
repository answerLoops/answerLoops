import { describe, it, expect, afterEach, vi } from 'vitest'
import type { ReactElement } from 'react'

/**
 * The docs sidebar decides whether to show the Changelog link when a page is
 * requested, not when the site is built.
 *
 * The deployment setting is only known at request time, and the build machine
 * does not have it. A layout that read it while building would ship the same
 * answer to every deployment, and the managed one would get docs with no link.
 * Source-text checks cannot prove that, so this imports the real layout, sets
 * the setting after the import, and reads what the sidebar footer would
 * receive. The link lives at the foot of the sidebar, never in the header.
 */

vi.mock('fumadocs-ui/provider/next', () => ({ RootProvider: () => null }))
vi.mock('fumadocs-ui/layouts/docs', () => ({ DocsLayout: () => null }))
vi.mock('@/lib/docs/source', () => ({ docsSource: { pageTree: {} } }))
vi.mock('@/components/logo', () => ({ LogoMark: () => null }))
vi.mock('next/script', () => ({ default: () => null }))

import * as docsLayout from '@/app/docs/layout'
import { DocsSidebarFooter } from '@/components/docs/docs-sidebar-footer'

type HeaderLink = { text: unknown; url: string; type?: string }
type LayoutProps = {
  links: HeaderLink[]
  sidebar?: { footer?: ReactElement<{ changelogUrl: string | null }> }
}

const ORIGINAL_MODE = process.env.DEPLOYMENT_MODE

function layoutProps(): LayoutProps {
  const root = docsLayout.default({ children: null }) as ReactElement<{ children: ReactElement<LayoutProps> }>
  return root.props.children.props
}

const footerUrl = () => layoutProps().sidebar?.footer?.props.changelogUrl

afterEach(() => {
  if (ORIGINAL_MODE === undefined) delete process.env.DEPLOYMENT_MODE
  else process.env.DEPLOYMENT_MODE = ORIGINAL_MODE
})

describe('docs layout changelog link', () => {
  it('is rendered per request', () => {
    expect(docsLayout.dynamic).toBe('force-dynamic')
  })

  it('puts the link in the sidebar footer on the managed deployment', () => {
    process.env.DEPLOYMENT_MODE = 'cloud'
    const footer = layoutProps().sidebar?.footer
    expect(footer?.type).toBe(DocsSidebarFooter)
    expect(footer?.props.changelogUrl).toBe('https://answerloops.com/changelog')
  })

  it('hands the footer nothing when the deployment is unset', () => {
    delete process.env.DEPLOYMENT_MODE
    expect(footerUrl()).toBeNull()
  })

  it('hands the footer nothing on a self-hosted deployment', () => {
    process.env.DEPLOYMENT_MODE = 'self-hosted'
    expect(footerUrl()).toBeNull()
  })

  it('follows the setting on each call instead of fixing it once', () => {
    process.env.DEPLOYMENT_MODE = 'cloud'
    expect(footerUrl()).toBe('https://answerloops.com/changelog')
    process.env.DEPLOYMENT_MODE = 'self-hosted'
    expect(footerUrl()).toBeNull()
    process.env.DEPLOYMENT_MODE = 'cloud'
    expect(footerUrl()).toBe('https://answerloops.com/changelog')
  })

  it('keeps the changelog out of the header, in every deployment', () => {
    for (const mode of ['cloud', 'self-hosted', undefined]) {
      if (mode === undefined) delete process.env.DEPLOYMENT_MODE
      else process.env.DEPLOYMENT_MODE = mode
      const links = layoutProps().links
      expect(links.some((l) => l.text === 'Changelog' || /changelog/i.test(l.url)), String(mode)).toBe(false)
    }
  })

  it('keeps the sign-in and start entries in the header either way', () => {
    delete process.env.DEPLOYMENT_MODE
    const links = layoutProps().links
    expect(links).toHaveLength(2)
    expect(links.some((l) => l.type === 'button')).toBe(true)
  })
})
