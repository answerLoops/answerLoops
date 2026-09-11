import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// Set a valid 32-byte hex key before importing the module so getKey() sees it.
const TEST_KEY = 'a'.repeat(64)

beforeEach(() => {
  process.env.ENCRYPTION_KEY = TEST_KEY
})

afterEach(() => {
  delete process.env.ENCRYPTION_KEY
})

// Dynamic import so the env var is set before module-level code runs.
async function getModule() {
  return import('@/lib/crypto/tokens')
}

describe('encryptToken / decryptToken', () => {
  it('round-trips plaintext', async () => {
    const { encryptToken, decryptToken } = await getModule()
    const plaintext = 'sk-abc123supersecret'
    const cipher = encryptToken(plaintext)
    expect(decryptToken(cipher)).toBe(plaintext)
  })

  it('ciphertext starts with enc: prefix', async () => {
    const { encryptToken } = await getModule()
    expect(encryptToken('hello')).toMatch(/^enc:/)
  })

  it('each call produces a different ciphertext (random IV)', async () => {
    const { encryptToken } = await getModule()
    const a = encryptToken('same')
    const b = encryptToken('same')
    expect(a).not.toBe(b)
  })

  it('decryptToken returns plaintext unchanged when no enc: prefix', async () => {
    const { decryptToken } = await getModule()
    expect(decryptToken('plaintext-legacy-value')).toBe('plaintext-legacy-value')
  })

  it('decryptToken returns null for malformed enc: value', async () => {
    const { decryptToken } = await getModule()
    expect(decryptToken('enc:bad:data')).toBeNull()
  })

  it('decryptToken rejects tampered ciphertext', async () => {
    const { encryptToken, decryptToken } = await getModule()
    const cipher = encryptToken('secret')
    const parts = cipher.split(':')
    // Flip a byte in the data segment
    parts[3] = Buffer.from(parts[3], 'base64').reverse().toString('base64')
    expect(decryptToken(parts.join(':'))).toBeNull()
  })

  it('throws on invalid ENCRYPTION_KEY length', async () => {
    process.env.ENCRYPTION_KEY = 'tooshort'
    const { encryptToken } = await getModule()
    expect(() => encryptToken('x')).toThrow('ENCRYPTION_KEY must be a 64-char hex string')
    process.env.ENCRYPTION_KEY = TEST_KEY
  })

  it('falls back to plaintext when ENCRYPTION_KEY is absent (non-production)', async () => {
    delete process.env.ENCRYPTION_KEY
    const { encryptToken } = await getModule()
    expect(encryptToken('noop')).toBe('noop')
  })

  it('refuses to store a credential unencrypted when ENCRYPTION_KEY is absent in production', async () => {
    delete process.env.ENCRYPTION_KEY
    const prev = process.env.NODE_ENV
    // NODE_ENV is readonly in the types; assign through the record
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'production'
    try {
      const { encryptToken } = await getModule()
      expect(() => encryptToken('sk-live-secret')).toThrow(/ENCRYPTION_KEY is not set/)
    } finally {
      ;(process.env as Record<string, string | undefined>).NODE_ENV = prev
    }
  })

  it('decryptToken returns null for enc: value when key is absent', async () => {
    const { encryptToken } = await getModule()
    const cipher = encryptToken('secret') // key is set here
    delete process.env.ENCRYPTION_KEY
    const { decryptToken } = await getModule()
    expect(decryptToken(cipher)).toBeNull()
  })
})
