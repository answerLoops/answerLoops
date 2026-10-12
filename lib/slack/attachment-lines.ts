// Slack file attachments are folded into ticket content as plain text lines
// (see app/api/slack/events/route.ts) since there's no dedicated attachment
// column/table — `[Attachment: name] — permalink`. This parses that format
// back out so the UI can render a real link instead of the raw bracket text.
const ATTACHMENT_LINE = /^\[Attachment: (.+?)\](?: — (\S+))?$/

interface ParsedContent {
  text: string
  attachments: { name: string; url: string | null }[]
}

export function parseAttachmentLines(content: string): ParsedContent {
  const lines = content.split('\n')
  const textLines: string[] = []
  const attachments: { name: string; url: string | null }[] = []

  for (const line of lines) {
    const match = ATTACHMENT_LINE.exec(line.trim())
    if (match) {
      attachments.push({ name: match[1], url: match[2] ?? null })
    } else {
      textLines.push(line)
    }
  }

  return {
    text: textLines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    attachments,
  }
}
