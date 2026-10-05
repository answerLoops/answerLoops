import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'

/**
 * lib/widget/render-token.ts — closes Known Issue 114.
 *
 * The widget's origin allowlist (lib/widget/origin.ts) can only be checked on
 * the iframe page render, since that's the only request carrying the
 * embedding page's identity. The embed token used on every later call is
 * public in page source, so without something binding those later calls back
 * to a render that actually passed the allowlist, anyone who copies the token
 * out of a page's HTML can call /api/widget/chat or /api/widget/lead directly
 * — no iframe, no Referer — and drive billed usage from anywhere.
 */

const TOKEN = 'a'.repeat(48)
const OTHER_TOKEN = 'b'.repeat(48)

beforeEach(() => {
  process.env.AUTH_SECRET = 'test-auth-secret-value'
})

afterEach(() => {
  delete process.env.AUTH_SECRET
  vi.useRealTimers()
})

describe('mintRenderToken / verifyRenderToken', () => {
  it('a freshly minted token verifies for the widgetToken it was minted for', async () => {
    const { mintRenderToken, verifyRenderToken } = await import('@/lib/widget/render-token')
    const token = mintRenderToken(TOKEN)
    expect(verifyRenderToken(token, TOKEN)).toBe(true)
  })

  it('rejects a token minted for a different widgetToken', async () => {
    const { mintRenderToken, verifyRenderToken } = await import('@/lib/widget/render-token')
    const token = mintRenderToken(TOKEN)
    expect(verifyRenderToken(token, OTHER_TOKEN)).toBe(false)
  })

  it('rejects an expired token', async () => {
    vi.useFakeTimers()
    const { mintRenderToken, verifyRenderToken } = await import('@/lib/widget/render-token')
    const token = mintRenderToken(TOKEN)
    vi.advanceTimersByTime(6 * 60_000) // past the 5-minute TTL
    expect(verifyRenderToken(token, TOKEN)).toBe(false)
  })

  it('rejects a tampered signature', async () => {
    const { mintRenderToken, verifyRenderToken } = await import('@/lib/widget/render-token')
    const token = mintRenderToken(TOKEN)
    const [payload] = token.split('.')
    expect(verifyRenderToken(`${payload}.forged-signature`, TOKEN)).toBe(false)
  })

  it('rejects a tampered payload even with a structurally valid signature from another token', async () => {
    const { mintRenderToken, verifyRenderToken } = await import('@/lib/widget/render-token')
    const tokenA = mintRenderToken(TOKEN)
    const tokenB = mintRenderToken(OTHER_TOKEN)
    const [, sigB] = tokenB.split('.')
    const [payloadA] = tokenA.split('.')
    // Mixing payload A with signature B should verify against neither widgetToken.
    expect(verifyRenderToken(`${payloadA}.${sigB}`, TOKEN)).toBe(false)
    expect(verifyRenderToken(`${payloadA}.${sigB}`, OTHER_TOKEN)).toBe(false)
  })

  it('rejects malformed input rather than throwing', async () => {
    const { verifyRenderToken } = await import('@/lib/widget/render-token')
    expect(verifyRenderToken(undefined, TOKEN)).toBe(false)
    expect(verifyRenderToken('', TOKEN)).toBe(false)
    expect(verifyRenderToken('not-a-token', TOKEN)).toBe(false)
    expect(verifyRenderToken('too.many.parts', TOKEN)).toBe(false)
    expect(verifyRenderToken(123, TOKEN)).toBe(false)
  })

  it('fails closed — rather than open like Known Issue 114 — when AUTH_SECRET is unset', async () => {
    const { mintRenderToken, verifyRenderToken } = await import('@/lib/widget/render-token')
    const token = mintRenderToken(TOKEN)
    delete process.env.AUTH_SECRET
    expect(() => mintRenderToken(TOKEN)).toThrow(/AUTH_SECRET/)
    expect(verifyRenderToken(token, TOKEN)).toBe(false)
  })

  it('two tokens minted for the same widgetToken are not identical (fresh expiry each time)', async () => {
    vi.useFakeTimers()
    const { mintRenderToken } = await import('@/lib/widget/render-token')
    const first = mintRenderToken(TOKEN)
    vi.advanceTimersByTime(1000)
    const second = mintRenderToken(TOKEN)
    expect(first).not.toBe(second)
  })
})
