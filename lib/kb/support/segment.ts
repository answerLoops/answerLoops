import { SUPPORT_LIMITS } from './limits'

/**
 * One addressable piece of text: a claim of an answer or a passage of an
 * article. `index` is its id (1-based, in reading order), and `start`/`end`
 * are offsets into `normalizeText(source)`, so `text` is always a substring of
 * the normalized source unless `clipped` is set (then it is a prefix of one).
 */
export interface Piece {
  index: number
  text: string
  start: number
  end: number
  /** The piece was longer than the limit and `text` is its first part. */
  clipped: boolean
}

export interface Segmentation {
  pieces: Piece[]
  /** More pieces (or more text) existed than the limits allow. */
  truncated: boolean
}

/** One line ending style and no NUL bytes, so offsets mean the same everywhere. */
export function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replaceAll('\u0000', '')
}

const HAS_CONTENT = /[\p{L}\p{N}]/u

// Terminators that end a sentence wherever they appear, with no space needed
// after them (full-width and half-width CJK forms).
const HARD_TERMINATORS = new Set(['。', '！', '？', '｡'])
// Terminators that end a sentence when followed by whitespace or the end.
const SOFT_TERMINATORS = new Set(['.', '!', '?', '…', '।', '॥', '؟', '۔', '።'])
// Closing marks that stay with the sentence they close.
const CLOSERS = new Set(['"', "'", ')', ']', '}', '»', '”', '’', '」', '』', '）', '】'])
// Words whose trailing period does not end a sentence.
const ABBREVIATIONS = new Set([
  'e.g', 'i.e', 'etc', 'vs', 'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'inc', 'ltd', 'co',
  'no', 'fig', 'approx', 'cf', 'al', 'ca', 'est', 'dept', 'min', 'max',
])

const isSpace = (ch: string | undefined) => ch !== undefined && /\s/u.test(ch)

/** The word (letters and inner dots) that ends just before `periodAt`, lower-cased. */
function wordBefore(text: string, periodAt: number): string {
  let i = periodAt
  while (i > 0 && /[\p{L}.]/u.test(text[i - 1])) i--
  return text.slice(i, periodAt).toLowerCase()
}

/**
 * Splits one block of text into sentence ranges. Rule-based, with no locale
 * data, so the result for a given text never changes between runtimes.
 */
function sentenceRanges(text: string, from: number, to: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  let start = from
  let i = from
  while (i < to) {
    const ch = text[i]
    const hard = HARD_TERMINATORS.has(ch)
    if (!hard && !SOFT_TERMINATORS.has(ch)) {
      i++
      continue
    }
    // Take the whole run of terminators ("?!", "...") and any closing marks.
    let end = i + 1
    while (end < to && (HARD_TERMINATORS.has(text[end]) || SOFT_TERMINATORS.has(text[end]))) end++
    while (end < to && CLOSERS.has(text[end])) end++

    let boundary: boolean
    if (hard || HARD_TERMINATORS.has(text[end - 1])) {
      boundary = true
    } else if (end < to && !isSpace(text[end])) {
      boundary = false // "3.5", "example.com", "v2.1.0"
    } else if (ch === '.') {
      let next = end
      while (next < to && isSpace(text[next])) next++
      const startsLower = next < to && /[a-z]/.test(text[next])
      boundary = !ABBREVIATIONS.has(wordBefore(text, i)) && !startsLower
    } else {
      boundary = true
    }

    if (boundary) {
      ranges.push([start, end])
      start = end
    }
    i = end
  }
  if (start < to) ranges.push([start, to])
  return ranges
}

interface Block {
  start: number
  end: number
  kind: 'code' | 'text'
}

const FENCE = /^\s{0,3}(```|~~~)/
const HEADING = /^\s{0,3}#{1,6}(\s|$)/
const LIST_ITEM = /^(\s*(?:[-*+]|\d{1,9}[.)])\s+)/
const TABLE_ROW = /^\s*\|/
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/

/**
 * Splits normalized text into blocks: fenced code, list items, table rows, and
 * paragraphs. Headings and horizontal rules are context, not content, and are
 * left out. A list item's marker is not part of the block.
 */
function blocks(text: string): Block[] {
  const out: Block[] = []
  let pos = 0
  let paragraph: { start: number; end: number } | null = null
  let fence: { start: number; marker: string } | null = null

  const flush = () => {
    if (paragraph) out.push({ ...paragraph, kind: 'text' })
    paragraph = null
  }

  while (pos <= text.length) {
    const nl = text.indexOf('\n', pos)
    const lineEnd = nl === -1 ? text.length : nl
    const line = text.slice(pos, lineEnd)

    if (fence) {
      const close = FENCE.exec(line)
      if (close && close[1] === fence.marker) {
        out.push({ start: fence.start, end: lineEnd, kind: 'code' })
        fence = null
      }
    } else {
      const open = FENCE.exec(line)
      if (open) {
        flush()
        fence = { start: pos, marker: open[1] }
      } else if (line.trim() === '') {
        flush()
      } else if (HEADING.test(line) || RULE.test(line)) {
        flush()
      } else if (TABLE_ROW.test(line)) {
        flush()
        out.push({ start: pos, end: lineEnd, kind: 'text' })
      } else {
        const item = LIST_ITEM.exec(line)
        if (item) {
          flush()
          paragraph = { start: pos + item[1].length, end: lineEnd }
        } else if (paragraph) {
          paragraph.end = lineEnd
        } else {
          paragraph = { start: pos, end: lineEnd }
        }
      }
    }
    if (nl === -1) break
    pos = nl + 1
  }
  flush()
  if (fence) out.push({ start: fence.start, end: text.length, kind: 'code' })
  return out
}

/** Trims a range to its non-space content. Returns null when nothing is left. */
function trimmed(text: string, start: number, end: number): [number, number] | null {
  let s = start
  let e = end
  while (s < e && isSpace(text[s])) s++
  while (e > s && isSpace(text[e - 1])) e--
  if (s >= e || !HAS_CONTENT.test(text.slice(s, e))) return null
  return [s, e]
}

/** Cuts `text` to at most `max` UTF-16 units without splitting a surrogate pair. */
function clipEnd(text: string, start: number, end: number, max: number): { end: number; clipped: boolean } {
  if (end - start <= max) return { end, clipped: false }
  let cut = start + max
  const code = text.charCodeAt(cut - 1)
  if (code >= 0xd800 && code <= 0xdbff) cut--
  return { end: cut, clipped: true }
}

function toPieces(
  source: string,
  ranges: Array<[number, number]>,
  maxChars: number,
  maxPieces: number
): Segmentation {
  const pieces: Piece[] = []
  let truncated = false
  for (const [rs, re] of ranges) {
    const range = trimmed(source, rs, re)
    if (!range) continue
    if (pieces.length >= maxPieces) {
      truncated = true
      break
    }
    const { end, clipped } = clipEnd(source, range[0], range[1], maxChars)
    pieces.push({ index: pieces.length + 1, text: source.slice(range[0], end), start: range[0], end, clipped })
  }
  return { pieces, truncated }
}

function bounded(text: string): { source: string; cut: boolean } {
  const normalized = normalizeText(text)
  if (normalized.length <= SUPPORT_LIMITS.maxInputChars) return { source: normalized, cut: false }
  // Cut at a code-point boundary so no half of a surrogate pair is kept.
  const { end } = clipEnd(normalized, 0, normalized.length, SUPPORT_LIMITS.maxInputChars)
  return { source: normalized.slice(0, end), cut: true }
}

/**
 * Splits an answer into numbered claims: one per sentence, with each list item,
 * table row and fenced code block starting its own. The same text always gives
 * the same claims, ids and offsets.
 */
export function segmentAnswer(answer: string): Segmentation {
  const { source, cut } = bounded(answer)
  const ranges: Array<[number, number]> = []
  for (const block of blocks(source)) {
    if (block.kind === 'code') ranges.push([block.start, block.end])
    else ranges.push(...sentenceRanges(source, block.start, block.end))
  }
  const result = toPieces(source, ranges, SUPPORT_LIMITS.maxClaimChars, SUPPORT_LIMITS.maxClaims)
  return { pieces: result.pieces, truncated: result.truncated || cut }
}

/**
 * Splits an article's body into numbered passages: one per paragraph, list
 * item, table row and fenced code block. A block longer than the passage limit
 * is split at sentence boundaries and packed into windows under the limit. The
 * same text always gives the same passages, ids and offsets, which is what lets
 * an unchanged article be re-sliced later without storing its text.
 */
export function segmentArticle(body: string): Segmentation {
  const { source, cut } = bounded(body)
  const max = SUPPORT_LIMITS.maxPassageChars
  const ranges: Array<[number, number]> = []

  for (const block of blocks(source)) {
    if (block.end - block.start <= max || block.kind === 'code') {
      ranges.push([block.start, block.end])
      continue
    }
    // Pack consecutive sentences into windows of at most `max` characters.
    let windowStart: number | null = null
    let windowEnd = block.start
    for (const [ss, se] of sentenceRanges(source, block.start, block.end)) {
      if (windowStart === null) {
        windowStart = ss
        windowEnd = se
      } else if (se - windowStart <= max) {
        windowEnd = se
      } else {
        ranges.push([windowStart, windowEnd])
        windowStart = ss
        windowEnd = se
      }
    }
    if (windowStart !== null) ranges.push([windowStart, windowEnd])
  }

  const result = toPieces(source, ranges, max, SUPPORT_LIMITS.maxPassagesPerArticle)
  return { pieces: result.pieces, truncated: result.truncated || cut }
}
