import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signActivitySnapshot, verifyActivitySnapshot } from '@/lib/tickets/activity-snapshot'

const snapshot = '2026-10-02T00:00:00.123456Z|10:12:10'

describe('activity snapshot signing', () => {
  beforeEach(() => vi.stubEnv('AUTH_SECRET', '<test-auth-secret>'))
  afterEach(() => vi.unstubAllEnvs())

  it('requires AUTH_SECRET for signing and verification', () => {
    const proof = signActivitySnapshot(snapshot, 3, 5)
    vi.stubEnv('AUTH_SECRET', undefined)
    vi.stubEnv('NEXTAUTH_SECRET', '<unused-auth-secret>')
    expect(() => signActivitySnapshot(snapshot, 3, 5)).toThrow('Authentication secret is unavailable')
    expect(() => verifyActivitySnapshot(snapshot, proof, 3, 5)).toThrow('Authentication secret is unavailable')
  })

  it.each([
    'invalid|10:12:10',
    '2026-10-02T00:00:00.123Z|10:12:10',
    '2026-02-30T00:00:00.123456Z|10:12:10',
    '2026-10-02T00:00:00.123456Z|invalid',
    `${snapshot}\n`,
  ])(
    'rejects a malformed snapshot even if it is signed', (malformed) => {
      expect(verifyActivitySnapshot(malformed, signActivitySnapshot(malformed, 3, 5), 3, 5)).toBe(false)
    }
  )

  it('rejects malformed proofs and proofs of the wrong length', () => {
    const proof = signActivitySnapshot(snapshot, 3, 5)
    expect(verifyActivitySnapshot(snapshot, proof, 3, 5)).toBe(true)
    for (const invalid of ['!' + proof.slice(1), proof.slice(1), proof + 'A', '']) {
      expect(verifyActivitySnapshot(snapshot, invalid, 3, 5)).toBe(false)
    }
  })
})
