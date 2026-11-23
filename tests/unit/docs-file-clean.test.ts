import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanDocsFile } from '@/lib/ingest/docs-file'

// A docs file from a repo becomes plain Markdown with a page title, so the
// knowledge base never stores frontmatter, imports or component markup, and
// section titles name the page instead of the file path.

/** Text outside fenced code blocks and inline code, for asserting markup is gone. */
function outsideFences(md: string): string {
  return md.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '').replace(/`[^`\n]*`/g, '')
}

describe('cleanDocsFile', () => {
  it('uses frontmatter title and strips frontmatter', () => {
    expect(
      cleanDocsFile('content/docs/product/knowledge-base.mdx', '---\ntitle: Knowledge Base\ndescription: x\nicon: BookText\n---\n\nBody')
    ).toEqual({ title: 'Knowledge Base', markdown: 'Body' })
  })

  it('reads a quoted frontmatter title', () => {
    expect(cleanDocsFile('a.md', '---\ntitle: "Cloud: quickstart"\n---\nHi').title).toBe('Cloud: quickstart')
    expect(cleanDocsFile('a.md', "---\ntitle: 'Self host'\n---\nHi").title).toBe('Self host')
  })

  it('falls back to first h1 then file name', () => {
    expect(cleanDocsFile('docs/setup.md', '# Setup\n\ntext').title).toBe('Setup')
    expect(cleanDocsFile('docs/getting-started.md', 'just text').title).toBe('getting-started')
  })

  it('removes import and export lines in mdx only', () => {
    const input = "import { X } from 'y'\nexport const meta = {\n a: 1\n}\n\nText"
    expect(cleanDocsFile('a.mdx', input).markdown).toBe('Text')
    expect(cleanDocsFile('a.md', input).markdown).toBe(input)
  })

  it('keeps component inner text with title as bold line', () => {
    expect(cleanDocsFile('a.mdx', '<Callout title="What you need">\n  A key.\n</Callout>').markdown).toBe('**What you need**\n\nA key.')
  })

  it('uses Tab value as heading line', () => {
    expect(cleanDocsFile('a.mdx', '<Tab value="GitHub repository">Steps</Tab>').markdown).toBe('**GitHub repository**\n\nSteps')
  })

  it('keeps inner text of dotted components', () => {
    expect(cleanDocsFile('a.mdx', '<Foo.Bar>inside</Foo.Bar>').markdown).toBe('inside')
  })

  it('drops self-closing components', () => {
    expect(cleanDocsFile('a.mdx', 'Before\n\n<IntegrationLogo name="slack" />\n\nAfter').markdown).toBe('Before\n\nAfter')
  })

  it('drops multi-line props containing > and nested braces', () => {
    const input = `First paragraph.\n\n<Hotspots shot="kb" notes={{ a: 'x > y', b: "q" }}\n/>\n\nSecond paragraph.`
    const out = cleanDocsFile('a.mdx', input).markdown
    expect(out).toBe('First paragraph.\n\nSecond paragraph.')
    expect(out).not.toContain('x > y')
  })

  it('keeps component tags inside fenced code', () => {
    const fence = '```mdx\n<Callout>hi</Callout>\n```'
    expect(cleanDocsFile('a.mdx', `Intro\n\n${fence}\n\nEnd`).markdown).toBe(`Intro\n\n${fence}\n\nEnd`)
    expect(cleanDocsFile('a.mdx', 'Use `<Card />` here').markdown).toBe('Use `<Card />` here')
    const tilde = '~~~\n{ a: 1 }\nimport x from "y"\n~~~'
    expect(cleanDocsFile('a.mdx', tilde).markdown).toBe(tilde)
  })

  it('removes brace expressions outside code', () => {
    expect(cleanDocsFile('a.mdx', "Hello{' '}world {/* note */}").markdown).toBe('Hello world')
  })

  it('leaves lowercase html tags alone', () => {
    expect(cleanDocsFile('a.mdx', 'a <br /> b <kbd>K</kbd>').markdown).toBe('a <br /> b <kbd>K</kbd>')
  })

  it('collapses runs of blank lines', () => {
    expect(cleanDocsFile('a.mdx', 'one\n\n<Note />\n\n\n\ntwo').markdown).toBe('one\n\ntwo')
  })

  it('txt is unchanged and titled by file name', () => {
    expect(cleanDocsFile('docs/faq.txt', '## Not a heading rule\nplain')).toEqual({ title: 'faq', markdown: '## Not a heading rule\nplain' })
  })

  it('keeps a multi-line attribute string as a one-line heading', () => {
    expect(cleanDocsFile('a.mdx', '<Callout title="Line one\n   line two">body</Callout>').markdown).toBe('**Line one line two**\n\nbody')
  })

  it('treats escaped braces and angle brackets as text', () => {
    expect(cleanDocsFile('a.mdx', 'Use \\{name\\} as a placeholder').markdown).toBe('Use {name} as a placeholder')
    expect(cleanDocsFile('a.mdx', 'Write \\<Foo> literally.').markdown).toBe('Write <Foo> literally.')
    expect(cleanDocsFile('a.mdx', 'Not \\`code\\` here <Note>n</Note>').markdown).toBe('Not \\`code\\` here n')
  })

  it('keeps inline components inside tables and list items on their line', () => {
    expect(cleanDocsFile('a.mdx', '| Plan | Badge |\n|---|---|\n| Pro | <Badge>New</Badge> |').markdown).toBe('| Plan | Badge |\n|---|---|\n| Pro | New |')
    expect(cleanDocsFile('a.mdx', '- Press <Kbd>Ctrl</Kbd> to copy').markdown).toBe('- Press Ctrl to copy')
  })

  it('ignores apostrophes in JSX text inside an expression', () => {
    const input = "{isPro && <span>You're on Pro</span>}\n\nImportant paragraph.\n\n{x}\n\nEnd"
    expect(cleanDocsFile('a.mdx', input).markdown).toBe('Important paragraph.\n\nEnd')
  })

  it('unwraps lowercase dotted components and fragments', () => {
    expect(cleanDocsFile('a.mdx', '<motion.div animate>hi</motion.div>').markdown).toBe('hi')
    expect(cleanDocsFile('a.mdx', '<>\n  Text\n</>').markdown).toBe('Text')
  })

  it('does not pair a stray backtick across paragraphs', () => {
    const input = 'Type the ` key to start.\n\n<Callout title="Heads up">Inner</Callout>\n\nUse `code` here.'
    expect(cleanDocsFile('a.mdx', input).markdown).toBe('Type the ` key to start.\n\n**Heads up**\n\nInner\n\nUse `code` here.')
  })

  it('dedents component content even when a comment line sits at column 0', () => {
    const input = '<Steps>\n{/* c */}\n    ## Install\n    Run it.\n    ## Configure\n    More.\n</Steps>'
    expect(cleanDocsFile('a.mdx', input).markdown).toBe('## Install\nRun it.\n## Configure\nMore.')
  })

  it('dedents nested steps so their headings split', () => {
    const input = '<Steps>\n  <Step>\n    ## Install\n    Run it.\n  </Step>\n  <Step>\n    ## Use\n    Go.\n  </Step>\n</Steps>'
    expect(cleanDocsFile('a.mdx', input).markdown).toBe('## Install\nRun it.\n\n## Use\nGo.')
  })

  it('keeps indented fences inside a component verbatim apart from the shared indent', () => {
    const input = '<Tab value="CLI">\n  Run:\n\n  ```bash\n  ## not a heading\n  <Foo />\n  ```\n</Tab>'
    expect(cleanDocsFile('a.mdx', input).markdown).toBe('**CLI**\n\nRun:\n\n```bash\n## not a heading\n<Foo />\n```')
  })

  it('strips a byte order mark before frontmatter', () => {
    expect(cleanDocsFile('a.md', '﻿---\ntitle: Real\n---\n\n# H\n\nbody')).toEqual({ title: 'Real', markdown: '# H\n\nbody' })
  })

  it('does not close a fence on a line with an info string', () => {
    expect(cleanDocsFile('a.mdx', '```\n```js\n<Foo />\n```\n\n<Bar>t</Bar>').markdown).toBe('```\n```js\n<Foo />\n```\n\nt')
  })

  it('reads title only from its own attribute', () => {
    expect(cleanDocsFile('a.mdx', '<Card description="see title=\'Leaked\'">x</Card>').markdown).toBe('x')
  })

  it('removes import and export only at the top level', () => {
    expect(cleanDocsFile('a.mdx', '<Callout>\nWe\nimport the file\n</Callout>').markdown).toBe('We\nimport the file')
  })

  it('falls back to the h1 for a YAML block-scalar title', () => {
    expect(cleanDocsFile('a.md', '---\ntitle: >-\n  Long\n---\n# Heading\n\nx').title).toBe('Heading')
  })

  it('leaves a bare angle bracket in prose alone', () => {
    expect(cleanDocsFile('a.mdx', 'Press <Enter to continue.').markdown).toBe('Press <Enter to continue.')
  })

  it('handles CRLF and uppercase extensions', () => {
    expect(cleanDocsFile('docs/A.MDX', '<Note>x</Note>\r\n\r\nnext\r\n')).toEqual({ title: 'A', markdown: 'x\n\nnext' })
  })

  it('stays fast and safe on large malformed files', () => {
    const MB = 1_048_576
    for (const unit of ['<Foo\n', '{ unbalanced\n', '{ a } {\n', '<Callout>\n', '<A><B>', '`x ', '<A b="', '{ "x\n', '{<B ', '<A b={']) {
      const input = unit.repeat(Math.ceil(MB / unit.length))
      const start = performance.now()
      expect(() => cleanDocsFile('big.mdx', input)).not.toThrow()
      expect(performance.now() - start).toBeLessThan(3000)
    }
  }, 30_000)

  it('stays fast on unclosed inline code runs of many lengths', () => {
    const input = Array.from({ length: 1500 }, (_, k) => 'x' + '`'.repeat(k + 1)).join(' ')
    const start = performance.now()
    cleanDocsFile('a.mdx', input.repeat(1))
    expect(performance.now() - start).toBeLessThan(1500)
  })

  it('real docs page has no markup left', () => {
    const path = 'content/docs/product/knowledge-base.mdx'
    const { title, markdown } = cleanDocsFile(path, readFileSync(join(process.cwd(), path), 'utf8'))
    expect(title).toBe('Knowledge Base')
    const prose = outsideFences(markdown)
    expect(prose).not.toMatch(/<[A-Z]/)
    expect(prose).not.toMatch(/^import /m)
    expect(prose).not.toContain('{{')
    expect(markdown).toContain('## Add content')
    expect(markdown).toContain('**GitHub repository**')
  })
})
