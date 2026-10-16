import path from 'path'
import { PDFParse } from 'pdf-parse'
import mammoth from 'mammoth'
import { parse as csvParse } from 'csv-parse/sync'
import { inspectZipArchive } from '@/lib/ingest/zip-inspect'

// pdf-parse (via pdfjs-dist) parses on a worker thread it loads with a plain
// dynamic `import()` of GlobalWorkerOptions.workerSrc. Left unset, that
// defaults to a bare "./pdf.worker.mjs" relative to wherever pdfjs's own
// bundled chunk ends up — which Turbopack's server build does not carry the
// actual worker file to, so the import 404s at request time with "Setting up
// fake worker failed". Pointing it at the real file's on-disk path (computed
// at runtime, not a literal Turbopack could try to bundle-resolve itself)
// fixes it for both `next dev` and the standalone server build.
PDFParse.setWorker(
  path.join(process.cwd(), 'node_modules/pdf-parse/dist/worker/pdf.worker.mjs')
)

/** Longest extracted text (bytes, UTF-8) a single file may produce. */
export const MAX_EXTRACTED_TEXT_BYTES = 2 * 1024 * 1024
/** Most pages a PDF may have. */
export const MAX_PDF_PAGES = 300
/** How long PDF text extraction may run before it is abandoned. */
export const PDF_PARSE_TIMEOUT_MS = 30_000
/** Size limits for DOCX files. */
export const MAX_DOCX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024
export const MAX_DOCX_ENTRIES = 2000
export const MAX_DOCX_COMPRESSION_RATIO = 100

/** A parse failure whose message is safe to show to the person who uploaded the file. */
export class FileParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FileParseError'
  }
}

export class FileTooComplexError extends FileParseError {}

function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new FileParseError(message)), ms)
  })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

async function parsePdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer })
  const run = async () => {
    const info = await parser.getInfo()
    if (info.total > MAX_PDF_PAGES) {
      throw new FileTooComplexError(`This PDF has ${info.total} pages. The limit is ${MAX_PDF_PAGES} pages per file.`)
    }
    const result = await parser.getText()
    return result.text
  }
  try {
    return await withTimeout(run(), PDF_PARSE_TIMEOUT_MS, 'Reading this PDF took too long. Try splitting it into smaller files.')
  } finally {
    await parser.destroy().catch(() => {})
  }
}

async function parseDocx(buffer: Buffer): Promise<string> {
  const archive = inspectZipArchive(buffer)
  if (!archive.ok) throw new FileParseError('This document could not be read. Check the file is not corrupted.')
  if (archive.entries > MAX_DOCX_ENTRIES) {
    throw new FileTooComplexError('This document contains too many internal parts to import.')
  }
  if (archive.uncompressedBytes > MAX_DOCX_UNCOMPRESSED_BYTES) {
    throw new FileTooComplexError('This document is too large once unpacked to import.')
  }
  if (archive.compressedBytes > 0 && archive.uncompressedBytes / archive.compressedBytes > MAX_DOCX_COMPRESSION_RATIO) {
    throw new FileTooComplexError('This document is compressed in a way that cannot be imported.')
  }
  const result = await mammoth.extractRawText({ buffer })
  return result.value
}

const MAX_FILENAME_CHARS = 200

/**
 * Reduce a client-supplied file name to a safe display/storage name: last path
 * segment only, control characters removed, at most MAX_FILENAME_CHARS long
 * (keeping the extension).
 */
export function normalizeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? ''
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim()
  if (cleaned.length <= MAX_FILENAME_CHARS) return cleaned
  const dot = cleaned.lastIndexOf('.')
  const ext = dot > 0 && cleaned.length - dot <= 16 ? cleaned.slice(dot) : ''
  return cleaned.slice(0, MAX_FILENAME_CHARS - ext.length) + ext
}

type SupportedFileType = 'pdf' | 'docx' | 'md' | 'txt' | 'csv'

export function detectFileType(filename: string): SupportedFileType | null {
  const ext = filename.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  if (ext === 'md') return 'md'
  if (ext === 'txt') return 'txt'
  if (ext === 'csv') return 'csv'
  return null
}

export async function parseFile(buffer: Buffer, fileType: SupportedFileType): Promise<string> {
  switch (fileType) {
    case 'pdf':
      return parsePdf(buffer)
    case 'docx':
      return parseDocx(buffer)
    case 'md':
    case 'txt': {
      return buffer.toString('utf-8')
    }
    case 'csv': {
      try {
        const records = csvParse(buffer, {
          columns: true,
          skip_empty_lines: true,
        }) as Record<string, string>[]
        return records
          .map((row) => Object.entries(row).map(([k, v]) => `${k}: ${v}`).join('\n'))
          .join('\n\n')
      } catch {
        return buffer.toString('utf-8')
      }
    }
  }
}
