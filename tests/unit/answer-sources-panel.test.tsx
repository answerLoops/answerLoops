// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { AnswerSourcesPanel } from '@/components/dashboard/answer-sources'
import type { KBAnswerSource, KBTicketAnswerSources } from '@/types'

/**
 * The Sources panel on a ticket's draft: the articles supplied as context, in
 * rank order, each with where it stands now, in words. Live articles link to
 * the knowledge base, deleted and unpublished ones do not, and the copy never
 * says the reply used or cited an article.
 */

const source = (over: Partial<KBAnswerSource> & Pick<KBAnswerSource, 'rank' | 'status'>): KBAnswerSource => ({
  article_id: over.rank * 10,
  title: `Article ${over.rank}`,
  copies: 0,
  ...over,
})

const data = (sources: KBAnswerSource[], over: Partial<KBTicketAnswerSources> = {}): KBTicketAnswerSources => ({
  answer_id: '2f1c9a7e-6b1d-4e0a-9a52-0c3d1a7b8e44',
  outcome: 'generated',
  created_at: '2026-10-25T10:00:00.000Z',
  sources,
  ...over,
})

const items = () => screen.getAllByRole('listitem')

describe('AnswerSourcesPanel statuses', () => {
  it('says current, changed since, unpublished and deleted, each in words', () => {
    render(
      <AnswerSourcesPanel
        data={data([
          source({ rank: 1, status: 'current' }),
          source({ rank: 2, status: 'changed' }),
          source({ rank: 3, status: 'unpublished' }),
          source({ rank: 4, status: 'deleted', article_id: null, title: null }),
        ])}
      />
    )
    const [current, changed, unpublished, deleted] = items()
    expect(current.textContent).toContain('Current')
    expect(current.textContent).toContain('Unchanged since this answer was generated')
    expect(changed.textContent).toContain('Changed since')
    expect(changed.textContent).toContain('Edited or re-synced after this answer was generated')
    expect(unpublished.textContent).toContain('Unpublished')
    expect(unpublished.textContent).toContain('No longer live')
    expect(deleted.textContent).toContain('Deleted')
    expect(deleted.textContent).toContain('The article no longer exists')
  })

  it('never carries a status by colour or icon alone: the label is always text', () => {
    render(
      <AnswerSourcesPanel
        data={data([
          source({ rank: 1, status: 'current' }),
          source({ rank: 2, status: 'changed' }),
          source({ rank: 3, status: 'unpublished' }),
          source({ rank: 4, status: 'deleted', article_id: null, title: null }),
        ])}
      />
    )
    for (const [i, label] of ['Current', 'Changed since', 'Unpublished', 'Deleted'].entries()) {
      expect(within(items()[i]).getByText(label)).toBeTruthy()
    }
  })
})

describe('AnswerSourcesPanel order and links', () => {
  it('lists the sources in the order they were supplied', () => {
    render(
      <AnswerSourcesPanel
        data={data([
          source({ rank: 1, status: 'current', title: 'Reset a password' }),
          source({ rank: 2, status: 'current', title: 'Update billing details' }),
          source({ rank: 3, status: 'current', title: 'Export your data' }),
        ])}
      />
    )
    expect(items().map((li) => li.textContent)).toEqual([
      expect.stringContaining('Reset a password'),
      expect.stringContaining('Update billing details'),
      expect.stringContaining('Export your data'),
    ])
  })

  it('links live articles (current or changed) to their place in the knowledge base', () => {
    render(
      <AnswerSourcesPanel
        data={data([
          source({ rank: 1, status: 'current', article_id: 11, title: 'Reset a password' }),
          source({ rank: 2, status: 'changed', article_id: 12, title: 'Update billing' }),
        ])}
      />
    )
    expect(screen.getByRole('link', { name: 'Reset a password' }).getAttribute('href')).toBe('/kb#article-11')
    expect(screen.getByRole('link', { name: 'Update billing' }).getAttribute('href')).toBe('/kb#article-12')
  })

  it('does not link an unpublished or deleted article', () => {
    render(
      <AnswerSourcesPanel
        data={data([
          source({ rank: 1, status: 'unpublished', title: 'Old workaround' }),
          source({ rank: 2, status: 'deleted', article_id: null, title: null }),
        ])}
      />
    )
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Old workaround')).toBeTruthy()
    expect(screen.getByText('Deleted article')).toBeTruthy()
  })

  it('numbers each entry for screen readers as a position', () => {
    render(<AnswerSourcesPanel data={data([source({ rank: 2, status: 'current' })])} />)
    expect(items()[0].textContent).toContain('Position 2:')
  })
})

describe('AnswerSourcesPanel copy and states', () => {
  it('says supplied as context, and that the assistant decides what to use', () => {
    render(<AnswerSourcesPanel data={data([source({ rank: 1, status: 'current' })])} />)
    const text = document.body.textContent ?? ''
    expect(text).toContain('supplied as context')
    expect(text).toContain('The assistant decides what to use')
  })

  it('never says the reply used or cited an article', () => {
    render(
      <AnswerSourcesPanel
        data={data([source({ rank: 1, status: 'current' }), source({ rank: 2, status: 'deleted', article_id: null, title: null })])}
      />
    )
    expect(document.body.textContent).not.toMatch(/\b(was cited|cited by|cited in|was used by|used by the reply|used in the reply|was quoted)\b/i)
  })

  it('says so when no article was supplied, instead of an empty list', () => {
    render(<AnswerSourcesPanel data={data([])} />)
    expect(screen.getByText('No knowledge-base articles were supplied for this draft.')).toBeTruthy()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('notes a failed draft, while still listing what was supplied', () => {
    render(<AnswerSourcesPanel data={data([source({ rank: 1, status: 'current' })], { outcome: 'failed' })} />)
    expect(screen.getByText(/The draft failed/)).toBeTruthy()
    expect(items()).toHaveLength(1)
    expect(document.body.textContent).toContain('Generation failed')
  })

  it('says when identical copies of an article were also supplied, and links the article once', () => {
    render(<AnswerSourcesPanel data={data([source({ rank: 1, status: 'current', article_id: 11, copies: 2 })])} />)
    expect(items()).toHaveLength(1)
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.getByText('2 identical copies of this article were also supplied.')).toBeTruthy()
  })

  it('uses the singular for one extra copy, and says nothing when there were none', () => {
    const { unmount } = render(<AnswerSourcesPanel data={data([source({ rank: 1, status: 'current', copies: 1 })])} />)
    expect(screen.getByText('An identical copy of this article was also supplied.')).toBeTruthy()
    unmount()
    render(<AnswerSourcesPanel data={data([source({ rank: 1, status: 'current', copies: 0 })])} />)
    expect(screen.queryByText(/identical cop/)).toBeNull()
  })

  it('notes copies of a deleted article without linking anything', () => {
    render(<AnswerSourcesPanel data={data([source({ rank: 1, status: 'deleted', article_id: null, title: null, copies: 3 })])} />)
    expect(screen.getByText('3 identical copies of this article were also supplied.')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('shows the time the answer was generated', () => {
    render(<AnswerSourcesPanel data={data([])} />)
    expect(document.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-25T10:00:00.000Z')
  })

  it('shows only the article title, nothing from the conversation', () => {
    render(<AnswerSourcesPanel data={data([source({ rank: 1, status: 'current', title: 'Reset a password' })])} />)
    expect(Object.keys(data([source({ rank: 1, status: 'current' })]).sources[0]).sort()).toEqual(['article_id', 'copies', 'rank', 'status', 'title'])
  })
})
