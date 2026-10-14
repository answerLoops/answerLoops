import { rateLimitShared } from '@/lib/ratelimit'

/** Longest message body any ingest path hands to the pipeline (characters). */
export const MAX_INGEST_CONTENT_CHARS = 8000

/** Default cap on a webhook request body, counted in bytes as it streams. */
export const WEBHOOK_MAX_BODY_BYTES = 1_000_000

const INGEST_RATE_LIMIT_PER_MINUTE = 600
const INGEST_RATE_LIMIT_WINDOW_MS = 60_000

/** Truncates message text to MAX_INGEST_CONTENT_CHARS. */
export function clampIngestContent(text: string): string {
  return text.length > MAX_INGEST_CONTENT_CHARS ? text.slice(0, MAX_INGEST_CONTENT_CHARS) : text
}

/**
 * Per-org request budget shared by every ingest entry point (HTTP forwarder,
 * Telegram, Discourse, Circle, Slack events, Google Chat). Returns true when
 * the caller should respond 429.
 */
export async function isIngestRateLimited(orgId: number): Promise<boolean> {
  const result = await rateLimitShared(`ingest:${orgId}`, INGEST_RATE_LIMIT_PER_MINUTE, INGEST_RATE_LIMIT_WINDOW_MS)
  return !result.ok
}
