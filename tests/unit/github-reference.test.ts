// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { githubReference } from '@/lib/github/reference'

const ticket = (source_message_id: string | null, source_channel_id: string | null, source_thread_id: string | null = null) =>
  ({ source_message_id, source_channel_id, source_thread_id })

describe('githubReference', () => {
  it('reads an issue ticket', () => {
    expect(githubReference(ticket('github-issue-owner-repo-123', 'owner/repo'))).toEqual({
      kind: 'issue', owner: 'owner', repo: 'repo', number: 123,
      short: 'owner/repo#123', label: 'Issue owner/repo#123',
      url: 'https://github.com/owner/repo/issues/123',
    })
  })

  it('reads a discussion ticket and links to /discussions/<n>', () => {
    const ref = githubReference(ticket('github-discussion-owner-repo-45', 'owner/repo'))
    expect(ref).toMatchObject({ kind: 'discussion', label: 'Discussion owner/repo#45', number: 45 })
    expect(ref?.url).toBe('https://github.com/owner/repo/discussions/45')
  })

  it('handles hyphens in the owner and repo', () => {
    const ref = githubReference(ticket('github-issue-my-org-my-repo-7', 'my-org/my-repo'))
    expect(ref).toMatchObject({ owner: 'my-org', repo: 'my-repo', number: 7, short: 'my-org/my-repo#7' })
  })

  it('shows the parent issue, not the comment id, for a ticket opened by a comment', () => {
    const ref = githubReference(ticket('github-issue-comment-owner-repo-98765', 'owner/repo', 'github-issue-owner-repo-123'))
    expect(ref).toMatchObject({ kind: 'issue', number: 123, label: 'Issue owner/repo#123' })
    const discussion = githubReference(ticket('github-discussion-comment-owner-repo-5', 'owner/repo', 'github-discussion-owner-repo-45'))
    expect(discussion).toMatchObject({ kind: 'discussion', number: 45 })
  })

  it('returns null for a comment ticket with no stored parent', () => {
    expect(githubReference(ticket('github-issue-comment-owner-repo-98765', 'owner/repo'))).toBeNull()
  })

  it.each([
    ['no message id', null, 'owner/repo'],
    ['no channel', 'github-issue-owner-repo-1', null],
    ['channel without a slash', 'github-issue-owner-repo-1', 'ownerrepo'],
    ['empty owner', 'github-issue--repo-1', '/repo'],
    ['empty repo', 'github-issue-owner--1', 'owner/'],
    ['extra path segment', 'github-issue-a-b-1', 'a/b/c'],
    ['non-numeric number', 'github-issue-owner-repo-abc', 'owner/repo'],
    ['id for a different repo', 'github-issue-other-repo-1', 'owner/repo'],
    ['a non-GitHub id', 'slack-123', 'owner/repo'],
  ])('returns null when it does not parse: %s', (_name, messageId, channel) => {
    expect(githubReference(ticket(messageId, channel))).toBeNull()
  })
})
