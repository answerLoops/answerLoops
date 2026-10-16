// Pure helpers for inbound email: whether the receiving provider reports that
// the sender's domain passed its checks (DMARC, or SPF and DKIM together), and
// a bounded copy of the payload to store. No I/O.

const AUTH_RESULTS_HEADER = 'authentication-results'

export interface HeaderPair {
  name: string
  value: string
}

function parseRawHeaderBlock(text: string): HeaderPair[] {
  const unfolded: string[] = []
  for (const line of text.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && unfolded.length > 0) unfolded[unfolded.length - 1] += ` ${line.trim()}`
    else if (line.trim()) unfolded.push(line)
  }
  const out: HeaderPair[] = []
  for (const line of unfolded) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    out.push({ name: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() })
  }
  return out
}

function entryField(entry: Record<string, unknown>, key: 'name' | 'value'): unknown {
  for (const [k, v] of Object.entries(entry)) if (k.toLowerCase() === key) return v
  return undefined
}

/**
 * Normalizes the header shapes providers deliver into an ordered list of
 * name/value pairs: a raw multi-line header block (folded lines joined), a
 * JSON string of one of the other shapes, an array of [name, value] tuples,
 * an array of { name, value } / { Name, Value } objects, or an object map.
 */
export function toHeaderPairs(raw: unknown): HeaderPair[] {
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        return toHeaderPairs(JSON.parse(trimmed))
      } catch {
        // not JSON: treat as a raw header block
      }
    }
    return parseRawHeaderBlock(raw)
  }
  const out: HeaderPair[] = []
  const add = (name: unknown, value: unknown) => {
    if (typeof name !== 'string') return
    if (typeof value === 'string') out.push({ name, value })
    else if (Array.isArray(value)) for (const item of value) if (typeof item === 'string') out.push({ name, value: item })
  }
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (Array.isArray(entry)) add(entry[0], entry[1])
      else if (entry && typeof entry === 'object') {
        const e = entry as Record<string, unknown>
        add(entryField(e, 'name'), entryField(e, 'value'))
      }
    }
  } else if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) add(k, v)
  }
  return out
}

function headerValues(raw: unknown, name: string): string[] {
  return toHeaderPairs(raw)
    .filter((h) => h.name.toLowerCase() === name)
    .map((h) => h.value)
}

/**
 * Picks the header collection out of a provider payload: `headers` (Resend,
 * SendGrid, generic), `Headers` (Postmark) or `message-headers` (Mailgun),
 * returned as normalized pairs.
 */
export function extractHeaderPairs(payload: Record<string, unknown>): HeaderPair[] {
  for (const key of ['headers', 'Headers', 'message-headers']) {
    const v = payload[key]
    if (v !== undefined && v !== null && v !== '') return toHeaderPairs(v)
  }
  return []
}

const RESULT_PATTERNS = {
  dmarc: /(?:^|[\s;])dmarc\s*=\s*([a-z]+)/i,
  spf: /(?:^|[\s;])spf\s*=\s*([a-z]+)/i,
  dkim: /(?:^|[\s;])dkim\s*=\s*([a-z]+)/i,
} as const

function resultOf(text: string, method: keyof typeof RESULT_PATTERNS): string | null {
  const m = text.match(RESULT_PATTERNS[method])
  return m ? m[1].toLowerCase() : null
}

function passes(dmarc: string | null, spf: string | null, dkim: string | null): boolean {
  if (dmarc !== null) return dmarc === 'pass'
  return spf === 'pass' && dkim === 'pass'
}

function bareResult(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const v = value.toLowerCase()
  return /\bpass\b/.test(v) && !/fail|none|neutral|error/.test(v) ? 'pass' : 'fail'
}

export interface SenderVerification {
  verified: boolean
  source: 'authentication-results' | 'payload' | 'none'
}

/**
 * Reads the provider's own sender check results. Only the
 * first Authentication-Results header (the receiving system's own) is read. Providers that report the
 * outcome as payload fields (spf, dkim, dmarc) or provider-added headers are
 * read as a fallback. When
 * neither is present the message is treated as unverified.
 */
export function readSenderVerification(headersRaw: unknown, payload: Record<string, unknown>): SenderVerification {
  const first = headerValues(headersRaw, AUTH_RESULTS_HEADER)[0]
  if (first) {
    return {
      verified: passes(resultOf(first, 'dmarc'), resultOf(first, 'spf'), resultOf(first, 'dkim')),
      source: 'authentication-results',
    }
  }
  const pick = (...keys: string[]) => keys.map((k) => payload[k]).find((v) => v !== undefined)
  const dmarc = bareResult(pick('dmarc', 'DMARC'))
  const spf = bareResult(pick('spf', 'SPF'))
  const dkim = bareResult(pick('dkim', 'DKIM'))
  if (dmarc === null && spf === null && dkim === null) return { verified: false, source: 'none' }
  return { verified: passes(dmarc, spf, dkim), source: 'payload' }
}

export const MAX_STORED_PAYLOAD_BYTES = 64 * 1024
const MAX_STORED_BODY_CHARS = 16_000
const KEPT_HEADERS = [
  'message-id', 'in-reply-to', 'references', 'authentication-results', 'received-spf',
  'x-spam-status', 'x-spam-flag', 'auto-submitted', 'precedence', 'list-id', 'return-path',
]
const KEPT_FIELDS = [
  'from', 'to', 'subject', 'message_id', 'spam_score', 'spamScore', 'spam_verdict', 'spamVerdict',
  'spf', 'dkim', 'dmarc', 'SPF', 'DKIM', 'DMARC',
]

/**
 * A bounded copy of an inbound payload for the email_messages record: selected
 * fields only, bodies truncated, and the serialized result never larger than
 * MAX_STORED_PAYLOAD_BYTES.
 */
export function compactRawPayload(data: Record<string, unknown>, headersRaw: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of KEPT_FIELDS) if (data[k] !== undefined) out[k] = data[k]
  const headers: Record<string, string> = {}
  for (const name of KEPT_HEADERS) {
    const v = headerValues(headersRaw, name)[0]
    if (v !== undefined) headers[name] = v.slice(0, 2000)
  }
  out.headers = headers
  for (const k of ['text', 'html'] as const) {
    const v = data[k]
    if (typeof v === 'string') out[k] = v.slice(0, MAX_STORED_BODY_CHARS)
  }
  let size = Buffer.byteLength(JSON.stringify(out))
  if (size > MAX_STORED_PAYLOAD_BYTES) {
    delete out.html
    size = Buffer.byteLength(JSON.stringify(out))
  }
  if (size > MAX_STORED_PAYLOAD_BYTES) {
    delete out.text
    out.truncated = true
  }
  if (Buffer.byteLength(JSON.stringify(out)) > MAX_STORED_PAYLOAD_BYTES) {
    return { truncated: true, subject: typeof data.subject === 'string' ? data.subject.slice(0, 500) : null }
  }
  return out
}
