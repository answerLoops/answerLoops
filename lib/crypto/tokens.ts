import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LEN = 12

function getKey(): Buffer | null {
  const hex = process.env.ENCRYPTION_KEY
  if (!hex) return null
  if (hex.length !== 64) throw new Error('ENCRYPTION_KEY must be a 64-char hex string (32 bytes). Generate one: openssl rand -hex 32')
  return Buffer.from(hex, 'hex')
}

export function encryptToken(plaintext: string): string {
  const key = getKey()
  if (!key) {
    // A missing key in production means this credential — an AI provider key, a
    // bot token, a webhook secret — gets written to the database in cleartext
    // with no error. The plaintext path is a local-dev convenience only; fail
    // loud anywhere it actually matters.
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'ENCRYPTION_KEY is not set — refusing to store a credential unencrypted. Generate one: openssl rand -hex 32'
      )
    }
    return plaintext
  }

  const iv = crypto.randomBytes(IV_LEN)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `enc:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`
}

export function decryptToken(value: string): string | null {
  if (!value.startsWith('enc:')) return value // plaintext (pre-encryption or no key)

  const key = getKey()
  if (!key) return null // encrypted value but no key — require re-entry

  try {
    const [, ivB64, tagB64, dataB64] = value.split(':')
    if (!ivB64 || !tagB64 || !dataB64) return null
    const iv = Buffer.from(ivB64, 'base64')
    const tag = Buffer.from(tagB64, 'base64')
    const data = Buffer.from(dataB64, 'base64')
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: 16 })
    decipher.setAuthTag(tag)
    return decipher.update(data).toString('utf8') + decipher.final('utf8')
  } catch {
    return null
  }
}
