import { describe, expect, it } from 'vitest'
import { assertLocalDatabaseUrl, checkLocalDatabaseUrl } from '@/scripts/docs-demo/guard'

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
