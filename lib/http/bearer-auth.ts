import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Constant-time string comparison. Both inputs are reduced to a SHA-256 digest
 * first so the comparison runs over equal-length buffers regardless of the
 * input lengths, and the length of the expected value is not observable.
 */
export function safeEqual(a: string, b: string): boolean {
  const da = createHash('sha256').update(a, 'utf8').digest()
  const db = createHash('sha256').update(b, 'utf8').digest()
  return timingSafeEqual(da, db)
}

/** Extracts the token from an `Authorization: Bearer <token>` header. */
export function getBearerToken(request: { headers: Headers }): string | null {
  const header = request.headers.get('authorization')
  if (!header || !header.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  return token.length > 0 ? token : null
}

/**
 * True when `token` equals the platform-wide BOT_SECRET. Fails closed: an unset
 * or empty BOT_SECRET never authorizes anything, and neither does an empty
 * presented token.
 */
export function matchesPlatformBotSecret(token: string | null | undefined): boolean {
  const expected = process.env.BOT_SECRET
  if (!expected || !token) return false
  return safeEqual(token, expected)
}

/** Bearer-token check against the platform-wide BOT_SECRET for maintenance routes. */
export function isPlatformBotRequest(request: { headers: Headers }): boolean {
  return matchesPlatformBotSecret(getBearerToken(request))
}
