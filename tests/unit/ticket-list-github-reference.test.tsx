// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { TicketList } from '@/components/tickets/ticket-list'
import type { Ticket } from '@/types'

afterEach(cleanup)

let nextId = 1
function ticket(overrides: Partial<Ticket>): Ticket {
  const id = nextId++
  return {
    id,
    org_ticket_number: id,
    content: `question ${id}`,
    category: 'general_question',
    priority: 'medium',
    status: 'open',
    ai_summary: `summary ${id}`,
    ai_draft_status: null,
    source_platform: 'github',
    source_message_id: null,
    source_channel_id: null,
    source_thread_id: null,
    source_author_name: 'octocat',
    created_at: '2026-10-01T00:00:00.000Z',
    sla_response_deadline: null,
    sla_resolve_deadline: null,
    ...overrides,
  } as Ticket
}

const rowFor = (summary: string) => screen.getByText(summary).closest('tr') as HTMLElement

describe('TicketList GitHub reference', () => {
  it('shows the issue reference under the GitHub badge, linking to the issue', () => {
    render(
      <TicketList
        tickets={[ticket({ ai_summary: 'issue ticket', source_message_id: 'github-issue-owner-repo-123', source_channel_id: 'owner/repo' })]}
      />
    )
    const link = within(rowFor('issue ticket')).getByRole('link', { name: /Issue owner\/repo#123/ })
    expect(link.getAttribute('href')).toBe('https://github.com/owner/repo/issues/123')
  })

  it("shows a comment ticket's parent discussion, not the comment id", () => {
    render(
      <TicketList
        tickets={[ticket({
          ai_summary: 'comment ticket',
          source_message_id: 'github-discussion-comment-owner-repo-98765',
          source_thread_id: 'github-discussion-owner-repo-45',
          source_channel_id: 'owner/repo',
        })]}
      />
    )
    const link = within(rowFor('comment ticket')).getByRole('link', { name: /Discussion owner\/repo#45/ })
    expect(link.textContent).not.toContain('98765')
  })

  it('shows no reference for a GitHub ticket whose ids do not parse', () => {
    render(<TicketList tickets={[ticket({ ai_summary: 'old comment', source_message_id: 'github-issue-comment-owner-repo-9', source_channel_id: 'owner/repo' })]} />)
    expect(within(rowFor('old comment')).queryByTitle(/^Open /)).toBeNull()
  })

  it('shows no reference on tickets from other channels, even with a GitHub-shaped id', () => {
    render(
      <TicketList
        tickets={[ticket({ ai_summary: 'slack ticket', source_platform: 'slack', source_message_id: 'github-issue-owner-repo-1', source_channel_id: 'owner/repo' })]}
      />
    )
    expect(within(rowFor('slack ticket')).queryByTitle(/^Open /)).toBeNull()
  })
})
