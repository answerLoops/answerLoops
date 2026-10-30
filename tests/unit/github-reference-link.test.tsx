// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { GithubReferenceLink } from '@/components/tickets/github-reference'

afterEach(cleanup)

const ticket = (source_message_id: string | null, source_channel_id: string | null, source_thread_id: string | null = null) =>
  ({ source_message_id, source_channel_id, source_thread_id })

describe('GithubReferenceLink', () => {
  it('shows an issue as "Issue owner/repo#123" linking to the issue', () => {
    render(<GithubReferenceLink ticket={ticket('github-issue-owner-repo-123', 'owner/repo')} />)
    const link = screen.getByRole('link', { name: /Issue owner\/repo#123/ })
    expect(link.getAttribute('href')).toBe('https://github.com/owner/repo/issues/123')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  it('labels a discussion as a discussion and links to /discussions/<n>', () => {
    render(<GithubReferenceLink ticket={ticket('github-discussion-owner-repo-45', 'owner/repo')} />)
    const link = screen.getByRole('link', { name: /Discussion owner\/repo#45/ })
    expect(link.getAttribute('href')).toBe('https://github.com/owner/repo/discussions/45')
  })

  it("shows a comment ticket's parent issue number", () => {
    render(
      <GithubReferenceLink ticket={ticket('github-issue-comment-owner-repo-98765', 'owner/repo', 'github-issue-owner-repo-123')} />
    )
    expect(screen.getByRole('link').textContent).toContain('owner/repo#123')
    expect(screen.getByRole('link').textContent).not.toContain('98765')
  })

  it('renders nothing when the ids do not parse', () => {
    const { container } = render(<GithubReferenceLink ticket={ticket('github-issue-owner-repo-abc', 'owner/repo')} />)
    expect(container.innerHTML).toBe('')
  })

  it('the list variant has no icon and truncates so it cannot widen the row', () => {
    render(<GithubReferenceLink variant="list" ticket={ticket('github-issue-owner-repo-123', 'owner/repo')} />)
    const link = screen.getByRole('link')
    expect(link.querySelector('svg')).toBeNull()
    expect(link.className).toContain('truncate')
    expect(link.className).toContain('max-w-')
  })

  it('the detail variant wraps long names instead of overflowing', () => {
    render(<GithubReferenceLink ticket={ticket('github-issue-owner-repo-123', 'owner/repo')} />)
    expect(screen.getByRole('link').className).toContain('max-w-full')
    expect(screen.getByRole('link').querySelector('span')?.className).toContain('break-all')
  })
})
