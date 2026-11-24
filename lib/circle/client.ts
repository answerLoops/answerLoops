import { MOCK_EXTERNALS } from '@/lib/mock-mode'

/**
 * Circle.so Admin API v2 client. Circle inbound events arrive as a hand-built
 * automation Workflow "send webhook" action rather than a REST subscription, so
 * the payload shape is not contractual — this client is used to enrich a thin
 * webhook body by fetching the full post or comment by id.
 *
 * Auth: `Authorization: Bearer <token>` where the token is an Admin V2 token
 * from the community's Developers → Tokens page.
 */

// Fixed Circle host: no tenant-supplied host is ever used for these calls.
const CIRCLE_API_BASE = 'https://app.circle.so/api/admin/v2'

export async function circleFetch(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  headers.set('Accept', 'application/json')
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  return fetch(`${CIRCLE_API_BASE}${path}`, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(10_000) })
}

export interface CircleContent {
  id: string
  body: string
  authorId: string
  authorName: string
  spaceId: string
  /** Post id — for a comment this is the parent post; used as the ticket thread key. */
  postId: string
  url: string | null
}

/** Circle post/comment `body` can be a plain string or `{ body: string }`. */
function readBody(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (raw && typeof raw === 'object' && typeof (raw as { body?: unknown }).body === 'string') {
    return (raw as { body: string }).body
  }
  return ''
}

interface CirclePostShape {
  id?: number | string
  name?: string
  body?: unknown
  url?: string
  space_id?: number | string
  user_id?: number | string
  user_name?: string
  post_id?: number | string
}

/** Normalise a post or comment object (from the webhook payload OR the API) into CircleContent. */
export function normalizeCircleContent(raw: CirclePostShape, kind: 'post' | 'comment'): CircleContent | null {
  if (raw.id == null) return null
  const id = String(raw.id)
  return {
    id,
    body: [raw.name, readBody(raw.body)].filter(Boolean).join('\n\n').trim(),
    authorId: raw.user_id != null ? String(raw.user_id) : '',
    authorName: raw.user_name ?? 'Circle member',
    spaceId: raw.space_id != null ? String(raw.space_id) : '',
    postId: kind === 'comment' && raw.post_id != null ? String(raw.post_id) : id,
    url: raw.url ?? null,
  }
}

/**
 * The outcome of looking up a post or comment in Circle's Admin API. Never
 * throws: a timeout or network failure is `unreachable`, a refused request
 * carries its status, and a body that isn't a record is `invalid`. `off`
 * means lookups are disabled (MOCK_EXTERNALS).
 */
export type CircleLookup =
  | { ok: true; record: CirclePostShape }
  | { ok: false; reason: 'off' | 'unreachable' | 'invalid' }
  | { ok: false; reason: 'status'; status: number }

export async function fetchCircleRecord(token: string, kind: 'post' | 'comment', id: string): Promise<CircleLookup> {
  if (MOCK_EXTERNALS) return { ok: false, reason: 'off' }
  let res: Response
  try {
    res = await circleFetch(token, `/${kind === 'comment' ? 'comments' : 'posts'}/${encodeURIComponent(id)}`)
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
  if (!res.ok) return { ok: false, reason: 'status', status: res.status }
  try {
    const record: unknown = await res.json()
    if (!record || typeof record !== 'object' || Array.isArray(record)) return { ok: false, reason: 'invalid' }
    return { ok: true, record: record as CirclePostShape }
  } catch {
    return { ok: false, reason: 'invalid' }
  }
}
