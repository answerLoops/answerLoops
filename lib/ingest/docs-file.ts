/**
 * Turns one docs file from a repository into plain Markdown and a page title,
 * ready for chunkMarkdown (lib/ingest/url.ts).
 *
 * - `.txt` is used as it is, titled by its file name.
 * - `.md` and `.mdx` lose their frontmatter; the page title is the
 *   frontmatter `title`, else the first `# ` heading, else the file name.
 * - `.mdx` also loses top-level `import`/`export` statements, `{…}`
 *   expressions and component tags (`<Callout>`, `<Foo.Bar>`, `<motion.div>`,
 *   fragments). A component's inner text is kept. A component that starts its
 *   own line becomes a block led by its `title` (or a `<Tab>`'s `value`) as a
 *   bold line; one inside a line of text (a table cell, a list item) stays
 *   inline. Self-closing components are removed.
 *
 * Fenced code blocks and inline code are never changed, so a page that
 * documents component usage keeps its examples. Lowercase HTML is left alone,
 * and escaped characters (`\{`, `\<`) are kept as text.
 *
 * MDX is handled in three linear passes (tokens, a tree of components, then
 * text), and every scan that looks ahead gives up at a blank line or a size
 * limit, so a malformed file can't stall a sync.
 */

export function cleanDocsFile(path: string, raw: string): { title: string; markdown: string } {
  const fileName = path.split('/').pop() ?? path
  const dot = fileName.lastIndexOf('.')
  const ext = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : ''
  const baseName = dot > 0 ? fileName.slice(0, dot) : fileName
  const unmarked = raw.replace(/^﻿/, '')

  if (ext === 'txt') return { title: baseName, markdown: unmarked }

  const text = unmarked.replace(/\r\n?/g, '\n')
  const { title: fmTitle, body } = splitFrontmatter(text)
  const markdown = collapseBlankLines(ext === 'mdx' ? renderMdx(body) : body).trim()
  const title = fmTitle || firstH1(markdown) || baseName
  return { title, markdown }
}

// ── Frontmatter, title and blank lines ─────────────────────────────────────

function splitFrontmatter(text: string): { title: string; body: string } {
  if (!/^---[ \t]*\n/.test(text)) return { title: '', body: text }
  const close = /\n(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(text.slice(3))
  if (!close) return { title: '', body: text }
  const fm = text.slice(3, 3 + close.index)
  const body = text.slice(3 + close.index + close[0].length)
  const m = /^title:[ \t]*(.+?)[ \t]*$/m.exec(fm)
  let title = m ? m[1] : ''
  // A block scalar (`title: >-` with the text on the following lines) is
  // rare enough that the first heading is a better title than parsing YAML.
  if (/^[|>][+-]?\d*$/.test(title)) title = ''
  const q = /^(["'])([\s\S]*)\1$/.exec(title)
  if (q) title = q[2]
  return { title: title.trim(), body }
}

interface Fence {
  char: string
  length: number
}

/** The fence a line opens, if it opens one. A backtick fence's info string can't contain a backtick. */
function openingFence(line: string): Fence | null {
  const m = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(line)
  if (!m) return null
  if (m[1][0] === '`' && m[2].includes('`')) return null
  return { char: m[1][0], length: m[1].length }
}

/** Whether a line closes `fence`: the same character, at least as long, and nothing after it. */
function closesFence(line: string, fence: Fence): boolean {
  const m = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(line)
  return !!m && m[1][0] === fence.char && m[1].length >= fence.length
}

/** Calls `visit` for every line outside fenced code. */
function eachProseLine(md: string, visit: (line: string) => void, keep?: (line: string) => void): void {
  let fence: Fence | null = null
  for (const line of md.split('\n')) {
    if (fence) {
      keep?.(line)
      if (closesFence(line, fence)) fence = null
      continue
    }
    const opened = openingFence(line)
    if (opened) {
      fence = opened
      keep?.(line)
      continue
    }
    visit(line)
  }
}

/** The first `# ` heading outside fenced code. */
function firstH1(md: string): string {
  let found = ''
  eachProseLine(md, (line) => {
    if (found) return
    const h = /^# +(.+?)[ \t]*#*[ \t]*$/.exec(line)
    if (h) found = h[1].trim()
  })
  return found
}

/** Removes blank lines that follow another blank line, outside fenced code. */
function collapseBlankLines(md: string): string {
  const out: string[] = []
  eachProseLine(
    md,
    (line) => {
      const blank = line.trim() === ''
      if (blank && (out.length === 0 || out[out.length - 1] === '')) return
      out.push(blank ? '' : line.replace(/[ \t]+$/, ''))
    },
    (line) => out.push(line)
  )
  return out.join('\n')
}

// ── MDX: tokens ────────────────────────────────────────────────────────────

/** How far any single look-ahead scan may run before giving up. */
const SCAN_LIMIT = 50_000
/** Deeper component nesting than this is kept as text without its tags. */
const MAX_DEPTH = 64

/**
 * Characters all look-ahead scans in one file may read together. A normal file
 * reads each expression or tag once; this only binds on malformed input that
 * would otherwise be rescanned from many starting points.
 */
interface ScanBudget {
  left: number
  /** How many look-ahead scans are nested inside each other right now. */
  depth?: number
}

type Token =
  | { kind: 'text'; text: string }
  | { kind: 'open'; name: string; attrs: Record<string, string>; selfClosing: boolean; inline: boolean }
  | { kind: 'close'; name: string }

const TAG_NAME = '[A-Z][\\w$]*(?:\\.[\\w$]+)*|[A-Za-z_$][\\w$]*(?:\\.[\\w$]+)+'
const OPEN_TAG = new RegExp(`^<(${TAG_NAME})(?=[\\s/>])`)
const CLOSE_TAG = new RegExp(`^</(${TAG_NAME})?\\s*>`)

function tokenize(src: string): Token[] {
  const budget: ScanBudget = { left: 4 * src.length + 100_000 }
  const tokens: Token[] = []
  let text = ''
  let depth = 0
  const flush = () => {
    if (text) tokens.push({ kind: 'text', text })
    text = ''
  }

  // An expression can only close if a `}` comes before the paragraph ends.
  // Both positions are found once and reused while the scan moves forward,
  // so a file full of unclosed braces stays linear.
  let nextClose = -2
  let paragraphEnd = -2
  const canClose = (from: number): boolean => {
    if (nextClose !== -1 && nextClose < from) nextClose = src.indexOf('}', from)
    if (paragraphEnd !== -1 && paragraphEnd < from) paragraphEnd = endOfParagraph(src, from)
    return nextClose !== -1 && (paragraphEnd === -1 || nextClose < paragraphEnd)
  }

  let i = 0
  while (i < src.length) {
    if (i === 0 || src[i - 1] === '\n') {
      const lineEnd = endOfLine(src, i)
      const line = src.slice(i, lineEnd)
      const fence = openingFence(line)
      if (fence) {
        const end = endOfFence(src, lineEnd, fence)
        text += src.slice(i, end)
        i = end
        continue
      }
      // MDX treats import/export as code only at the top level.
      if (depth === 0 && /^(import|export)\s/.test(line)) {
        i = endOfStatement(src, i)
        continue
      }
    }

    const ch = src[i]
    const next = src[i + 1] ?? ''
    if (ch === '\\' && /[{}<>]/.test(next)) {
      text += next
      i += 2
      continue
    }
    if (ch === '\\' && /[!-/:-@[-`~]/.test(next)) {
      // A Markdown escape: keep it, and never read its character as syntax.
      text += ch + next
      i += 2
      continue
    }
    if (ch === '`') {
      const end = endOfInlineCode(src, i)
      text += src.slice(i, end)
      i = end
      continue
    }
    if (ch === '{') {
      const end = canClose(i) ? matchBrace(src, i, budget) : -1
      if (end !== -1) {
        // {' '} is how MDX writes a space between inline elements; keep it.
        if (/^\s*(['"`])\s*\1\s*$/.test(src.slice(i + 1, end))) text += ' '
        i = end + 1
        continue
      }
    }
    if (ch === '<') {
      const tag = readTag(src, i, budget)
      if (tag) {
        flush()
        if (tag.token.kind === 'open') {
          tag.token.inline = startsMidLine(src, i)
          if (!tag.token.selfClosing) depth++
        } else {
          depth = Math.max(0, depth - 1)
        }
        tokens.push(tag.token)
        i = tag.end
        continue
      }
    }
    text += ch
    i++
  }
  flush()
  return tokens
}

/** Whether anything other than spaces or tabs comes before `at` on its line. */
function startsMidLine(src: string, at: number): boolean {
  let k = at - 1
  while (k >= 0 && (src[k] === ' ' || src[k] === '\t')) k--
  return k >= 0 && src[k] !== '\n'
}

/** Index of the newline that starts the next blank line after `from`, or -1. */
function endOfParagraph(src: string, from: number): number {
  const m = /\n[ \t]*(?:\n|$)/g
  m.lastIndex = from
  const hit = m.exec(src)
  return hit ? hit.index : -1
}

function endOfLine(src: string, from: number): number {
  const nl = src.indexOf('\n', from)
  return nl === -1 ? src.length : nl
}

/** Whether the line starting after the newline at `nl` is blank. */
function blankLineAfter(src: string, nl: number): boolean {
  let j = nl + 1
  while (j < src.length && (src[j] === ' ' || src[j] === '\t')) j++
  return j >= src.length || src[j] === '\n'
}

/** Index just past the fence's closing line (or the end of the text). */
function endOfFence(src: string, openLineEnd: number, fence: Fence): number {
  let i = openLineEnd
  while (i < src.length) {
    const start = i + 1
    const end = endOfLine(src, start)
    if (closesFence(src.slice(start, end), fence)) return end
    i = end
  }
  return src.length
}

/** Index just past an inline code span, or past the opening backticks when it never closes in this paragraph. */
function endOfInlineCode(src: string, from: number): number {
  let run = 0
  while (src[from + run] === '`') run++
  let j = from + run
  const limit = Math.min(src.length, from + SCAN_LIMIT)
  while (j < limit) {
    if (src[j] === '\n' && blankLineAfter(src, j)) break
    if (src[j] === '`') {
      let k = 0
      while (src[j + k] === '`') k++
      if (k === run) return j + k
      j += k
      continue
    }
    j++
  }
  return from + run
}

/** Index just past an import/export statement, which may span lines while brackets are open. */
function endOfStatement(src: string, from: number): number {
  let depth = 0
  let i = from
  while (i < src.length) {
    const ch = src[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipJsString(src, i)
      continue
    }
    if (ch === '{' || ch === '(' || ch === '[') depth++
    else if (ch === '}' || ch === ')' || ch === ']') depth--
    else if (ch === '\n' && depth <= 0) return i + 1
    i++
  }
  return src.length
}

/** Index after a JavaScript string; single- and double-quoted strings end at a newline. */
function skipJsString(src: string, from: number): number {
  const q = src[from]
  let i = from + 1
  while (i < src.length) {
    if (src[i] === '\\') {
      i += 2
      continue
    }
    if (src[i] === q) return i + 1
    if (src[i] === '\n' && q !== '`') return i
    i++
  }
  return src.length
}

/** Index after a JSX attribute string, which may span lines. */
function skipAttrString(src: string, from: number, limit: number): number {
  const end = src.indexOf(src[from], from + 1)
  return end === -1 || end >= limit ? -1 : end + 1
}

/**
 * Index of the `}` matching the `{` at `from`, or -1. Strings and comments in
 * the code are skipped; text inside JSX elements is read as text, so an
 * apostrophe there is not a string. Gives up at a blank line outside strings.
 */
function matchBrace(src: string, from: number, budget: ScanBudget): number {
  // Expressions inside tags inside expressions nest by recursion; real MDX is
  // never this deep, so deeper input is treated as text instead of risking the stack.
  if (budget.left <= 0 || (budget.depth ?? 0) >= MAX_DEPTH) return -1
  const limit = Math.min(src.length, from + SCAN_LIMIT, from + budget.left)
  budget.depth = (budget.depth ?? 0) + 1
  let result: number
  try {
    result = matchBraceWithin(src, from, limit, budget)
  } finally {
    budget.depth -= 1
  }
  budget.left -= (result === -1 ? limit : result) - from + 1
  return result
}

function matchBraceWithin(src: string, from: number, limit: number, budget: ScanBudget): number {
  // One entry per open brace: how many JSX elements are open at that level.
  const levels: number[] = []
  let i = from
  while (i < limit) {
    const ch = src[i]
    if (ch === '\n' && blankLineAfter(src, i)) return -1
    if (ch === '{') {
      levels.push(0)
      i++
      continue
    }
    if (ch === '}') {
      levels.pop()
      if (levels.length === 0) return i
      i++
      continue
    }
    const inJsxText = (levels[levels.length - 1] ?? 0) > 0
    if (ch === '<' && /[A-Za-z>/]/.test(src[i + 1] ?? '')) {
      const tag = scanJsxTag(src, i, limit, budget)
      if (!tag) return -1
      levels[levels.length - 1] += tag.change
      i = tag.end
      continue
    }
    if (inJsxText) {
      i++
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipJsString(src, i)
      continue
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      if (end === -1 || end >= limit) return -1
      i = end + 2
      continue
    }
    if (ch === '/' && src[i + 1] === '/') {
      i = endOfLine(src, i)
      continue
    }
    i++
  }
  return -1
}

/** A JSX tag inside an expression: where it ends, and +1 / -1 / 0 for open / close / self-closing. */
function scanJsxTag(src: string, from: number, limit: number, budget: ScanBudget): { end: number; change: number } | null {
  const closing = src[from + 1] === '/'
  let i = from + 1
  while (i < limit) {
    const ch = src[i]
    if (ch === '\n' && blankLineAfter(src, i)) return null
    if (ch === '"' || ch === "'") {
      const end = skipAttrString(src, i, limit)
      if (end === -1) return null
      i = end
      continue
    }
    if (ch === '{') {
      const end = matchBrace(src, i, budget)
      if (end === -1) return null
      i = end + 1
      continue
    }
    if (ch === '>') {
      const selfClosing = src[i - 1] === '/'
      return { end: i + 1, change: closing ? -1 : selfClosing ? 0 : 1 }
    }
    i++
  }
  return null
}

/** A component tag at `from` (opening, closing or fragment), or null when it isn't one. */
function readTag(src: string, from: number, budget: ScanBudget): { token: Token; end: number } | null {
  const head = src.slice(from, from + 200)
  const close = CLOSE_TAG.exec(head)
  if (close) return { token: { kind: 'close', name: close[1] ?? '' }, end: from + close[0].length }
  if (head.startsWith('<>')) {
    return { token: { kind: 'open', name: '', attrs: {}, selfClosing: false, inline: false }, end: from + 2 }
  }
  const open = OPEN_TAG.exec(head)
  if (!open) return null

  if (budget.left <= 0) return null
  const limit = Math.min(src.length, from + SCAN_LIMIT, from + budget.left)
  const attrsStart = from + open[0].length
  let i = attrsStart
  const fail = () => {
    budget.left -= i - from
    return null
  }
  while (i < limit) {
    const ch = src[i]
    if (ch === '\n' && blankLineAfter(src, i)) return fail()
    if (ch === '"' || ch === "'") {
      const end = skipAttrString(src, i, limit)
      if (end === -1) return fail()
      i = end
      continue
    }
    if (ch === '{') {
      const end = matchBrace(src, i, budget)
      if (end === -1) return fail()
      i = end + 1
      continue
    }
    // Another tag starting means this one was never finished (`Press <Enter to …`).
    if (ch === '<') return fail()
    if (ch === '>') {
      budget.left -= i - from
      const rawAttrs = src.slice(attrsStart, i)
      const selfClosing = /\/\s*$/.test(rawAttrs)
      return {
        token: { kind: 'open', name: open[1], attrs: parseAttrs(rawAttrs), selfClosing, inline: false },
        end: i + 1,
      }
    }
    i++
  }
  return fail()
}

/** The string-valued attributes of a tag, whitespace collapsed. Expression values are skipped. */
function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  let i = 0
  while (i < raw.length) {
    const name = /^[A-Za-z_:][\w:.-]*/.exec(raw.slice(i))
    if (!name) {
      i++
      continue
    }
    i += name[0].length
    while (/\s/.test(raw[i] ?? '')) i++
    if (raw[i] !== '=') continue
    i++
    while (/\s/.test(raw[i] ?? '')) i++
    const q = raw[i]
    if (q === '"' || q === "'") {
      const end = raw.indexOf(q, i + 1)
      if (end === -1) break
      attrs[name[0]] = raw.slice(i + 1, end).replace(/\s+/g, ' ').trim()
      i = end + 1
    } else if (q === '{') {
      const end = matchBrace(raw, i, { left: raw.length + 1 })
      i = end === -1 ? raw.length : end + 1
    }
  }
  return attrs
}

// ── MDX: tree and text ─────────────────────────────────────────────────────

interface ComponentNode {
  name: string
  attrs: Record<string, string>
  inline: boolean
  children: Array<string | ComponentNode>
}

function buildTree(tokens: Token[]): ComponentNode {
  const root: ComponentNode = { name: '#root', attrs: {}, inline: false, children: [] }
  const stack: ComponentNode[] = [root]
  // An unclosed component keeps its content but loses its tags.
  const unwrap = (node: ComponentNode, parent: ComponentNode) => {
    const at = parent.children.lastIndexOf(node)
    parent.children.splice(at, 1, ...node.children)
  }
  for (const token of tokens) {
    const top = stack[stack.length - 1]
    if (token.kind === 'text') {
      top.children.push(token.text)
    } else if (token.kind === 'open') {
      if (token.selfClosing || stack.length > MAX_DEPTH) continue
      const node: ComponentNode = { name: token.name, attrs: token.attrs, inline: token.inline, children: [] }
      top.children.push(node)
      stack.push(node)
    } else {
      let match = -1
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === token.name) {
          match = k
          break
        }
      }
      if (match === -1) continue
      while (stack.length - 1 > match) {
        const node = stack.pop()!
        unwrap(node, stack[stack.length - 1])
      }
      stack.pop()
    }
  }
  while (stack.length > 1) {
    const node = stack.pop()!
    unwrap(node, stack[stack.length - 1])
  }
  return root
}

function renderMdx(src: string): string {
  return renderChildren(buildTree(tokenize(src)).children, false)
}

/**
 * Joins a component's content. Text inside a component is usually indented
 * under its tag; that shared indent is removed so headings and lists read as
 * Markdown again. Only the component's own text counts towards the shared
 * indent, not the output of components nested in it.
 */
function renderChildren(children: Array<string | ComponentNode>, dedent: boolean): string {
  let indent = Infinity
  if (dedent) {
    for (const child of children) {
      if (typeof child !== 'string') continue
      for (const m of child.matchAll(/\n([ \t]*)(?=[^\s])/g)) indent = Math.min(indent, m[1].length)
    }
  }
  const cut = Number.isFinite(indent) && indent > 0 ? new RegExp(`\\n[ \\t]{0,${indent}}`, 'g') : null
  return children.map((child) => (typeof child === 'string' ? (cut ? child.replace(cut, '\n') : child) : renderComponent(child))).join('')
}

function renderComponent(node: ComponentNode): string {
  const body = renderChildren(node.children, true).trim()
  const heading = node.attrs.title || (node.name === 'Tab' ? node.attrs.value ?? '' : '')
  if (node.inline) return (heading ? `**${heading}** ` : '') + body.replace(/\s*\n\s*/g, ' ')
  return '\n\n' + (heading ? `**${heading}**` + (body ? '\n\n' : '') : '') + body + '\n\n'
}
