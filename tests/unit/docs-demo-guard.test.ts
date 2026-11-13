import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  assertLocalDatabaseUrl,
  assertLocalEnvironment,
  checkLocalDatabaseUrl,
  checkLocalEnvironment,
} from '@/scripts/docs-demo/guard'
import { resolveBaseUrl, resolveStartPath } from '@/scripts/docs-demo/open'

/**
 * The docs demo seed wipes and re-creates a workspace, so the only thing
 * standing between it and a shared database is this guard. These cases cover
 * the connection strings it must accept and the look-alikes it must refuse.
 */

describe('checkLocalDatabaseUrl: accepted', () => {
  it.each([
    'postgres://community:community@localhost:5545/community',
    'postgresql://community:community@127.0.0.1:5432/community',
    'postgres://community:community@[::1]:5432/community',
    'postgres://community:community@postgres:5432/community',
    'postgres://community:community@LOCALHOST/community',
    'postgres://localhost/community?sslmode=disable',
  ])('allows %s', (url) => {
    expect(checkLocalDatabaseUrl(url).ok).toBe(true)
  })

  it('reports the matched host', () => {
    expect(checkLocalDatabaseUrl('postgres://u:p@localhost:5545/db')).toEqual({ ok: true, host: 'localhost' })
  })
})

describe('checkLocalDatabaseUrl: refused', () => {
  it.each([
    ['unset', undefined],
    ['null', null],
    ['empty', ''],
    ['whitespace', '   '],
    ['not a URL', 'localhost'],
    ['wrong protocol', 'mysql://u:p@localhost/db'],
    ['http protocol', 'http://localhost/db'],
    ['suffix look-alike', 'postgres://u:p@localhost.evil.com/db'],
    ['prefix look-alike', 'postgres://u:p@evil-localhost/db'],
    ['service name look-alike', 'postgres://u:p@postgres.internal.example.net/db'],
    ['service name suffix', 'postgres://u:p@postgres-prod/db'],
    ['userinfo trick', 'postgres://localhost@evil.com/db'],
    ['userinfo trick with password', 'postgres://localhost:5432@evil.com/db'],
    ['userinfo ip trick', 'postgres://127.0.0.1@evil.com/db'],
    ['localhost in path', 'postgres://evil.com/localhost'],
    ['localhost in query', 'postgres://evil.com/db?host=localhost'],
    ['host override in query', 'postgres://localhost/db?host=evil.com'],
    ['hostaddr override in query', 'postgres://localhost/db?hostaddr=203.0.113.9'],
    ['port override in query', 'postgres://localhost/db?port=5432'],
    ['multi host', 'postgres://localhost,evil.com/db'],
    ['hosted provider', 'postgres://postgres:pw@db.abcdefghij.supabase.co:5432/postgres'],
    ['pooled provider', 'postgres://u:p@aws-0-us-east-1.pooler.supabase.com:6543/postgres'],
    ['public ip', 'postgres://u:p@203.0.113.7:5432/db'],
    ['0.0.0.0', 'postgres://u:p@0.0.0.0:5432/db'],
    ['localhost ipv6 long form', 'postgres://u:p@[2001:db8::1]:5432/db'],
  ])('refuses %s', (_name, url) => {
    expect(checkLocalDatabaseUrl(url as string | null | undefined).ok).toBe(false)
  })
})

describe('assertLocalDatabaseUrl', () => {
  it('does not throw for a local URL', () => {
    expect(() => assertLocalDatabaseUrl('postgres://u:p@localhost:5545/db')).not.toThrow()
  })

  it('throws a message naming the label and never echoing the credentials', () => {
    const url = 'postgres://admin:PASSWORD_SENTINEL@db.example.net:5432/prod'
    let message = ''
    try {
      assertLocalDatabaseUrl(url, 'DIRECT_DATABASE_URL')
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toContain('DIRECT_DATABASE_URL')
    expect(message).toContain('Refusing')
    expect(message).not.toContain('PASSWORD_SENTINEL')
  })
})

describe('checkLocalEnvironment', () => {
  it('accepts a normal development machine', () => {
    expect(checkLocalEnvironment({ NODE_ENV: 'development' }).ok).toBe(true)
    expect(checkLocalEnvironment({}).ok).toBe(true)
    expect(checkLocalEnvironment({ NODE_ENV: 'test' }).ok).toBe(true)
  })

  it('refuses production mode', () => {
    expect(checkLocalEnvironment({ NODE_ENV: 'production' }).ok).toBe(false)
  })

  it.each([
    'RAILWAY_ENVIRONMENT',
    'RAILWAY_PROJECT_ID',
    'RAILWAY_SERVICE_ID',
    'VERCEL',
    'VERCEL_ENV',
    'FLY_APP_NAME',
    'RENDER',
    'K_SERVICE',
    'DYNO',
    'KUBERNETES_SERVICE_HOST',
  ])('refuses a hosted environment marked by %s', (name) => {
    const result = checkLocalEnvironment({ NODE_ENV: 'development', [name]: 'x' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain(name)
  })

  it('ignores a blank marker value', () => {
    expect(checkLocalEnvironment({ RAILWAY_ENVIRONMENT: '  ' }).ok).toBe(true)
  })

  it('throws from the assert form with a clear message', () => {
    expect(() => assertLocalEnvironment({ NODE_ENV: 'production' })).toThrow(/local development machine/)
  })
})

describe('demo:open helpers', () => {
  it.each([
    [undefined, '/dashboard'],
    ['/integrations', '/integrations'],
    ['/tickets/3', '/tickets/3'],
    ['/integrations?tab=circle', '/integrations?tab=circle'],
    ['//evil.example', '/dashboard'],
    ['https://evil.example/x', '/dashboard'],
    ['javascript:alert(1)', '/dashboard'],
    ['integrations', '/dashboard'],
  ])('resolves %j to %j', (arg, expected) => {
    expect(resolveStartPath(arg)).toBe(expected)
  })

  it('opens only a local app', () => {
    expect(resolveBaseUrl(undefined).origin).toBe('http://localhost:3112')
    expect(resolveBaseUrl('http://localhost:3000/').origin).toBe('http://localhost:3000')
    expect(resolveBaseUrl('http://127.0.0.1:3112').hostname).toBe('127.0.0.1')
  })

  it.each([
    'https://app.answerloops.com',
    'http://localhost.example.net',
    'http://example.com',
    'http://localhost@evil.example',
  ])('refuses %s', (url) => {
    expect(() => resolveBaseUrl(url)).toThrow(/local app/)
  })
})

describe('demo tooling stays outside the app', () => {
  const read = (file: string) => readFile(path.join(process.cwd(), file), 'utf8')

  it('guards every script that writes data or mints a session', async () => {
    for (const file of ['seed.ts', 'session.ts', 'open.ts']) {
      const source = await read(`scripts/docs-demo/${file}`)
      expect(source, file).toContain('assertLocalEnvironment()')
      expect(source, file).toContain('assertLocalDatabaseUrl(')
    }
  })

  it('adds no mock or credentials sign-in to the app', async () => {
    const auth = await read('auth.ts')
    expect(auth).not.toMatch(/Credentials/i)
    expect(auth).not.toMatch(/docs-demo|demo:open|mock.?login/i)
  })

  it('is never imported by application code', async () => {
    for (const file of ['auth.ts', 'instrumentation.ts', 'next.config.ts', 'lib/auth/providers.ts']) {
      expect(await read(file), file).not.toContain('scripts/docs-demo')
    }
  })
})
