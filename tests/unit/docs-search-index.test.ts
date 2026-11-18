import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildDocsSearchIndex, plainSearchText } from '@/lib/docs/search-index'

/**
 * Docs search results are shown to people as the text stored in the index.
 * fumadocs keeps JSX components and tables as source markup in that text, so a
 * plain-English search used to return `<Card icon="Ticket" title="Tickets"
 * href="/docs/product/tickets">…</Card>` and `| Variable | Required |` rows.
 */

describe('plainSearchText: components', () => {
  it('turns a Card into its title and description, dropping the props', () => {
    const raw =
      '<Card icon="Ticket" title="Tickets" href="/docs/product/tickets">Review drafts and work email tickets.</Card>'
    expect(plainSearchText(raw)).toBe('Tickets: Review drafts and work email tickets.')
  })

  it('keeps only the words of a component with no title', () => {
    expect(plainSearchText('<Callout type="info">Self-hosted installs are not metered.</Callout>')).toBe(
      'Self-hosted installs are not metered.',
    )
  })

  it('keeps a title when the component wraps nothing', () => {
    expect(plainSearchText('<Card icon="Mail" title="Email" href="/docs/integrations/email" />')).toBe('Email')
  })

  it('drops a component that has neither title nor content', () => {
    expect(plainSearchText('<Screenshot shot="billing" />')).toBe('')
  })

  it('unwraps nested components', () => {
    const raw = '<Callout type="info"><Card title="Inner">Body text</Card></Callout>'
    expect(plainSearchText(raw)).toBe('Inner: Body text')
  })

  it('decodes the entities fumadocs adds to attribute values', () => {
    expect(plainSearchText('<Card title="Q&amp;A &quot;guide&quot;">Read it.</Card>')).toBe('Q&A "guide": Read it.')
  })

  it('leaves ordinary prose, lowercase tags and comparisons alone', () => {
    const prose = 'Use a < b when scores are below the threshold, or <your-domain> for the host.'
    expect(plainSearchText(prose)).toBe(prose)
  })
})

describe('plainSearchText: tables', () => {
  it('reads a header-and-row record as "Header: value" pairs', () => {
    const raw = '| Plan | Price |\n| --- | --- |\n| Standard | $49 |'
    expect(plainSearchText(raw)).toBe('Plan: Standard; Price: $49')
  })

  it('drops a separator-only record', () => {
    expect(plainSearchText('| --- | --- |')).toBe('')
  })

  it('keeps an escaped pipe inside a cell', () => {
    const raw = '| Option | Meaning |\n| --- | --- |\n| `a\\|b` | either one |'
    expect(plainSearchText(raw)).toBe('Option: `a|b`; Meaning: either one')
  })

  it('joins a row that has no header', () => {
    expect(plainSearchText('| Standard | $49 |')).toBe('Standard; $49')
  })

  it('does not treat prose that merely contains a pipe as a table', () => {
    expect(plainSearchText('Run a | b to pipe output.')).toBe('Run a | b to pipe output.')
  })
})

describe('plainSearchText: records taken from the real docs', () => {
  it('reads the agent API scope table row by row', () => {
    const raw =
      '| Scope     | Grants                    | Operations                                     |\n| --------- | ------------------------- | ---------------------------------------------- |\n| `kb:read` | Search the knowledge base | `GET /api/v1/agent/kb/search`, MCP `search_kb` |'
    expect(plainSearchText(raw)).toBe(
      'Scope: `kb:read`; Grants: Search the knowledge base; Operations: `GET /api/v1/agent/kb/search`, MCP `search_kb`',
    )
  })

  it('leaves an angle-bracket placeholder inside code untouched', () => {
    const raw =
      '| Variable | What it does |\n| --- | --- |\n| `GMAIL_REDIRECT_URI` | Overrides the derived callback `<AUTH_URL or NEXTAUTH_URL>/api/email/gmail/callback` |'
    expect(plainSearchText(raw)).toBe(
      'Variable: `GMAIL_REDIRECT_URI`; What it does: Overrides the derived callback `<AUTH_URL or NEXTAUTH_URL>/api/email/gmail/callback`',
    )
  })

  it('reads a long Card the way the page shows it', () => {
    const raw =
      '<Card icon="Mail" title="Email integration guide" href="/docs/integrations/email">Sending domain, allowed senders, escalation and Automatic Deflections.</Card>'
    expect(plainSearchText(raw)).toBe(
      'Email integration guide: Sending domain, allowed senders, escalation and Automatic Deflections.',
    )
  })
})

describe('buildDocsSearchIndex', () => {
  const structured = {
    headings: [{ id: 'where-to-go-next', content: 'Where to go next' }],
    contents: [
      {
        heading: 'where-to-go-next',
        content: '<Card icon="Ticket" title="Tickets" href="/docs/product/tickets">Review drafts.</Card>',
      },
      { heading: 'where-to-go-next', content: '| --- | --- |' },
      { heading: undefined, content: 'Plain paragraph.' },
    ],
  }
  const page = (data: Record<string, unknown>) =>
    ({ url: '/docs/product/dashboard', data: { title: 'Dashboard', description: 'Home screen', ...data } }) as never

  it('cleans every record, drops the ones that become empty and keeps headings', async () => {
    const index = await buildDocsSearchIndex(page({ structuredData: structured }))
    expect(index.structuredData.contents.map((c) => c.content)).toEqual(['Tickets: Review drafts.', 'Plain paragraph.'])
    expect(index.structuredData.contents[0].heading).toBe('where-to-go-next')
    expect(index.structuredData.headings).toEqual(structured.headings)
  })

  it('identifies the page the way the default index does', async () => {
    const index = await buildDocsSearchIndex(page({ structuredData: structured }))
    expect(index).toMatchObject({
      url: '/docs/product/dashboard',
      id: '/docs/product/dashboard',
      title: 'Dashboard',
      description: 'Home screen',
    })
  })

  it('reads structured data from a function or a lazy loader as well', async () => {
    const fromFn = await buildDocsSearchIndex(page({ structuredData: async () => structured }))
    const fromLoad = await buildDocsSearchIndex(page({ load: async () => ({ structuredData: structured }) }))
    expect(fromFn.structuredData.contents).toHaveLength(2)
    expect(fromLoad.structuredData.contents).toHaveLength(2)
  })

  it('fails loudly for a page with no structured data, rather than indexing nothing', async () => {
    await expect(buildDocsSearchIndex(page({}))).rejects.toThrow('/docs/product/dashboard')
  })
})

describe('the docs search route', () => {
  it('builds its index through buildDocsSearchIndex, so results are plain text', () => {
    const route = fs.readFileSync(path.join(process.cwd(), 'app/docs/api/search/route.ts'), 'utf-8')
    expect(route).toContain('buildDocsSearchIndex')
    expect(route).toMatch(/createFromSource\(docsSource,\s*{\s*buildIndex: buildDocsSearchIndex/)
  })
})
