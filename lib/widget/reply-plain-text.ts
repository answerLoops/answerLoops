/**
 * The plain text a visitor copies from a widget reply: what they read in the
 * bubble, without the Markdown behind it. It is taken from the rendered bubble
 * (app/widget/[widgetToken]/chat-markdown.tsx), which only ever contains
 * paragraphs, lists, links, bold, italic, inline code and line breaks, so the
 * copy always matches what is on screen.
 *
 *  - Paragraphs are separated by a blank line.
 *  - Each bullet starts with "- " and each numbered item with its number, one
 *    per line; a nested list is indented two spaces per level.
 *  - A link is copied as its words followed by its address in brackets, or as
 *    the address alone when the words are the address.
 *  - Bold, italic and code keep their text and lose their markup.
 */
export function replyPlainText(root: Element): string {
  const blocks = blocksOf(root, 0)
  return blocks
    .join('\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** The top-level blocks inside `el`, each already turned into text. */
function blocksOf(el: Element, depth: number): string[] {
  const blocks: string[] = []
  let inline = ''
  const flush = () => {
    const text = tidyLines(inline)
    if (text) blocks.push(text)
    inline = ''
  }
  for (const node of Array.from(el.childNodes)) {
    if (isElement(node) && (node.tagName === 'UL' || node.tagName === 'OL')) {
      flush()
      blocks.push(listText(node, depth))
    } else if (isElement(node) && node.tagName === 'P') {
      flush()
      const text = tidyLines(inlineText(node))
      if (text) blocks.push(text)
    } else {
      inline += inlineText(node)
    }
  }
  flush()
  return blocks
}

function listText(list: Element, depth: number): string {
  const ordered = list.tagName === 'OL'
  const start = ordered ? Number.parseInt(list.getAttribute('start') ?? '1', 10) || 1 : 1
  const indent = '  '.repeat(depth)
  const lines: string[] = []
  let n = start
  for (const item of Array.from(list.children)) {
    if (item.tagName !== 'LI') continue
    const marker = ordered ? `${n++}. ` : '- '
    // A list item holds inline text, paragraphs (a loose list) and nested lists.
    let own = ''
    const nested: string[] = []
    for (const node of Array.from(item.childNodes)) {
      if (isElement(node) && (node.tagName === 'UL' || node.tagName === 'OL')) {
        nested.push(listText(node, depth + 1))
      } else if (isElement(node) && node.tagName === 'P') {
        own += (own ? ' ' : '') + tidyLines(inlineText(node))
      } else {
        own += inlineText(node)
      }
    }
    lines.push(`${indent}${marker}${own.replace(/\s*\n\s*/g, ' ').trim()}`)
    lines.push(...nested)
  }
  return lines.join('\n')
}

/** Trims the text and the spaces around each line break. */
function tidyLines(text: string): string {
  return text.replace(/ *\n */g, '\n').trim()
}

function inlineText(node: Node): string {
  // A line break in the Markdown source shows as a space, so it copies as one.
  // Only a hard break (<br>) is a new line.
  if (node.nodeType === TEXT_NODE) return (node.textContent ?? '').replace(/[ \t]*\n[ \t]*/g, ' ')
  if (!isElement(node)) return ''
  if (node.tagName === 'BR') return '\n'
  if (node.tagName === 'A') {
    const words = childrenText(node).trim()
    const href = node.getAttribute('href') ?? ''
    if (!href) return words
    if (!words || words === href) return href
    return `${words} (${href})`
  }
  return childrenText(node)
}

function childrenText(el: Element): string {
  return Array.from(el.childNodes).map(inlineText).join('')
}

const TEXT_NODE = 3
const ELEMENT_NODE = 1

function isElement(node: Node): node is Element {
  return node.nodeType === ELEMENT_NODE
}

/**
 * Puts `text` on the clipboard. Uses the Clipboard API when the browser allows
 * it, and otherwise a hidden text area with the older copy command. Resolves
 * to false only when neither works, so the caller can say so.
 */
export async function copyPlainText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Blocked or unavailable: fall through to the older method.
  }
  return copyWithTextArea(text)
}

function copyWithTextArea(text: string): boolean {
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  // Off screen, so neither the page nor the scroll position moves.
  area.style.position = 'fixed'
  area.style.top = '0'
  area.style.left = '-9999px'
  area.style.opacity = '0'
  const active = document.activeElement as HTMLElement | null
  document.body.appendChild(area)
  try {
    area.select()
    return typeof document.execCommand === 'function' && document.execCommand('copy')
  } catch {
    return false
  } finally {
    area.remove()
    active?.focus?.({ preventScroll: true })
  }
}
