import { describe, it, expect, vi } from 'vitest'
import {
  assertImportableUrl,
  filterImportableUrls,
  parseImportUrl,
  UrlValidationError,
} from '@/lib/ingest/url-validation'

const publicResolver = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }])
const resolveTo = (...addresses: string[]) =>
  vi.fn(async () => addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })))

describe('parseImportUrl: scheme, port and credentials', () => {
  it.each(['https://example.com/docs', 'http://example.com', 'https://example.com:443/x', 'http://example.com:80/x', 'http://example.com:443/', 'https://example.com:80/'])(
    'accepts %s',
    (u) => {
      expect(() => parseImportUrl(u)).not.toThrow()
    },
  )

  it.each([
    'ftp://example.com/file',
    'file:///etc/hosts',
    'javascript:alert(1)',
    'data:text/html,hi',
    'gopher://example.com',
  ])('rejects the non-web scheme %s', (u) => {
    expect(() => parseImportUrl(u)).toThrow(UrlValidationError)
  })

  it.each([
    'https://example.com:8443/',
    'http://example.com:8080/',
    'https://example.com:22/',
    'https://example.com:6379/',
  ])('rejects the non-standard port in %s', (u) => {
    expect(() => parseImportUrl(u)).toThrow(/port/i)
  })

  it.each(['https://user@example.com/', 'https://user:pw@example.com/', 'https://:pw@example.com/'])(
    'rejects embedded credentials in %s',
    (u) => {
      expect(() => parseImportUrl(u)).toThrow(/username or password/)
    },
  )

  it('rejects text that is not a URL', () => {
    expect(() => parseImportUrl('not a url')).toThrow(UrlValidationError)
    expect(() => parseImportUrl('')).toThrow(UrlValidationError)
  })
})

describe('parseImportUrl: IP literals in every notation', () => {
  it.each([
    'http://127.0.0.1/',
    'http://10.0.0.5/',
    'http://8.8.8.8/',
    'http://2130706433/', // decimal
    'http://0x7f000001/', // hex
    'http://0x7f.0x0.0x0.0x1/', // dotted hex
    'http://017700000001/', // octal
    'http://0177.0.0.1/', // dotted octal
    'http://127.1/', // short form
    'http://127.0.1/',
    'http://0/',
    'http://0.0.0.0/',
    'http://169.254.169.254/latest/meta-data',
    'http://3232235777/', // 192.168.1.1 decimal
    'http://127.0.0.1./', // trailing dot
    'http://[::1]/',
    'http://[::]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:7f00:1]/',
    'http://[0:0:0:0:0:ffff:7f00:1]/',
    'http://[fe80::1]/',
    'http://[fd00::1]/',
    'http://[2001:db8::1]/',
    'http://[2606:4700:4700::1111]/', // public v6 is still a literal
    'https://[::1]:443/',
  ])('rejects the IP literal %s', (u) => {
    expect(() => parseImportUrl(u)).toThrow(UrlValidationError)
  })
})

describe('parseImportUrl: local host names', () => {
  it.each([
    'http://localhost/',
    'http://LOCALHOST/',
    'http://localhost./',
    'http://app.localhost/',
    'http://printer.local/',
    'http://db.internal/',
    'http://metadata.google.internal/',
    'http://metadata/',
    'http://instance-data/',
    'http://host.localdomain/',
    'http://router.home.arpa/',
  ])('rejects %s', (u) => {
    expect(() => parseImportUrl(u)).toThrow(UrlValidationError)
  })
})

describe('assertImportableUrl: DNS results', () => {
  it('returns the normalised address when every resolved address is public', async () => {
    await expect(assertImportableUrl('https://Example.com/a b', { resolver: publicResolver })).resolves.toBe(
      'https://example.com/a%20b',
    )
  })

  it.each([
    ['loopback', '127.0.0.1'],
    ['loopback elsewhere in /8', '127.5.5.5'],
    ['10/8', '10.1.2.3'],
    ['172.16/12', '172.16.0.1'],
    ['172.31 edge', '172.31.255.255'],
    ['192.168/16', '192.168.1.1'],
    ['link-local', '169.254.1.1'],
    ['link-local single host', '169.254.169.254'],
    ['CGNAT', '100.64.0.1'],
    ['CGNAT upper edge', '100.127.255.255'],
    ['unspecified', '0.0.0.0'],
    ['multicast', '224.0.0.1'],
    ['reserved', '240.0.0.1'],
    ['broadcast', '255.255.255.255'],
    ['v6 loopback', '::1'],
    ['v6 unspecified', '::'],
    ['v6 unique-local', 'fd12:3456::1'],
    ['v6 link-local', 'fe80::1'],
    ['v6 multicast', 'ff02::1'],
    ['v4-mapped loopback', '::ffff:127.0.0.1'],
    ['v4-mapped private', '::ffff:10.0.0.1'],
    ['v4-mapped link-local', '::ffff:169.254.169.254'],
    ['v6 documentation', '2001:db8::1'],
  ])('rejects a host that resolves to %s (%s)', async (_label, address) => {
    await expect(assertImportableUrl('https://docs.example.com/', { resolver: resolveTo(address) })).rejects.toBeInstanceOf(
      UrlValidationError,
    )
  })

  it('rejects when any one of several addresses is private', async () => {
    await expect(
      assertImportableUrl('https://docs.example.com/', { resolver: resolveTo('93.184.216.34', '10.0.0.7') }),
    ).rejects.toBeInstanceOf(UrlValidationError)
    await expect(
      assertImportableUrl('https://docs.example.com/', { resolver: resolveTo('2606:4700::1111', 'fd00::1') }),
    ).rejects.toBeInstanceOf(UrlValidationError)
  })

  it('accepts public v4 and v6 addresses', async () => {
    await expect(
      assertImportableUrl('https://docs.example.com/', { resolver: resolveTo('93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946') }),
    ).resolves.toContain('docs.example.com')
  })

  it('treats a DNS failure as a clean, user-facing error', async () => {
    const failing = vi.fn(async () => {
      throw Object.assign(new Error('getaddrinfo ENOTFOUND secret-internal-name'), { code: 'ENOTFOUND' })
    })
    const err = await assertImportableUrl('https://nope.example.com/', { resolver: failing }).catch((e) => e)
    expect(err).toBeInstanceOf(UrlValidationError)
    expect(err.message).toBe('We could not find that website. Check the address and try again.')
    expect(err.message).not.toContain('getaddrinfo')
  })

  it('treats an empty answer as a resolution failure', async () => {
    await expect(assertImportableUrl('https://nope.example.com/', { resolver: vi.fn(async () => []) })).rejects.toThrow(
      /could not find/,
    )
  })

  it('does not resolve a name that already fails the syntax rules', async () => {
    const resolver = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }])
    await expect(assertImportableUrl('http://localhost/', { resolver })).rejects.toBeInstanceOf(UrlValidationError)
    expect(resolver).not.toHaveBeenCalled()
  })

  it('skips DNS only when resolveDns is false, keeping the syntax rules', async () => {
    const resolver = vi.fn(async () => [{ address: '10.0.0.1', family: 4 }])
    await expect(assertImportableUrl('https://example.com/', { resolveDns: false, resolver })).resolves.toBe('https://example.com/')
    expect(resolver).not.toHaveBeenCalled()
    await expect(assertImportableUrl('http://127.0.0.1/', { resolveDns: false })).rejects.toBeInstanceOf(UrlValidationError)
  })
})

describe('filterImportableUrls', () => {
  it('keeps public pages, drops everything else, and counts the drops', async () => {
    const resolver = vi.fn(async (host: string) =>
      host === 'internal-lookalike.example.com'
        ? [{ address: '10.0.0.9', family: 4 }]
        : host === 'gone.example.com'
          ? Promise.reject(new Error('ENOTFOUND'))
          : [{ address: '93.184.216.34', family: 4 }],
    )
    const input = [
      'https://docs.example.com/a',
      'https://docs.example.com/b',
      'https://internal-lookalike.example.com/c',
      'https://gone.example.com/d',
      'http://127.0.0.1/e',
      'https://docs.example.com:8443/f',
      'ftp://docs.example.com/g',
      'https://user:pw@docs.example.com/h',
    ]
    const result = await filterImportableUrls(input, { resolver })
    expect(result.allowed).toEqual(['https://docs.example.com/a', 'https://docs.example.com/b'])
    expect(result.rejected).toBe(6)
  })

  it('resolves each distinct host once', async () => {
    const resolver = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }])
    await filterImportableUrls(
      ['https://a.example.com/1', 'https://a.example.com/2', 'https://b.example.com/1', 'https://A.example.com/3'],
      { resolver },
    )
    expect(resolver).toHaveBeenCalledTimes(2)
  })

  it('returns canonical addresses without duplicates, paired with the discovered spelling', async () => {
    const resolver = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }])
    const result = await filterImportableUrls(['https://Docs.Example.com', 'https://docs.example.com/#top'], { resolver })
    expect(result.allowed).toEqual(['https://docs.example.com/'])
    expect(result.entries).toEqual([{ raw: 'https://Docs.Example.com', canonical: 'https://docs.example.com/' }])
  })

  it('returns nothing for an empty list', async () => {
    await expect(filterImportableUrls([])).resolves.toEqual({ allowed: [], entries: [], rejected: 0 })
  })
})
