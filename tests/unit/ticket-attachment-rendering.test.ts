import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseAttachmentLines } from '@/lib/slack/attachment-lines'

const ROOT = process.cwd()
function read(relPath: string): string {
  const abs = path.join(ROOT, relPath)
  expect(fs.existsSync(abs), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(abs, 'utf-8')
}

// Real bug found live: content with a Slack attachment was stored as
// `[Attachment: name] — url` (see app/api/slack/events/route.ts), but the
// ticket detail page rendered content in a plain <p>, so the customer saw
// the raw bracket-and-url text instead of a clickable file link. This
// parser splits the two back apart so the UI (components/tickets/ticket-
// content.tsx) can render a real <a> for each attachment.

describe('lib/slack/attachment-lines.ts — parseAttachmentLines', () => {
  it('splits human text from a trailing attachment line', () => {
    const { text, attachments } = parseAttachmentLines(
      "does the ai write suggested replies?\n\n[Attachment: image.png] — https://answerloopsworkspace.slack.com/files/U1/F1/image.png"
    )
    expect(text).toBe('does the ai write suggested replies?')
    expect(attachments).toEqual([
      { name: 'image.png', url: 'https://answerloopsworkspace.slack.com/files/U1/F1/image.png' },
    ])
  })

  it('handles an attachment-only message (no caption text) — the file_share case', () => {
    const { text, attachments } = parseAttachmentLines('[Attachment: screenshot.png] — https://x.slack.com/files/a/b/screenshot.png')
    expect(text).toBe('')
    expect(attachments).toEqual([{ name: 'screenshot.png', url: 'https://x.slack.com/files/a/b/screenshot.png' }])
  })

  it('handles multiple attachments', () => {
    const { text, attachments } = parseAttachmentLines(
      'two files\n[Attachment: a.png] — https://x/a.png\n[Attachment: b.pdf] — https://x/b.pdf'
    )
    expect(text).toBe('two files')
    expect(attachments).toHaveLength(2)
    expect(attachments[0].name).toBe('a.png')
    expect(attachments[1].name).toBe('b.pdf')
  })

  it('an attachment with no permalink still parses with a null url', () => {
    const { attachments } = parseAttachmentLines('[Attachment: file]')
    expect(attachments).toEqual([{ name: 'file', url: null }])
  })

  it('plain content with no attachment lines is untouched', () => {
    const { text, attachments } = parseAttachmentLines('just a normal question, no attachments here')
    expect(text).toBe('just a normal question, no attachments here')
    expect(attachments).toEqual([])
  })

  it('a line that only superficially resembles the pattern (no leading [Attachment:) is left as text', () => {
    const { text, attachments } = parseAttachmentLines('I clicked [this link] — https://example.com by mistake')
    expect(text).toBe('I clicked [this link] — https://example.com by mistake')
    expect(attachments).toEqual([])
  })
})

// Second bug found live: even after the TicketContent fix, the ticket
// detail page's <h1> still showed the raw "[Attachment: ...] — url" text.
// Root cause: ticket.ai_summary isn't null for these tickets — the ticket's
// initial placeholder summary (set synchronously in processCommunityMessage,
// before real triage runs in the background) was built from `content.slice(0,
// 200)` in lib/ingest/pipeline.ts, taken from the RAW content, and the page
// always prefers ai_summary over the (correctly filtered) titleFallback.
// Fixing only the page's fallback wasn't enough since the stored ai_summary
// itself needed to go through the same parser.
describe('lib/ingest/pipeline.ts — placeholder ticket summary excludes raw attachment lines', () => {
  it('runs content through parseAttachmentLines before slicing it into the placeholder summary', () => {
    const src = read('lib/ingest/pipeline.ts')
    const idx = src.indexOf('const { text: contentText, attachments } = parseAttachmentLines(content)')
    const createTicketIdx = src.indexOf('ticket = await createTicket(')
    expect(idx).toBeGreaterThan(-1)
    expect(createTicketIdx).toBeGreaterThan(idx)
    const block = src.slice(idx, createTicketIdx)
    expect(block).toContain('parseAttachmentLines(content)')
    expect(block).not.toContain('summary: content.slice(0, 200)')
    expect(block).toContain('contentText.slice(0, 200)')
  })
})
