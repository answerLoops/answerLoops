import crypto from 'crypto'

/**
 * Stateless confirmation token for newsletter double opt-in.
 *
 * A signup request only emails a link; nothing is stored until the recipient
 * follows it. The token carries the address and an expiry and is signed with a
 * key derived from AUTH_SECRET under its own domain-separation label, so no
 * table or column is needed and a token can't be reused as any other signed
 * value in the app.
 */
const CONFIRM_TTL_MS = 48 * 60 * 60_000

function deriveKey(): Buffer {
  const secret = process.env.AUTH_SECRET
  if (!secret) {
    throw new Error('AUTH_SECRET is not set — cannot mint or verify newsletter confirmation tokens.')
  }
  return crypto.createHmac('sha256', secret).update('newsletter-confirm-token-v1').digest()
}

function sign(key: Buffer, payload: string): string {
  return crypto.createHmac('sha256', key).update(payload).digest('base64url')
}

function safeEqual(a: string, b: string): boolean {
  const da = crypto.createHash('sha256').update(a).digest()
  const db = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(da, db)
}

export function mintNewsletterConfirmToken(email: string, now = Date.now()): string {
  const key = deriveKey()
  const payload = `${Buffer.from(email, 'utf8').toString('base64url')}.${now + CONFIRM_TTL_MS}`
  return `${payload}.${sign(key, payload)}`
}

/** Returns the confirmed address, or null for any malformed, forged or expired token. */
export function verifyNewsletterConfirmToken(token: unknown, now = Date.now()): string | null {
  if (typeof token !== 'string' || !token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [emailB64, expiresRaw, signature] = parts

  const expiresAt = Number(expiresRaw)
  if (!Number.isFinite(expiresAt) || now > expiresAt) return null

  let key: Buffer
  try {
    key = deriveKey()
  } catch {
    return null
  }
  if (!safeEqual(signature, sign(key, `${emailB64}.${expiresRaw}`))) return null

  const email = Buffer.from(emailB64, 'base64url').toString('utf8')
  return email || null
}
