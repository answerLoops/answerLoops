import { describe, it, expect, afterEach, vi } from 'vitest'
import type { ReactElement } from 'react'

/**
 * The docs header decides whether to show the Changelog link when a page is
 * requested, not when the site is built.
 *
 * The deployment setting is only known at request time, and the build machine
 * does not have it. A layout that read it while building would ship the same
 * answer to every deployment, and the managed one would get docs with no link.
 * Source-text checks cannot prove that, so this imports the real layout, sets
 * the setting after the import, and reads the links the header would receive.
 */

vi.mock('fumadocs-ui/provider/next', () => ({ RootProvider: () => null }))
vi.mock('fumadocs-ui/layouts/docs', () => ({ DocsLayout: () => null }))
vi.mock('@/lib/docs/source', () => ({ docsSource: { pageTree: {} } }))
vi.mock('@/components/logo', () => ({ LogoMark: () => null }))
vi.mock('next/script', () => ({ default: () => null }))

import * as docsLayout from '@/app/docs/layout'

type HeaderLink = { text: unknown; url: string; type?: string }

const ORIGINAL_MODE = process.env.DEPLOYMENT_MODE

function headerLinks(): HeaderLink[] {
  const root = docsLayout.default({ children: null }) as ReactElement<{ children: ReactElement<{ links: HeaderLink[] }> }>
  return root.props.children.props.links
}

afterEach(() => {
  if (ORIGINAL_MODE === undefined) delete process.env.DEPLOYMENT_MODE
  else process.env.DEPLOYMENT_MODE = ORIGINAL_MODE
})

describe('docs layout changelog link', () => {
  it('is rendered per request', () => {
    expect(docsLayout.dynamic).toBe('force-dynamic')
  })

  it('adds the Changelog link on the managed deployment', () => {
    process.env.DEPLOYMENT_MODE = 'cloud'
    expect(headerLinks()).toContainEqual({ text: 'Changelog', url: 'https://answerloops.com/changelog' })
  })

  it('leaves the link out when the deployment is unset', () => {
    delete process.env.DEPLOYMENT_MODE
    expect(headerLinks().some((l) => l.text === 'Changelog')).toBe(false)
  })

  it('leaves the link out on a self-hosted deployment', () => {
    process.env.DEPLOYMENT_MODE = 'self-hosted'
    expect(headerLinks().some((l) => l.text === 'Changelog')).toBe(false)
  })

  it('follows the setting on each call instead of fixing it once', () => {
    process.env.DEPLOYMENT_MODE = 'cloud'
    expect(headerLinks().some((l) => l.text === 'Changelog')).toBe(true)
    process.env.DEPLOYMENT_MODE = 'self-hosted'
    expect(headerLinks().some((l) => l.text === 'Changelog')).toBe(false)
    process.env.DEPLOYMENT_MODE = 'cloud'
    expect(headerLinks().some((l) => l.text === 'Changelog')).toBe(true)
  })

  it('keeps the sign-in and start entries in the header either way', () => {
    delete process.env.DEPLOYMENT_MODE
    const links = headerLinks()
    expect(links.length).toBeGreaterThanOrEqual(2)
    expect(links.some((l) => l.type === 'button')).toBe(true)
  })
})
