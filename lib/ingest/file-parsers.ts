import path from 'path'
import { PDFParse } from 'pdf-parse'
import mammoth from 'mammoth'
import { parse as csvParse } from 'csv-parse/sync'

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

export type SupportedFileType = 'pdf' | 'docx' | 'md' | 'txt' | 'csv'

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
    case 'pdf': {
      const parser = new PDFParse({ data: buffer })
      const result = await parser.getText()
      return result.text
    }
    case 'docx': {
      const result = await mammoth.extractRawText({ buffer })
      return result.value
    }
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
