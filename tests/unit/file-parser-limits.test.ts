import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  extractRawText: vi.fn(),
  getInfo: vi.fn(),
  getText: vi.fn(),
  destroy: vi.fn(),
}))

vi.mock('mammoth', () => ({ default: { extractRawText: h.extractRawText } }))
vi.mock('pdf-parse', () => ({
  PDFParse: class {
    static setWorker() {}
    getInfo = h.getInfo
    getText = h.getText
    destroy = h.destroy
  },
}))

import {
  parseFile,
  normalizeFileName,
  FileParseError,
  MAX_PDF_PAGES,
  PDF_PARSE_TIMEOUT_MS,
} from '@/lib/ingest/file-parsers'
import { inspectZipArchive } from '@/lib/ingest/zip-inspect'

interface FakeEntry {
  name: string
  compressed: number
  uncompressed: number
}

/** Builds just enough of a zip (central directory + end record) to be inspected. */
function buildZip(entries: FakeEntry[]): Buffer {
  const parts: Buffer[] = []
  for (const e of entries) {
    const name = Buffer.from(e.name)
    const h = Buffer.alloc(46)
    h.writeUInt32LE(0x02014b50, 0)
    h.writeUInt32LE(e.compressed, 20)
    h.writeUInt32LE(e.uncompressed, 24)
    h.writeUInt16LE(name.length, 28)
    parts.push(h, name)
  }
  const directory = Buffer.concat(parts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(directory.length, 12)
  eocd.writeUInt32LE(0, 16) // directory starts at the front of the buffer
  return Buffer.concat([directory, eocd])
}

const manyEntries = (n: number, compressed = 100, uncompressed = 200): FakeEntry[] =>
  Array.from({ length: n }, (_, i) => ({ name: `f${i}.xml`, compressed, uncompressed }))

describe('inspectZipArchive', () => {
  it('reads entry count and summed sizes from the central directory', () => {
    const result = inspectZipArchive(buildZip(manyEntries(3, 10, 40)))
    expect(result).toEqual({ ok: true, entries: 3, compressedBytes: 30, uncompressedBytes: 120 })
  })

  it('finds the end record when a trailing comment follows it', () => {
    const zip = buildZip(manyEntries(1))
    const comment = Buffer.from('hello')
    zip.writeUInt16LE(comment.length, zip.length - 2)
    expect(inspectZipArchive(Buffer.concat([zip, comment])).ok).toBe(true)
  })

  it.each([
    ['too short', Buffer.alloc(5)],
    ['no end record', Buffer.alloc(200, 1)],
    ['plain text', Buffer.from('this is not a zip archive at all, just text')],
  ])('reports %s as unreadable', (_l, buf) => {
    expect(inspectZipArchive(buf)).toEqual({ ok: false })
  })

  it('reports a directory that runs past the end of the data as unreadable', () => {
    const zip = buildZip(manyEntries(1))
    zip.writeUInt32LE(0xfffff, zip.length - 10) // inflate the declared directory size
    expect(inspectZipArchive(zip)).toEqual({ ok: false })
  })

  it('reports an entry count that disagrees with the directory as unreadable', () => {
    const zip = buildZip(manyEntries(2))
    zip.writeUInt16LE(5, zip.length - 12)
    expect(inspectZipArchive(zip)).toEqual({ ok: false })
  })
})

describe('parseFile docx limits', () => {
  beforeEach(() => {
    h.extractRawText.mockReset()
    h.extractRawText.mockResolvedValue({ value: 'document text' })
  })

  it('extracts a normal archive', async () => {
    await expect(parseFile(buildZip(manyEntries(12, 1000, 4000)), 'docx')).resolves.toBe('document text')
    expect(h.extractRawText).toHaveBeenCalledTimes(1)
  })

  it('accepts exactly 2000 entries', async () => {
    await expect(parseFile(buildZip(manyEntries(2000, 100, 200)), 'docx')).resolves.toBe('document text')
  })

  it('rejects more than 2000 entries before extraction', async () => {
    const err = await parseFile(buildZip(manyEntries(2001)), 'docx').catch((e) => e)
    expect(err).toBeInstanceOf(FileParseError)
    expect(err.message).toMatch(/too many internal parts/)
    expect(h.extractRawText).not.toHaveBeenCalled()
  })

  it('rejects more than 50 MB once unpacked before extraction', async () => {
    // 20:1 ratio so only the total-size rule trips.
    const zip = buildZip([{ name: 'word/document.xml', compressed: 3 * 1024 * 1024, uncompressed: 51 * 1024 * 1024 }])
    const err = await parseFile(zip, 'docx').catch((e) => e)
    expect(err).toBeInstanceOf(FileParseError)
    expect(err.message).toMatch(/too large once unpacked/)
    expect(h.extractRawText).not.toHaveBeenCalled()
  })

  it('accepts exactly 50 MB unpacked', async () => {
    const zip = buildZip([{ name: 'word/document.xml', compressed: 5 * 1024 * 1024, uncompressed: 50 * 1024 * 1024 }])
    await expect(parseFile(zip, 'docx')).resolves.toBe('document text')
  })

  it('rejects a compression ratio above 100:1 before extraction', async () => {
    const zip = buildZip([{ name: 'word/document.xml', compressed: 10_000, uncompressed: 1_500_000 }])
    const err = await parseFile(zip, 'docx').catch((e) => e)
    expect(err).toBeInstanceOf(FileParseError)
    expect(err.message).toMatch(/compressed in a way/)
    expect(h.extractRawText).not.toHaveBeenCalled()
  })

  it('accepts a ratio of exactly 100:1', async () => {
    const zip = buildZip([{ name: 'word/document.xml', compressed: 10_000, uncompressed: 1_000_000 }])
    await expect(parseFile(zip, 'docx')).resolves.toBe('document text')
  })

  it('rejects data that is not a zip archive without calling the extractor', async () => {
    const err = await parseFile(Buffer.from('plainly not a docx'.repeat(5)), 'docx').catch((e) => e)
    expect(err).toBeInstanceOf(FileParseError)
    expect(h.extractRawText).not.toHaveBeenCalled()
  })

  it('treats archives that need the 64-bit directory as too complex', async () => {
    const zip = buildZip(manyEntries(1))
    zip.writeUInt16LE(0xffff, zip.length - 12)
    zip.writeUInt16LE(0xffff, zip.length - 14)
    await expect(parseFile(zip, 'docx')).rejects.toBeInstanceOf(FileParseError)
    expect(h.extractRawText).not.toHaveBeenCalled()
  })
})

describe('parseFile pdf limits', () => {
  beforeEach(() => {
    h.getInfo.mockReset()
    h.getText.mockReset()
    h.destroy.mockReset()
    h.destroy.mockResolvedValue(undefined)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('extracts a PDF within the page cap', async () => {
    h.getInfo.mockResolvedValue({ total: MAX_PDF_PAGES })
    h.getText.mockResolvedValue({ text: 'pdf text' })
    await expect(parseFile(Buffer.from('%PDF'), 'pdf')).resolves.toBe('pdf text')
    expect(h.destroy).toHaveBeenCalled()
  })

  it('rejects a PDF over the page cap without extracting text', async () => {
    h.getInfo.mockResolvedValue({ total: MAX_PDF_PAGES + 1 })
    const err = await parseFile(Buffer.from('%PDF'), 'pdf').catch((e) => e)
    expect(err).toBeInstanceOf(FileParseError)
    expect(err.message).toContain(`${MAX_PDF_PAGES} pages`)
    expect(h.getText).not.toHaveBeenCalled()
    expect(h.destroy).toHaveBeenCalled()
  })

  it('gives up after the timeout and still releases the parser', async () => {
    vi.useFakeTimers()
    h.getInfo.mockResolvedValue({ total: 3 })
    h.getText.mockReturnValue(new Promise(() => {})) // never settles
    const pending = parseFile(Buffer.from('%PDF'), 'pdf').catch((e) => e)
    await vi.advanceTimersByTimeAsync(PDF_PARSE_TIMEOUT_MS + 1)
    const err = await pending
    expect(err).toBeInstanceOf(FileParseError)
    expect(err.message).toMatch(/took too long/)
    expect(h.destroy).toHaveBeenCalled()
  })

  it('does not time out a PDF that finishes in time', async () => {
    vi.useFakeTimers()
    h.getInfo.mockResolvedValue({ total: 3 })
    h.getText.mockResolvedValue({ text: 'ok' })
    await expect(parseFile(Buffer.from('%PDF'), 'pdf')).resolves.toBe('ok')
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('normalizeFileName', () => {
  it('keeps only the last path segment', () => {
    expect(normalizeFileName('../../etc/passwd.txt')).toBe('passwd.txt')
    expect(normalizeFileName('C:\\Users\\me\\notes.md')).toBe('notes.md')
    expect(normalizeFileName('a/b/c.pdf')).toBe('c.pdf')
  })

  it('strips control characters', () => {
    expect(normalizeFileName('no\u0000tes\n\r\t.txt')).toBe('notes.txt')
    expect(normalizeFileName('a\u007fb\u0085c.md')).toBe('abc.md')
  })

  it('limits the length to 200 characters and keeps the extension', () => {
    const out = normalizeFileName(`${'a'.repeat(500)}.pdf`)
    expect(out.length).toBe(200)
    expect(out.endsWith('.pdf')).toBe(true)
  })

  it('leaves ordinary names alone and returns empty for nothing usable', () => {
    expect(normalizeFileName('Quarterly report (final).docx')).toBe('Quarterly report (final).docx')
    expect(normalizeFileName('')).toBe('')
    expect(normalizeFileName('dir/')).toBe('')
    expect(normalizeFileName('\u0001\u0002')).toBe('')
  })
})
