import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * The dashboard has to actually hand the changelog link to the sidebar.
 *
 * The wiring is two steps that are individually invisible: the dashboard
 * layout resolves the link through the helper and passes the address down, and
 * the sidebar renders it when it arrives. A refactor that drops either step
 * leaves a link that looks wired — the helper still works, its tests still
 * pass — but nothing on screen. The sidebar's own rendering is covered in
 * dashboard-navigation.test.tsx; this pins the hand-off from the layout. The
 * docs header is covered by docs-layout-changelog.test.tsx, which runs the
 * real layout.
 */

const repoRoot = process.cwd()

function read(rel: string): string {
  return readFileSync(path.join(repoRoot, rel), 'utf-8')
}

describe('the dashboard hands the changelog link to the sidebar', () => {
  it('resolves the address through the helper inside the layout', () => {
    const src = read('app/(dashboard)/layout.tsx')
    expect(src).toContain("from '@/lib/marketing/changelog-link'")
    // Inside the component, so it is read per request rather than once at load.
    const componentStart = src.indexOf('export default async function DashboardLayout')
    const call = src.search(/const changelogUrl = docsChangelogLink\(\)\?\.url/)
    expect(componentStart).toBeGreaterThanOrEqual(0)
    expect(call).toBeGreaterThan(componentStart)
  })

  it('passes it to the sidebar as a prop', () => {
    // A prop because the sidebar is a client component and cannot read the
    // deployment setting itself.
    expect(read('app/(dashboard)/layout.tsx')).toMatch(/<SidebarNav changelogUrl=\{changelogUrl\} \/>/)
  })

  it('has the sidebar read the prop and nothing else', () => {
    const src = read('components/dashboard/sidebar-nav.tsx')
    expect(src).toMatch(/export function SidebarNav\(\{ changelogUrl \}/)
    // The value arrives from the server layout; the sidebar never reaches for
    // the deployment setting or the helper itself.
    expect(src).not.toContain('marketingSiteEnabled')
    expect(src).not.toContain('changelog-link')
    expect(src).not.toContain('docsChangelogLink')
  })
})
