import Image from 'next/image'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { parseAttachmentLines } from '@/lib/slack/attachment-lines'
import { splitEmailQuote } from '@/lib/tickets/email-quote'
import type { SourcePlatform } from '@/types'

function isSafeExternalUrl(value: string | undefined): value is string {
  if (!value) return false

  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

// Keep Markdown renderers outside TicketContent to avoid recreating
// component definitions on every render.
const markdownComponents: Components = {
  a: ({ href, children }) =>
    isSafeExternalUrl(href) ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 underline break-all hover:text-blue-800"
      >
        {children}
      </a>
    ) : (
      <>{children}</>
    ),

  img: ({ src, alt }) =>
    typeof src === 'string' && isSafeExternalUrl(src) ? (
      <Image
        src={src}
        alt={alt ?? ''}
        width={1200}
        height={800}
        unoptimized
        className="block max-w-full h-auto rounded"
      />
    ) : (
      <>{alt}</>
    ),
}

function Markdown({ text }: { text: string }) {
  return (
    <div className="text-sm text-gray-800 break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {text}
      </ReactMarkdown>
    </div>
  )
}

// A comment sent by replying to a GitHub notification email arrives with the
// quoted notification and GitHub's footer attached. Show the reply, and keep the
// rest one click away.
function GithubMarkdown({ text }: { text: string }) {
  const { reply, quoted } = splitEmailQuote(text)
  return (
    <>
      <Markdown text={reply} />
      {quoted && (
        <details className="mt-3 text-xs text-gray-500" data-testid="quoted-email">
          <summary className="w-fit cursor-pointer select-none font-medium text-gray-500 hover:text-gray-700">
            Show quoted email
          </summary>
          <div className="mt-2 border-l-2 border-gray-200 pl-3 text-gray-500">
            <Markdown text={quoted} />
          </div>
        </details>
      )}
    </>
  )
}

// Renders ticket/reply content, turning any [Attachment: name] — url
// lines into clickable links. GitHub messages additionally support safe Markdown.
export function TicketContent({
  content,
  className,
  sourcePlatform,
}: {
  content: string
  className?: string
  sourcePlatform?: SourcePlatform
}) {
  const { text, attachments } = parseAttachmentLines(content)

  return (
    <div className={className}>
      {text &&
        (sourcePlatform === 'github' ? (
          <GithubMarkdown text={text} />
        ) : (
          <p className="text-sm text-gray-800 whitespace-pre-wrap">{text}</p>
        ))}

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
