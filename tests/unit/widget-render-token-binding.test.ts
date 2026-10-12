import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mintRenderToken, verifyRenderToken } from '@/lib/widget/render-token'

const TOKEN = 'a'.repeat(48)

describe('render token client-address binding', () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = '<test-auth-secret>'
  })
  afterEach(() => {
    delete process.env.AUTH_SECRET
  })

  it('verifies from the address it was minted for and not from another', () => {
    const t = mintRenderToken(TOKEN, '203.0.113.7')
    expect(verifyRenderToken(t, TOKEN, '203.0.113.7')).toBe(true)
    expect(verifyRenderToken(t, TOKEN, '203.0.113.8')).toBe(false)
  })

  it('treats addresses in the same IPv6 /64 as one client', () => {
    const t = mintRenderToken(TOKEN, '2001:db8:1:2:aaaa:bbbb:cccc:dddd')
    expect(verifyRenderToken(t, TOKEN, '2001:db8:1:2::1')).toBe(true)
    expect(verifyRenderToken(t, TOKEN, '2001:db8:1:3::1')).toBe(false)
  })

  it('does not let an unbound token pass a bound check, or vice versa', () => {
    const unbound = mintRenderToken(TOKEN)
    const bound = mintRenderToken(TOKEN, '203.0.113.7')
    expect(verifyRenderToken(unbound, TOKEN, '203.0.113.7')).toBe(false)
    expect(verifyRenderToken(bound, TOKEN)).toBe(false)
  })
})
