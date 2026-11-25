import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  MIN_AUTH_SECRET_LENGTH,
  assertAuthSecretForProduction,
  checkAuthSecret,
} from '@/lib/auth/secret'

const strong = () => randomBytes(32).toString('hex')

describe('checkAuthSecret', () => {
  it('accepts the 64-character hex value the setup docs and agent CLI generate', () => {
    expect(checkAuthSecret(strong())).toEqual({ ok: true })
  })

  it('accepts a base64 secret of 32 random bytes', () => {
    expect(checkAuthSecret(randomBytes(32).toString('base64'))).toEqual({ ok: true })
  })

  it('accepts a value exactly at the minimum length', () => {
    expect(checkAuthSecret(randomBytes(16).toString('hex'))).toEqual({ ok: true })
  })

  it.each([undefined, null, '', '   '])('rejects a missing value: %j', (value) => {
    expect(checkAuthSecret(value)).toEqual({ ok: false, reason: 'AUTH_SECRET is not set.' })
  })

  it('rejects a value one character under the minimum', () => {
    const result = checkAuthSecret(randomBytes(16).toString('hex').slice(0, MIN_AUTH_SECRET_LENGTH - 1))
    expect(result.ok).toBe(false)
  })

  it('rejects documented placeholder values even when padded past the minimum length', () => {
    for (const value of [
      'test-auth-secret',
      'test-auth-secret-value-with-extra-padding-here',
      'CHANGEME'.padEnd(40, 'x'),
      'your-auth-secret'.padEnd(40, '1'),
      'example-secret-value-0123456789abcdef',
    ]) {
      expect(checkAuthSecret(value).ok, value).toBe(false)
    }
  })

  it('rejects angle-bracket placeholders', () => {
    expect(checkAuthSecret('<run: openssl rand -hex 32>').ok).toBe(false)
    expect(checkAuthSecret(`<${'a1b2c3d4'.repeat(5)}>`).ok).toBe(false)
  })

  it('rejects long values made of a repeated character or short pattern', () => {
    expect(checkAuthSecret('a'.repeat(64)).ok).toBe(false)
    expect(checkAuthSecret('abab'.repeat(16)).ok).toBe(false)
  })

  it('ignores surrounding whitespace when measuring length', () => {
    expect(checkAuthSecret(`  ${'a1'.repeat(5)}  `).ok).toBe(false)
  })

  it('never includes the secret in its reason', () => {
    const secret = 'short-but-unique-9f8e7d'
    const result = checkAuthSecret(secret)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).not.toContain(secret)
  })
})

describe('assertAuthSecretForProduction', () => {
  it('throws in production for a missing, short or placeholder secret', () => {
    for (const AUTH_SECRET of [undefined, 'short', 'test-auth-secret', 'a'.repeat(64)]) {
      expect(() => assertAuthSecretForProduction({ NODE_ENV: 'production', AUTH_SECRET }), String(AUTH_SECRET)).toThrow(
        /AUTH_SECRET/,
      )
    }
  })

  it('tells the operator how to fix it without echoing the configured value', () => {
    const configured = 'tiny-9f8e7d'
    let message = ''
    try {
      assertAuthSecretForProduction({ NODE_ENV: 'production', AUTH_SECRET: configured })
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toContain('openssl rand -hex 32')
    expect(message).not.toContain(configured)
  })

  it('passes in production with a strong secret', () => {
    expect(() => assertAuthSecretForProduction({ NODE_ENV: 'production', AUTH_SECRET: strong() })).not.toThrow()
  })

  it.each(['development', 'test', undefined])('does not apply outside production (NODE_ENV=%s)', (NODE_ENV) => {
    expect(() => assertAuthSecretForProduction({ NODE_ENV, AUTH_SECRET: 'x' })).not.toThrow()
    expect(() => assertAuthSecretForProduction({ NODE_ENV })).not.toThrow()
  })
})

describe('register() at production start', () => {
  afterEach(() => vi.unstubAllEnvs())

  it.each([undefined, 'short', 'test-auth-secret'])('refuses to start with AUTH_SECRET=%s', async (secret) => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
    vi.stubEnv('AUTH_SECRET', secret as string)
    const { register } = await import('@/instrumentation')

    await expect(register()).rejects.toThrow(/AUTH_SECRET/)
  })
})

describe('wiring', () => {
  const read = (file: string) => readFile(path.join(process.cwd(), file), 'utf8')

  it('runs the check at server start, before migrations or anything else touches the database', async () => {
    const source = await read('instrumentation.ts')
    const check = source.indexOf('assertAuthSecretForProduction()')
    const migrate = source.indexOf('runMigrations()')

    expect(check, 'instrumentation.ts does not call the check').toBeGreaterThan(-1)
    expect(check).toBeLessThan(migrate)
  })

  it('keeps the e2e server, a production build, on a generated secret instead of a placeholder', async () => {
    const source = await read('playwright.config.ts')

    expect(source).not.toContain("'test-auth-secret'")
    expect(source).toContain("randomBytes(32).toString('hex')")
  })

  it('states the requirement where operators read it', async () => {
    for (const file of [
      'content/docs/reference/environment-variables.mdx',
      'content/docs/self-hosting/environment-variables.mdx',
      'content/docs/self-hosting/production.mdx',
    ]) {
      expect(await read(file), file).toMatch(/32 characters/)
    }
  })
})
