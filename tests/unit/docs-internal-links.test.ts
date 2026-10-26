import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Moving, merging or renaming a docs page leaves links and #anchors behind
// that point at nothing, and a broken link in a docs page is easy to miss in
// review. This reads every page under content/docs, collects its headings and
// explicit ids, and checks that each internal /docs link (and its #anchor)
// lands somewhere real.

const DOCS = path.join(process.cwd(), 'content/docs')

function mdxFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return mdxFiles(full)
    return entry.name.endsWith('.mdx') ? [full] : []
  })
}

function slugFor(file: string): string {
  const rel = path.relative(DOCS, file).replace(/\\/g, '/').replace(/\.mdx$/, '')
  return rel.endsWith('/index') ? rel.slice(0, -'/index'.length) : rel
}

function headingSlug(heading: string): string {
  return heading
    .replace(/[`*_]|<[^>]+>/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s/g, '-')
}

function anchorsOf(text: string): Set<string> {
  const anchors = new Set<string>()
  for (const m of text.matchAll(/^#{1,6}\s+(.+)$/gm)) anchors.add(headingSlug(m[1]))
  for (const m of text.matchAll(/id="([^"]+)"/g)) anchors.add(m[1])
  return anchors
}

const pages = new Map<string, string>()
for (const file of mdxFiles(DOCS)) pages.set(slugFor(file), fs.readFileSync(file, 'utf-8'))
const anchors = new Map([...pages].map(([slug, text]) => [slug, anchorsOf(text)]))

// The generated API reference pages are produced from the OpenAPI spec, and
// their routes are served separately from the page files.
const isGeneratedApiRoute = (slug: string) => slug === 'reference/api' || slug.startsWith('reference/api/')

type Link = { from: string; target: string; slug: string; anchor: string | null }

const links: Link[] = []
for (const [from, text] of pages) {
  for (const m of text.matchAll(/(?:href="|\]\()(\/docs[^")#\s]*)(#[^")\s]*)?/g)) {
    links.push({
      from,
      target: m[1] + (m[2] ?? ''),
      slug: m[1].slice('/docs'.length).replace(/^\/|\/$/g, ''),
      anchor: m[2] ? m[2].slice(1) : null,
    })
  }
}

describe('internal docs links', () => {
  it('finds links to check', () => {
    expect(links.length).toBeGreaterThan(50)
  })

  it('every link points at a page that exists', () => {
    const broken = links
      .filter((l) => l.slug !== '' && !pages.has(l.slug) && !isGeneratedApiRoute(l.slug))
      .map((l) => `${l.from} -> ${l.target}`)
    expect([...new Set(broken)]).toEqual([])
  })

  it('every #anchor matches a heading on the page it targets', () => {
    const broken = links
      .filter((l) => l.anchor && pages.has(l.slug) && !anchors.get(l.slug)!.has(l.anchor))
      .map((l) => `${l.from} -> ${l.target}`)
    expect([...new Set(broken)]).toEqual([])
  })
})
