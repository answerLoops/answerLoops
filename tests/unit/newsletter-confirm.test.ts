import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  mintNewsletterConfirmToken,
  verifyNewsletterConfirmToken,
} from '@/lib/newsletter/confirm-token'

describe('newsletter confirmation token', () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = '<test-auth-secret>'
  })
  afterEach(() => {
    delete process.env.AUTH_SECRET
  })

  it('round-trips the address', () => {
    const token = mintNewsletterConfirmToken('reader@example.com')
    expect(verifyNewsletterConfirmToken(token)).toBe('reader@example.com')
  })

  it('rejects an expired token', () => {
    const token = mintNewsletterConfirmToken('reader@example.com', Date.now() - 49 * 3_600_000)
    expect(verifyNewsletterConfirmToken(token)).toBeNull()
  })

  it('rejects a token whose address was swapped', () => {
    const [, exp, sig] = mintNewsletterConfirmToken('reader@example.com').split('.')
    const forgedEmail = Buffer.from('victim@example.com').toString('base64url')
    expect(verifyNewsletterConfirmToken(`${forgedEmail}.${exp}.${sig}`)).toBeNull()
  })

  it('rejects malformed input', () => {
    for (const bad of [undefined, '', 'x', 'a.b', 'a.b.c.d', 42]) {
      expect(verifyNewsletterConfirmToken(bad)).toBeNull()
    }
  })

  it('rejects everything when the signing secret is missing', () => {
    const token = mintNewsletterConfirmToken('reader@example.com')
    delete process.env.AUTH_SECRET
    expect(verifyNewsletterConfirmToken(token)).toBeNull()
  })
})
