// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { RepoSyncStatus } from '@/components/kb/repo-sync-status'
import { commitLinkInfo } from '@/lib/github/commit-link'

afterEach(cleanup)

const SHA = '0123456789abcdef0123456789abcdef01234567'

function repo(over: Partial<Parameters<typeof RepoSyncStatus>[0]['repo']> = {}) {
  return {
    owner: 'acme',
    repo: 'docs',
    kb_chunk_count: 12,
    kb_last_synced: '2026-03-04T12:00:00.000Z',
    kb_synced_commit: SHA as string | null,
    ...over,
  }
}

describe('RepoSyncStatus', () => {
  it('shows "Not yet synced" when there are no chunks, even if a sha exists', () => {
    const { container } = render(<RepoSyncStatus repo={repo({ kb_chunk_count: 0 })} />)
    expect(container.textContent).toBe('Not yet synced')
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('shows the chunk count and the last-synced date', () => {
    const { container } = render(<RepoSyncStatus repo={repo()} />)
    const date = new Date('2026-03-04T12:00:00.000Z').toLocaleDateString()
    expect(container.textContent).toContain('12 chunks')
    expect(container.textContent).toContain(`last synced ${date}`)
  })

  it('shows "never" when there is no last-synced date', () => {
    const { container } = render(<RepoSyncStatus repo={repo({ kb_last_synced: null })} />)
    expect(container.textContent).toContain('last synced never')
  })

  it('links a valid sha with its first 7 characters, to the GitHub commit, in a new tab', () => {
    const { container } = render(<RepoSyncStatus repo={repo()} />)
    const link = screen.getByRole('link') as HTMLAnchorElement
    expect(link.textContent).toBe(SHA.slice(0, 7))
    expect(link.getAttribute('href')).toBe(`https://github.com/acme/docs/commit/${SHA}`)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(container.textContent).toContain('docs at')
  })

  it.each([
    ['null', null],
    ['short', 'abc1234'],
    ['uppercase', SHA.toUpperCase()],
    ['non-hex', 'g'.repeat(40)],
    ['path characters', '../'.padEnd(40, 'a')],
    ['quote characters', `"onmouseover=x ${'a'.repeat(30)}`.slice(0, 40)],
    ['trailing newline', `${SHA}\n`],
    ['41 characters', `${SHA}a`],
    ['empty', ''],
  ])('renders no link when the sha is %s', (_name, sha) => {
    const { container } = render(<RepoSyncStatus repo={repo({ kb_synced_commit: sha })} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(container.textContent).toContain('12 chunks')
    expect(container.textContent).not.toContain('docs at')
  })

  it('URL-encodes owner and repo with special characters in the href', () => {
    render(<RepoSyncStatus repo={repo({ owner: 'a b/c', repo: 'x?y#z' })} />)
    const href = screen.getByRole('link').getAttribute('href')
    expect(href).toBe(`https://github.com/a%20b%2Fc/x%3Fy%23z/commit/${SHA}`)
  })
})

describe('commitLinkInfo', () => {
  it('returns short sha and url for a valid sha', () => {
    expect(commitLinkInfo('acme', 'docs', SHA)).toEqual({
      short: '0123456',
      url: `https://github.com/acme/docs/commit/${SHA}`,
    })
  })

  it('returns null for null, undefined, empty and malformed values', () => {
    for (const bad of [null, undefined, '', 'abc', SHA.toUpperCase(), `${SHA}/../x`, `${SHA.slice(0, 39)}"`]) {
      expect(commitLinkInfo('acme', 'docs', bad)).toBeNull()
    }
  })

  it('encodes owner and repo', () => {
    expect(commitLinkInfo('o/w', 'r p', SHA)?.url).toBe(`https://github.com/o%2Fw/r%20p/commit/${SHA}`)
  })
})
