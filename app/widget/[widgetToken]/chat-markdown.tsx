import ReactMarkdown, { type Components } from 'react-markdown'

/**
 * Renders the assistant's reply text in the chat bubble. Models write light
 * Markdown (bold, inline code, short lists, links) and the bubble used to show
 * the raw asterisks and backticks. Only that small set is rendered; everything
 * else collapses to plain text, so a reply can never put an image, a heading, a
 * table or HTML on a customer's page. Raw HTML is not interpreted (the
 * renderer's default), and a link must be http or https.
 */
const ALLOWED_ELEMENTS = ['p', 'strong', 'em', 'code', 'ul', 'ol', 'li', 'a', 'br']

function isSafeLink(value: string | undefined): value is string {
  if (!value) return false
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

const components: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-4 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-4 last:mb-0">{children}</ol>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  code: ({ children }) => <code className="box-decoration-clone rounded bg-gray-200 px-1 py-0.5 font-mono text-[0.92em]">{children}</code>,
  a: ({ href, children }) =>
    isSafeLink(href) ? (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-brand-600 underline break-words">
        {children}
      </a>
    ) : (
      <>{children}</>
    ),
}

export function ChatMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown allowedElements={ALLOWED_ELEMENTS} unwrapDisallowed components={components}>
      {text}
    </ReactMarkdown>
  )
}
