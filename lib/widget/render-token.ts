import crypto from 'crypto'

/**
 * Binds the widget's spend-triggering API calls (chat, lead capture) to the
 * one render that actually checked the embedding origin — see
 * lib/widget/origin.ts and app/widget/[widgetToken]/page.tsx.
 *
 * Without this, the origin allowlist only ever gates the iframe page itself.
 * The embed token is public (it ships in page HTML by design), so anyone who
 * copies it out of page source can call /api/widget/chat or /api/widget/lead
 * directly — no iframe, no Referer, no allowlist check in the path at all —
 * and drive billed usage against the org's quota from anywhere. Minting a
 * short-lived signed token only on a render that passed isEmbedAllowed(), and
 * requiring it on every downstream call, closes that: a caller who never
 * passed the origin check has nothing valid to present.
 *
 * Derived from AUTH_SECRET (already required in production by auth.ts) rather
 * than a new env var, specifically so there is no unconfigured state that
 * silently disables this the way ORIGIN_VERIFY_SECRET did — see Known Issue
 * 114. A domain-separation label keyes the derivation so this token type
 * can never be confused with (or forged via knowledge of how to compute) a
 * session JWT signature.
 */
const RENDER_TOKEN_TTL_MS = 5 * 60_000

function deriveKey(): Buffer {
  const secret = process.env.AUTH_SECRET
  if (!secret) {
    throw new Error('AUTH_SECRET is not set — cannot mint or verify widget render tokens.')
  }
  return crypto.createHmac('sha256', secret).update('widget-render-token-v1').digest()
}

function sign(key: Buffer, payload: string): string {
  return crypto.createHmac('sha256', key).update(payload).digest('base64url')
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const digestA = crypto.createHash('sha256').update(a).digest()
  const digestB = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(digestA, digestB)
}

/** Mint a token proving this widgetToken's current render passed the origin allowlist. */
export function mintRenderToken(widgetToken: string): string {
  const key = deriveKey()
  const expiresAt = Date.now() + RENDER_TOKEN_TTL_MS
  const payload = `${widgetToken}.${expiresAt}`
  const payloadB64 = Buffer.from(payload, 'utf8').toString('base64url')
  return `${payloadB64}.${sign(key, payload)}`
}

/** Verify a render token was minted for this exact widgetToken and has not expired. */
export function verifyRenderToken(token: unknown, widgetToken: string): boolean {
  if (typeof token !== 'string' || !token) return false

  const parts = token.split('.')
  if (parts.length !== 2) return false
  const [payloadB64, signature] = parts

  let payload: string
  try {
    payload = Buffer.from(payloadB64, 'base64url').toString('utf8')
  } catch {
    return false
  }

  const [tokenWidgetToken, expiresAtRaw] = payload.split('.')
  const expiresAt = Number(expiresAtRaw)
  if (!tokenWidgetToken || !Number.isFinite(expiresAt)) return false
  if (tokenWidgetToken !== widgetToken) return false
  if (Date.now() > expiresAt) return false

  let key: Buffer
  try {
    key = deriveKey()
  } catch {
    return false
  }
  return timingSafeStringEqual(signature, sign(key, payload))
}
