import { createHash, randomBytes } from 'node:crypto'

/** Hex SHA-256 digest used to look up an integration by its shared secret. */
export function hashBotSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex')
}

/** A fresh random per-integration secret (256 bits, hex encoded). */
export function generateBotSecret(): string {
  return randomBytes(32).toString('hex')
}
