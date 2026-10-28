import { parseAttachmentLines } from '@/lib/slack/attachment-lines'

// Renders ticket/reply content, turning any `[Attachment: name] — url` lines
// (see lib/slack/attachment-lines.ts) into a real clickable link instead of
// showing the raw bracket-and-url text. Slack file permalinks require the
// viewer to be signed into that Slack workspace to open, so this links out
// rather than attempting an inline <img> preview, which would just render
// as a broken image for anyone not logged into Slack in this browser.
export function TicketContent({ content, className }: { content: string; className?: string }) {
  const { text, attachments } = parseAttachmentLines(content)

  return (
    <div className={className}>
      {text && <p className="text-sm text-gray-800 whitespace-pre-wrap">{text}</p>}
      {attachments.length > 0 && (
        <div className={text ? 'mt-2 flex flex-col gap-1' : 'flex flex-col gap-1'}>
          {attachments.map((a, i) => (
            <a
              key={i}
              href={a.url ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit max-w-full items-center gap-1.5 rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-medium text-blue-600 hover:bg-gray-100 hover:text-blue-800"
            >
              <span aria-hidden="true">📎</span>
              <span className="min-w-0 break-all">{a.name}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
