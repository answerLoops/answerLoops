import { describe, it, expect } from 'vitest'
import { normalizeText, segmentAnswer, segmentArticle } from '@/lib/kb/support/segment'
import { SUPPORT_LIMITS } from '@/lib/kb/support/limits'

/**
 * Segmentation is what makes evidence addressable: the same text must always
 * give the same numbered pieces, and every piece must be a real substring of
 * the text it came from.
 */

const texts = (s: { pieces: { text: string }[] }) => s.pieces.map((p) => p.text)

describe('segmentAnswer: claims', () => {
  it('splits sentences and numbers them from 1 in reading order', () => {
    const { pieces } = segmentAnswer('Open Settings. Choose AI Model! Is it saved? Yes.')
    expect(pieces.map((p) => [p.index, p.text])).toEqual([
      [1, 'Open Settings.'],
      [2, 'Choose AI Model!'],
      [3, 'Is it saved?'],
      [4, 'Yes.'],
    ])
  })

  it('is deterministic: the same text gives the same pieces, ids and offsets every time', () => {
    const text = 'First sentence. Second one!\n\n- A list item.\n- Another item. With two sentences.\n\n```\ncode here\n```'
    expect(segmentAnswer(text)).toEqual(segmentAnswer(text))
    expect(segmentAnswer(text)).toEqual(segmentAnswer(`${text}`))
  })

  it('every unclipped piece is exactly the normalized source between its offsets', () => {
    const text = 'Hello there.\r\nSecond line is here. Third!\r\n\r\n* item one\r\n* item two. More.'
    const source = normalizeText(text)
    for (const p of segmentAnswer(text).pieces) {
      expect(source.slice(p.start, p.end)).toBe(p.text)
      expect(p.clipped).toBe(false)
    }
  })

  it('treats CRLF, CR and LF line endings the same', () => {
    const lf = 'One.\nTwo.\n\n- three\n- four'
    const crlf = lf.replace(/\n/g, '\r\n')
    const cr = lf.replace(/\n/g, '\r')
    expect(segmentAnswer(crlf)).toEqual(segmentAnswer(lf))
    expect(segmentAnswer(cr)).toEqual(segmentAnswer(lf))
  })

  it('returns nothing for empty, blank or punctuation-only text', () => {
    for (const text of ['', '   ', '\n\n\n', '...', '--- \n***', '!!! ???', '\u0000\u0000']) {
      expect(segmentAnswer(text)).toEqual({ pieces: [], truncated: false })
    }
  })

  it('makes each list item its own claim and leaves the marker out', () => {
    const { pieces } = segmentAnswer('Steps:\n- Install the agent\n- Restart it\n1. Check the logs\n2) Done')
    expect(texts({ pieces })).toEqual(['Steps:', 'Install the agent', 'Restart it', 'Check the logs', 'Done'])
  })

  it('splits sentences inside a list item', () => {
    expect(texts(segmentAnswer('- Do this. Then do that.'))).toEqual(['Do this.', 'Then do that.'])
  })

  it('keeps a fenced code block as one claim, whatever punctuation is inside', () => {
    const { pieces } = segmentAnswer('Run this.\n\n```bash\nnpm run build. Then npm start! Really?\n```\n\nThat is all.')
    expect(pieces).toHaveLength(3)
    expect(pieces[1].text.startsWith('```bash')).toBe(true)
    expect(pieces[1].text.endsWith('```')).toBe(true)
    expect(pieces[1].text).toContain('npm run build. Then npm start! Really?')
  })

  it('runs an unclosed code fence to the end of the text', () => {
    const { pieces } = segmentAnswer('Intro.\n```\nlet x = 1\nlet y = 2')
    expect(pieces).toHaveLength(2)
    expect(pieces[1].text).toBe('```\nlet x = 1\nlet y = 2')
  })

  it('does not treat headings or horizontal rules as claims', () => {
    expect(texts(segmentAnswer('# Title\n\nBody text here.\n\n---\n\n## Next\n\nMore text.'))).toEqual(['Body text here.', 'More text.'])
  })

  it('makes each table row its own claim', () => {
    expect(texts(segmentAnswer('| Plan | Price |\n| Pro | $49 |'))).toEqual(['| Plan | Price |', '| Pro | $49 |'])
  })

  it('does not split on abbreviations, decimals, versions, URLs or file names', () => {
    expect(texts(segmentAnswer('Use e.g. the CLI, i.e. the tool, etc. for this. Dr. Smith agrees.'))).toEqual([
      'Use e.g. the CLI, i.e. the tool, etc. for this.',
      'Dr. Smith agrees.',
    ])
    expect(texts(segmentAnswer('Needs Node 20.5 or v2.1.0 from https://example.com/docs.html today.'))).toEqual([
      'Needs Node 20.5 or v2.1.0 from https://example.com/docs.html today.',
    ])
  })

  it('does not split before a lowercase word after a period', () => {
    expect(texts(segmentAnswer('Set the flag. then restart. Finished.'))).toEqual(['Set the flag. then restart.', 'Finished.'])
  })

  it('keeps closing quotes and brackets with their sentence', () => {
    expect(texts(segmentAnswer('He said "stop." Then (it ended.) Done.'))).toEqual(['He said "stop."', 'Then (it ended.)', 'Done.'])
  })

  it('groups a run of terminators with its sentence', () => {
    expect(texts(segmentAnswer('Really?! Yes... Okay.'))).toEqual(['Really?!', 'Yes...', 'Okay.'])
  })

  it.each([
    ['Chinese', '请打开设置。然后选择模型！完成了吗？是的。', 4],
    ['Japanese', '設定を開きます。保存しました。', 2],
    ['Hindi', 'सेटिंग खोलें। फिर मॉडल चुनें।', 2],
    ['Arabic', 'هل تم الحفظ؟ نعم تم الحفظ.', 2],
    ['Spanish', 'Abre la configuración. ¿Se guardó? Sí.', 3],
    ['Russian', 'Откройте настройки. Выберите модель.', 2],
  ])('splits %s text into sentences', (_name, text, count) => {
    const { pieces } = segmentAnswer(text)
    expect(pieces).toHaveLength(count)
    const source = normalizeText(text)
    for (const p of pieces) expect(source.slice(p.start, p.end)).toBe(p.text)
  })

  it('caps the number of claims and says it did', () => {
    const text = Array.from({ length: SUPPORT_LIMITS.maxClaims + 15 }, (_, i) => `Claim number ${i} is here.`).join(' ')
    const result = segmentAnswer(text)
    expect(result.pieces).toHaveLength(SUPPORT_LIMITS.maxClaims)
    expect(result.truncated).toBe(true)
    expect(result.pieces.at(-1)!.index).toBe(SUPPORT_LIMITS.maxClaims)
  })

  it('does not flag truncation when everything fit', () => {
    const text = Array.from({ length: SUPPORT_LIMITS.maxClaims }, (_, i) => `Claim ${i}.`).join(' ')
    const result = segmentAnswer(text)
    expect(result.pieces).toHaveLength(SUPPORT_LIMITS.maxClaims)
    expect(result.truncated).toBe(false)
  })

  it('clips a claim longer than the limit and says so, offsets still pointing at the source', () => {
    const long = `${'word '.repeat(400).trim()}.`
    const { pieces } = segmentAnswer(long)
    expect(pieces).toHaveLength(1)
    expect(pieces[0].clipped).toBe(true)
    expect(pieces[0].text).toHaveLength(SUPPORT_LIMITS.maxClaimChars)
    expect(long.startsWith(pieces[0].text)).toBe(true)
    expect(pieces[0].end).toBe(pieces[0].start + SUPPORT_LIMITS.maxClaimChars)
  })

  it('never cuts a surrogate pair in half when clipping', () => {
    const emoji = '😀'
    const text = `${'a'.repeat(SUPPORT_LIMITS.maxClaimChars - 1)}${emoji}${emoji}.`
    const [piece] = segmentAnswer(text).pieces
    expect(piece.clipped).toBe(true)
    const last = piece.text.charCodeAt(piece.text.length - 1)
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false)
    expect(piece.text).toHaveLength(SUPPORT_LIMITS.maxClaimChars - 1)
  })

  it('stays bounded on very long text: only the first part is read, and it is flagged', () => {
    const text = 'This is a sentence. '.repeat(20_000) // 400,000 characters
    const started = Date.now()
    const result = segmentAnswer(text)
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(result.truncated).toBe(true)
    expect(result.pieces.length).toBeLessThanOrEqual(SUPPORT_LIMITS.maxClaims)
    for (const p of result.pieces) expect(p.end).toBeLessThanOrEqual(SUPPORT_LIMITS.maxInputChars)
  })

  it('gives one claim per line when each is its own paragraph', () => {
    expect(texts(segmentAnswer('One thing\n\nAnother thing\n\nThird thing'))).toEqual(['One thing', 'Another thing', 'Third thing'])
  })

  it('removes NUL bytes so offsets never point past text that is not there', () => {
    expect(normalizeText('a\u0000b\r\nc')).toBe('ab\nc')
  })
})

describe('segmentArticle: passages', () => {
  it('makes a passage of each paragraph, list item, table row and code block', () => {
    const body = 'Intro paragraph about resets.\n\n## Steps\n\n- Open Settings\n- Choose Security\n\n| a | b |\n\n```\ncode\n```'
    expect(texts(segmentArticle(body))).toEqual([
      'Intro paragraph about resets.',
      'Open Settings',
      'Choose Security',
      '| a | b |',
      '```\ncode\n```',
    ])
  })

  it('keeps a multi-line paragraph as one passage, newline included', () => {
    const { pieces } = segmentArticle('Line one of it\nline two of it.\n\nNext paragraph.')
    expect(pieces).toHaveLength(2)
    expect(pieces[0].text).toBe('Line one of it\nline two of it.')
  })

  it('is deterministic, so an unchanged article can be re-sliced into the same ids later', () => {
    const body = 'A paragraph. It has two sentences.\n\n- item\n\nLast one.'
    const first = segmentArticle(body)
    expect(segmentArticle(body)).toEqual(first)
    expect(segmentArticle(body.replace(/\n/g, '\r\n'))).toEqual(first)
  })

  it('packs a paragraph longer than the limit into windows at sentence boundaries', () => {
    const sentence = 'This is one fairly ordinary sentence about the product.'
    const body = Array.from({ length: 60 }, () => sentence).join(' ')
    const { pieces } = segmentArticle(body)
    expect(pieces.length).toBeGreaterThan(1)
    for (const p of pieces) {
      expect(p.text.length).toBeLessThanOrEqual(SUPPORT_LIMITS.maxPassageChars)
      expect(p.text.endsWith('.')).toBe(true)
      expect(p.clipped).toBe(false)
    }
    // Nothing was lost between windows.
    expect(pieces.map((p) => p.text).join(' ').replace(/\s+/g, ' ')).toBe(body)
  })

  it('clips a single sentence longer than the limit', () => {
    const body = `${'word '.repeat(600).trim()}.`
    const { pieces } = segmentArticle(body)
    expect(pieces).toHaveLength(1)
    expect(pieces[0].clipped).toBe(true)
    expect(pieces[0].text).toHaveLength(SUPPORT_LIMITS.maxPassageChars)
  })

  it('clips an oversized code block rather than splitting it', () => {
    const { pieces } = segmentArticle(`\`\`\`\n${'x = 1\n'.repeat(500)}\`\`\``)
    expect(pieces).toHaveLength(1)
    expect(pieces[0].clipped).toBe(true)
    expect(pieces[0].text.length).toBeLessThanOrEqual(SUPPORT_LIMITS.maxPassageChars)
  })

  it('caps the passages per article and says so', () => {
    const body = Array.from({ length: SUPPORT_LIMITS.maxPassagesPerArticle + 10 }, (_, i) => `Paragraph ${i} text.`).join('\n\n')
    const result = segmentArticle(body)
    expect(result.pieces).toHaveLength(SUPPORT_LIMITS.maxPassagesPerArticle)
    expect(result.truncated).toBe(true)
  })

  it('handles empty and whitespace-only articles', () => {
    expect(segmentArticle('')).toEqual({ pieces: [], truncated: false })
    expect(segmentArticle(' \n\n\t')).toEqual({ pieces: [], truncated: false })
  })

  it('every passage is a substring of the normalized body at its offsets', () => {
    const body = 'First para.\r\n\r\n- bullet one\r\n- bullet two\r\n\r\nLong. '.concat('More text here. '.repeat(120))
    const source = normalizeText(body)
    for (const p of segmentArticle(body).pieces) {
      if (!p.clipped) expect(source.slice(p.start, p.end)).toBe(p.text)
      else expect(source.slice(p.start, p.end)).toBe(p.text)
    }
  })

  it('reads non-English articles too', () => {
    const { pieces } = segmentArticle('如何重置密码。点击设置。\n\n然后选择安全。')
    expect(pieces.length).toBeGreaterThanOrEqual(2)
  })
})
