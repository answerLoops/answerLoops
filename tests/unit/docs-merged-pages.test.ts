import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Three self-hosting pages were folded into pages that already owned the same
// topic (AI model settings, the Slack guide, the Telegram guide). These checks
// keep the merge from silently regressing: the old URLs must keep redirecting,
// nothing in the docs may still link to them, and the sidebar must not list them.

const ROOT = process.cwd()
const DOCS = path.join(ROOT, 'content/docs')

const MERGED = {
  'self-hosting/ai-providers': 'product/ai-config',
  'self-hosting/slack-app': 'integrations/slack',
  'self-hosting/telegram-bot': 'integrations/telegram',
} as const

function mdxFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return mdxFiles(full)
    return entry.name.endsWith('.mdx') ? [full] : []
  })
}

describe('merged docs pages', () => {
  it.each(Object.entries(MERGED))('%s is gone and %s exists', (from, to) => {
    expect(fs.existsSync(path.join(DOCS, `${from}.mdx`))).toBe(false)
    expect(fs.existsSync(path.join(DOCS, `${to}.mdx`))).toBe(true)
  })

  it('no docs page links to a removed page', () => {
    const offenders: string[] = []
    for (const file of mdxFiles(DOCS)) {
      const text = fs.readFileSync(file, 'utf-8')
      for (const from of Object.keys(MERGED)) {
        if (text.includes(`/docs/${from}`)) offenders.push(`${path.relative(ROOT, file)} -> ${from}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('the self-hosting sidebar does not list removed pages', () => {
    const meta = JSON.parse(fs.readFileSync(path.join(DOCS, 'self-hosting/meta.json'), 'utf-8'))
    for (const from of Object.keys(MERGED)) {
      expect(meta.pages).not.toContain(path.basename(from))
    }
  })

  it('next.config.ts redirects each removed page permanently', () => {
    const config = fs.readFileSync(path.join(ROOT, 'next.config.ts'), 'utf-8')
    for (const [from, to] of Object.entries(MERGED)) {
      expect(config).toContain(`'${from}': '${to}'`)
    }
    expect(config).toMatch(/Object\.entries\(MERGED_DOC_PAGES\)[\s\S]{0,200}permanent: true/)
  })

  it('anchors the redirected-to pages now expose exist', () => {
    const read = (p: string) => fs.readFileSync(path.join(DOCS, p), 'utf-8')
    expect(read('product/ai-config.mdx')).toContain('## Self-hosted installs')
    expect(read('integrations/slack.mdx')).toContain('## Self-hosting: create the Slack app')
    expect(read('integrations/telegram.mdx')).toContain('## Self-hosting: make the app reachable')
  })
})
