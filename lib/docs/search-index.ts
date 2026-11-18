import type { StructuredData } from 'fumadocs-core/mdx-plugins'
import type { docsSource } from '@/lib/docs/source'

/**
 * Plain-text search records for the docs.
 *
 * fumadocs extracts each page into "structured data" for the search index, and
 * it deliberately keeps two things as source markup so its own dialog can draw
 * them: JSX components such as `<Card icon="Ticket" title="Tickets"
 * href="/docs/product/tickets">…</Card>`, and tables as markdown rows
 * (`| Variable | Required |`). Our search box shows a record's text as it is
 * stored, so a reader searching in plain English saw component props and pipe
 * characters instead of an answer. This turns each record into the sentence a
 * person would read, before it is indexed.
 */

const ENTITIES: Record<string, string> = {
  '&quot;': '"',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&#39;': "'",
}

function decodeEntities(text: string): string {
  return text.replace(/&(?:quot|amp|lt|gt|#39);/g, (m) => ENTITIES[m] ?? m)
}

/** Reads `name="value"` pairs out of the attribute text of one tag. */
function readAttributes(attrs: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of attrs.matchAll(/([A-Za-z_][\w-]*)="([^"]*)"/g)) {
    out[m[1]] = decodeEntities(m[2])
  }
  return out
}

/**
 * Replaces JSX component tags with their readable text: the `title` prop (the
 * only prop that is words rather than configuration) followed by whatever the
 * component wraps. Every other prop (icon names, hrefs, tones) is dropped.
 * Handles nesting by repeating until no tag is left.
 */
function stripComponentTags(text: string): string {
  const pair = /<([A-Z][\w.]*)((?:\s+[^<>]*?)?)>([^<]*)<\/\1>/g
  const selfClosing = /<([A-Z][\w.]*)((?:\s+[^<>]*?)?)\s*\/>/g
  let current = text
  for (let pass = 0; pass < 10; pass++) {
    const next = current
      .replace(pair, (_m, _name, attrs: string, inner: string) => {
        const title = readAttributes(attrs).title
        const body = inner.trim()
        if (title && body) return `${title}: ${body}`
        return title || body
      })
      .replace(selfClosing, (_m, _name, attrs: string) => readAttributes(attrs).title ?? '')
    if (next === current) break
    current = next
  }
  return current
}

const SEPARATOR_ROW = /^\|[\s:|-]+\|?$/

function splitRow(line: string): string[] {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, '|').trim())
}

/**
 * A markdown table record becomes "Header: value; Header: value", so a row
 * reads as what it says about one thing instead of as a grid. fumadocs stores
 * a row together with its header row; a record with no header is joined plainly.
 */
function tableToText(text: string): string {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0 || !lines.every((l) => l.startsWith('|'))) return text
  const rows = lines.filter((l) => !SEPARATOR_ROW.test(l)).map(splitRow)
  if (rows.length === 0) return ''
  if (rows.length >= 2) {
    const [header, ...body] = rows
    return body
      .map((row) =>
        row
          .map((cell, i) => (header[i] && cell ? `${header[i]}: ${cell}` : cell))
          .filter(Boolean)
          .join('; '),
      )
      .join('\n')
  }
  return rows[0].filter(Boolean).join('; ')
}

/** The readable text of one structured-data record. */
export function plainSearchText(content: string): string {
  return stripComponentTags(tableToText(content)).replace(/[ \t]+/g, ' ').trim()
}

type DocsPage = ReturnType<typeof docsSource.getPages>[number]

async function structuredDataOf(page: DocsPage): Promise<StructuredData> {
  const data = page.data as unknown as {
    structuredData?: StructuredData | (() => Promise<StructuredData>)
    load?: () => Promise<{ structuredData: StructuredData }>
  }
  if (data.structuredData) {
    return typeof data.structuredData === 'function' ? await data.structuredData() : data.structuredData
  }
  if (typeof data.load === 'function') return (await data.load()).structuredData
  throw new Error(`No structured data for docs page ${page.url}`)
}

/**
 * The search index entry for one docs page, shaped like fumadocs' default one
 * (title, description, url and structured data) but with every record
 * rewritten as plain text and the ones that become empty dropped.
 */
export async function buildDocsSearchIndex(page: DocsPage) {
  const structuredData = await structuredDataOf(page)
  return {
    title: page.data.title ?? page.url,
    description: page.data.description,
    url: page.url,
    id: page.url,
    structuredData: {
      ...structuredData,
      contents: structuredData.contents
        .map((item) => ({ ...item, content: plainSearchText(item.content) }))
        .filter((item) => item.content.length > 0),
    },
  }
}
