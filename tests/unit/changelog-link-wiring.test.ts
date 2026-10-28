import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Both surfaces have to actually receive the changelog link.
 *
 * The wiring is three steps that are individually invisible: the helper
 * resolves it, each layout passes it down, and the sidebar renders it. A
 * refactor that drops any one step leaves a link that looks wired — the
 * helper still works, its tests still pass — but nothing on screen. These
 * tests pin the two hand-offs so that failure is loud.
 *
 * The docs layout is checked for the flag indirectly rather than by reading
 * its source: it resolves the link through the helper, and the gate test in
 * marketing-surface-gate.test.ts asserts the layout never names
 * marketingSiteEnabled() itself. This file pins that the call is there.
 */

const repoRoot = process.cwd()

function read(rel: string): string {
  return readFileSync(path.join(repoRoot, rel), 'utf-8')
}

describe('the changelog link reaches both surfaces', () => {
  it('resolves it in the docs layout through the helper', () => {
    const src = read('app/docs/layout.tsx')
    expect(src).toContain("from '@/lib/marketing/changelog-link'")
    expect(src).toContain('docsChangelogLink()')
    // Rendered per request, not baked in at build time: the docs are
    // statically generated, and the deployment flag is a request-time value.
    expect(src).toContain("dynamic = 'force-dynamic'")
  })

  it('resolves it in the dashboard layout through the helper', () => {
    const src = read('app/(dashboard)/layout.tsx')
    expect(src).toContain("from '@/lib/marketing/changelog-link'")
    expect(src).toContain('docsChangelogLink()')
    // Passed to the sidebar as a prop, because the sidebar is a client
    // component and cannot read the flag itself.
    expect(src).toContain('changelogUrl=')
  })

  it('renders it in the sidebar from the prop', () => {
    const src = read('components/dashboard/sidebar-nav.tsx')
    expect(src).toContain('changelogUrl')
    expect(src).toContain('changelogUrl &&')
    // The sidebar never reaches for the flag itself, and never fetches the
    // changelog — the value arrives as a prop from the server layout. (It does
    // still fetch /api/billing/status for the plan lock, which is unrelated.)
    expect(src).not.toContain('marketingSiteEnabled')
    expect(src).not.toContain('changelog-link')
    expect(src).not.toContain('docsChangelogLink')
  })
})
