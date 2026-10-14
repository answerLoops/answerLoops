// Pure helpers for inbound email processing: header extraction, loop
// detection, spam verdict, HTML fallback, Message-ID parsing. No I/O —
// everything here is directly unit-testable.

interface InboundHeaders {
  get(name: string): string | null
}

/**
 * Providers ship headers either as an object map or an array of
 * { name, value } pairs. Normalize both into case-insensitive lookup.
 */
export function normalizeHeaders(raw: unknown): InboundHeaders {
  const map = new Map<string, string>()
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const e = entry as { name?: unknown; value?: unknown }
      if (typeof e?.name === 'string' && typeof e?.value === 'string') {
        map.set(e.name.toLowerCase(), e.value)
      }
    }
  } else if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string') map.set(k.toLowerCase(), v)
    }
  }
  return { get: (name: string) => map.get(name.toLowerCase()) ?? null }
}

const NO_REPLY_SENDER_RE = /^(no-?reply|mailer-daemon|postmaster|bounce[s]?)@/i

/**
 * Auto-responder / loop detection. An AI that replies to an out-of-office
 * responder gets a response back, replies to that, and loops forever —
 * burning model spend the whole way. Returns the reason when the message
 * must not receive an automated reply (and shouldn't become a ticket).
 */
export function detectAutoResponse(headers: InboundHeaders, fromAddr: string): string | null {
  const autoSubmitted = headers.get('auto-submitted')
  if (autoSubmitted && autoSubmitted.toLowerCase() !== 'no') return 'auto-submitted header'

  const precedence = headers.get('precedence')?.toLowerCase()
  if (precedence && ['bulk', 'auto_reply', 'auto-reply', 'junk', 'list'].includes(precedence)) {
    return `precedence: ${precedence}`
  }

  if (headers.get('x-auto-response-suppress')) return 'x-auto-response-suppress header'
  if (headers.get('x-autoreply') || headers.get('x-autorespond')) return 'x-autoreply header'
  if (headers.get('list-id') || headers.get('list-unsubscribe')) return 'mailing-list headers'

  const returnPath = headers.get('return-path')
  if (returnPath !== null && returnPath.trim().replace(/[<>]/g, '') === '') {
    return 'empty return-path (bounce)'
  }

  if (NO_REPLY_SENDER_RE.test(fromAddr.trim())) return 'no-reply sender address'

  return null
}

/**
 * Spam verdict from whatever signal the provider supplies. Tolerant by
 * design: providers differ, and absence of signal means "not spam" rather
 * than blocking legitimate mail. Returns a short verdict string for the
 * email_messages record, or null when clean/unknown.
 */
export function extractSpamVerdict(headers: InboundHeaders, payload: Record<string, unknown>): string | null {
  const spamStatus = headers.get('x-spam-status')
  if (spamStatus && /^yes/i.test(spamStatus)) return `x-spam-status: ${spamStatus.slice(0, 100)}`

  const spamFlag = headers.get('x-spam-flag')
  if (spamFlag && /^yes/i.test(spamFlag)) return 'x-spam-flag: yes'

  const score = payload['spam_score'] ?? payload['spamScore']
  if (typeof score === 'number' && score >= 5) return `spam_score: ${score}`

  const verdict = payload['spam_verdict'] ?? payload['spamVerdict']
  if (typeof verdict === 'string' && /fail|spam/i.test(verdict)) return `verdict: ${verdict}`

  return null
}

/**
 * HTML → text fallback for HTML-only emails (very common; previously these
 * produced empty content and were silently dropped). Deliberately simple —
 * block-level tags to newlines, strip the rest, decode common entities.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Parse a References/In-Reply-To header into individual Message-IDs.
 * "<a@x> <b@y>" → ["<a@x>", "<b@y>"]. IDs are kept angle-bracketed —
 * that's the canonical storage form used in email_messages.
 */
export function parseMessageIds(headerValue: string | null | undefined): string[] {
  if (!headerValue) return []
  return (headerValue.match(/<[^<>\s]+>/g) ?? []).map((s) => s.trim())
}

/** Canonicalize a Message-ID to angle-bracketed form. */
export function canonicalMessageId(id: string): string {
  const trimmed = id.trim()
  if (!trimmed) return trimmed
  return trimmed.startsWith('<') ? trimmed : `<${trimmed}>`
}

/** Build the Message-IDs a reply claims to respond to (In-Reply-To + References). */
export function collectThreadIds(inReplyTo: string | null, references: string | null): string[] {
  const ids = [...parseMessageIds(inReplyTo), ...parseMessageIds(references)]
  return [...new Set(ids)]
}
