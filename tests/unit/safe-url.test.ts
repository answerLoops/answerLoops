import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup: h.lookup }))

import { assertPublicHttpsUrl, isNonPublicAddress, UnsafeUrlError } from '@/lib/http/safe-url'

function dnsReturns(...addresses: string[]) {
  h.lookup.mockResolvedValue(addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('ALLOW_PRIVATE_OUTBOUND_URLS', '')
  vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
  dnsReturns('93.184.216.34')
})

describe('assertPublicHttpsUrl: self-hosted installs', () => {
  beforeEach(() => {
    vi.stubEnv('DEPLOYMENT_MODE', 'self-hosted')
  })

  it('allows http and private or loopback hosts such as a local Ollama server', async () => {
    await expect(assertPublicHttpsUrl('http://localhost:11434/v1')).resolves.toBeInstanceOf(URL)
    await expect(assertPublicHttpsUrl('http://192.168.1.20:1234/v1')).resolves.toBeInstanceOf(URL)
    dnsReturns('172.17.0.1')
    await expect(assertPublicHttpsUrl('http://host.docker.internal:11434/v1')).resolves.toBeInstanceOf(URL)
  })

  it('treats an unset DEPLOYMENT_MODE as self-hosted', async () => {
    vi.stubEnv('DEPLOYMENT_MODE', '')
    await expect(assertPublicHttpsUrl('http://localhost:11434/v1')).resolves.toBeInstanceOf(URL)
  })

  it('still rejects credentials, link-local and cloud metadata targets', async () => {
    await expect(assertPublicHttpsUrl('http://user:pw@localhost/')).rejects.toBeInstanceOf(UnsafeUrlError)
    await expect(assertPublicHttpsUrl('http://169.254.169.254/latest')).rejects.toBeInstanceOf(UnsafeUrlError)
    await expect(assertPublicHttpsUrl('http://[fe80::1]/')).rejects.toBeInstanceOf(UnsafeUrlError)
    await expect(assertPublicHttpsUrl('http://metadata.google.internal/')).rejects.toBeInstanceOf(UnsafeUrlError)
    dnsReturns('169.254.169.254')
    await expect(assertPublicHttpsUrl('http://rebind.example.com/')).rejects.toBeInstanceOf(UnsafeUrlError)
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('assertPublicHttpsUrl: accepted', () => {
  it('accepts an https host that resolves to a public address and returns the URL', async () => {
    const url = await assertPublicHttpsUrl('https://forum.example.com/path?q=1')
    expect(url.hostname).toBe('forum.example.com')
  })

  it('accepts a public IPv4 and a public IPv6 literal without DNS', async () => {
    await expect(assertPublicHttpsUrl('https://93.184.216.34/')).resolves.toBeInstanceOf(URL)
    await expect(assertPublicHttpsUrl('https://[2606:4700:4700::1111]/')).resolves.toBeInstanceOf(URL)
    expect(h.lookup).not.toHaveBeenCalled()
  })

  it('accepts a host with both public A and public AAAA records', async () => {
    dnsReturns('93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946')
    await expect(assertPublicHttpsUrl('https://dual.example.com')).resolves.toBeInstanceOf(URL)
  })
})

describe('assertPublicHttpsUrl: scheme and shape', () => {
  it.each([
    'http://forum.example.com',
    'ftp://forum.example.com',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'not a url',
    '',
    '//forum.example.com',
  ])('rejects %s', async (raw) => {
    await expect(assertPublicHttpsUrl(raw)).rejects.toBeInstanceOf(UnsafeUrlError)
  })

  it('rejects credentials in the URL', async () => {
    await expect(assertPublicHttpsUrl('https://user:pass@forum.example.com')).rejects.toBeInstanceOf(UnsafeUrlError)
    await expect(assertPublicHttpsUrl('https://user@forum.example.com')).rejects.toBeInstanceOf(UnsafeUrlError)
  })

  it('judges the real host when userinfo is used to disguise it', async () => {
    await expect(assertPublicHttpsUrl('https://forum.example.com@127.0.0.1/')).rejects.toBeInstanceOf(UnsafeUrlError)
    await expect(assertPublicHttpsUrl('https://forum.example.com:443@169.254.169.254/')).rejects.toBeInstanceOf(UnsafeUrlError)
    // A backslash ends the authority, so the host here is 127.0.0.1.
    await expect(assertPublicHttpsUrl('https://127.0.0.1\\@forum.example.com/')).rejects.toBeInstanceOf(UnsafeUrlError)
    await expect(assertPublicHttpsUrl('https://127.0.0.1#@forum.example.com/')).rejects.toBeInstanceOf(UnsafeUrlError)
  })
})

describe('assertPublicHttpsUrl: IP literal forms', () => {
  it.each([
    'https://127.0.0.1/',
    'https://127.1/',
    'https://0.0.0.0/',
    'https://0/',
    'https://10.0.0.5/',
    'https://172.16.0.1/',
    'https://172.31.255.255/',
    'https://192.168.1.1/',
    'https://169.254.169.254/latest/meta-data',
    'https://169.254.0.1/',
    'https://100.64.0.1/',
    'https://100.127.255.255/',
    'https://224.0.0.1/',
    'https://255.255.255.255/',
    'https://198.18.0.1/',
    'https://192.0.0.1/',
    // decimal, hex and octal spellings normalize to dotted quad
    'https://2130706433/',
    'https://0x7f000001/',
    'https://0x7f.0.0.1/',
    'https://017700000001/',
    'https://0177.0.0.1/',
    'https://2852039166/',
    'https://0xA9FEA9FE/',
    // IPv6
    'https://[::1]/',
    'https://[::]/',
    'https://[fe80::1]/',
    'https://[fc00::1]/',
    'https://[fd12:3456:789a::1]/',
    'https://[ff02::1]/',
    'https://[::ffff:127.0.0.1]/',
    'https://[::ffff:7f00:1]/',
    'https://[::ffff:169.254.169.254]/',
    'https://[::ffff:93.184.216.34]/',
    'https://[64:ff9b::7f00:1]/',
    'https://[2001:db8::1]/',
    'https://[2002:7f00:1::1]/',
    'https://[2002:a9fe:a9fe::1]/',
    'https://[fec0::1]/',
  ])('rejects %s', async (raw) => {
    await expect(assertPublicHttpsUrl(raw)).rejects.toBeInstanceOf(UnsafeUrlError)
    expect(h.lookup).not.toHaveBeenCalled()
  })

  it('does not reject public addresses adjacent to private ranges', async () => {
    await expect(assertPublicHttpsUrl('https://172.15.0.1/')).resolves.toBeInstanceOf(URL)
    await expect(assertPublicHttpsUrl('https://172.32.0.1/')).resolves.toBeInstanceOf(URL)
    await expect(assertPublicHttpsUrl('https://100.63.0.1/')).resolves.toBeInstanceOf(URL)
    await expect(assertPublicHttpsUrl('https://100.128.0.1/')).resolves.toBeInstanceOf(URL)
    await expect(assertPublicHttpsUrl('https://169.253.0.1/')).resolves.toBeInstanceOf(URL)
    await expect(assertPublicHttpsUrl('https://[2002:5db8:d822::1]/')).resolves.toBeInstanceOf(URL)
  })
})

describe('assertPublicHttpsUrl: DNS results', () => {
  it.each([
    ['loopback', '127.0.0.1'],
    ['rfc1918', '10.1.2.3'],
    ['metadata', '169.254.169.254'],
    ['cgnat', '100.64.1.1'],
    ['ipv6 loopback', '::1'],
    ['ipv6 ula', 'fd00::5'],
    ['ipv4-mapped ipv6', '::ffff:10.0.0.1'],
    ['unspecified', '0.0.0.0'],
  ])('rejects a hostname resolving to %s', async (_label, address) => {
    dnsReturns(address)
    await expect(assertPublicHttpsUrl('https://evil.example.com')).rejects.toBeInstanceOf(UnsafeUrlError)
  })

  it('rejects when any address is private (mixed public + private A records)', async () => {
    dnsReturns('93.184.216.34', '10.0.0.7')
    await expect(assertPublicHttpsUrl('https://mixed.example.com')).rejects.toBeInstanceOf(UnsafeUrlError)
  })

  it('rejects when only the AAAA record is private (public A + ULA AAAA)', async () => {
    dnsReturns('93.184.216.34', 'fd00::1')
    await expect(assertPublicHttpsUrl('https://mixed6.example.com')).rejects.toBeInstanceOf(UnsafeUrlError)
  })

  it('asks DNS for every address family', async () => {
    await assertPublicHttpsUrl('https://forum.example.com')
    expect(h.lookup).toHaveBeenCalledWith('forum.example.com', expect.objectContaining({ all: true }))
  })

  it('rejects when the host does not resolve or resolves to nothing', async () => {
    h.lookup.mockRejectedValue(new Error('ENOTFOUND'))
    await expect(assertPublicHttpsUrl('https://nope.example.com')).rejects.toBeInstanceOf(UnsafeUrlError)
    h.lookup.mockResolvedValue([])
    await expect(assertPublicHttpsUrl('https://empty.example.com')).rejects.toBeInstanceOf(UnsafeUrlError)
  })

  it.each([
    'https://localhost/',
    'https://app.localhost/',
    'https://metadata.google.internal/',
    'https://db.internal/',
    'https://printer.local/',
  ])('rejects reserved hostname %s without resolving', async (raw) => {
    await expect(assertPublicHttpsUrl(raw)).rejects.toBeInstanceOf(UnsafeUrlError)
    expect(h.lookup).not.toHaveBeenCalled()
  })
})

describe('private-network opt-out', () => {
  it('allows loopback http when the flag is set outside production', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('ALLOW_PRIVATE_OUTBOUND_URLS', 'true')
    await expect(assertPublicHttpsUrl('http://127.0.0.1:11434/v1')).resolves.toBeInstanceOf(URL)
  })

  it('still rejects credentials when the flag is set', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('ALLOW_PRIVATE_OUTBOUND_URLS', 'true')
    await expect(assertPublicHttpsUrl('http://u:p@127.0.0.1/')).rejects.toBeInstanceOf(UnsafeUrlError)
  })

  it('ignores the flag in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ALLOW_PRIVATE_OUTBOUND_URLS', 'true')
    await expect(assertPublicHttpsUrl('http://127.0.0.1/')).rejects.toBeInstanceOf(UnsafeUrlError)
    await expect(assertPublicHttpsUrl('https://127.0.0.1/')).rejects.toBeInstanceOf(UnsafeUrlError)
  })

  it('is off unless the value is exactly "true"', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('ALLOW_PRIVATE_OUTBOUND_URLS', '1')
    await expect(assertPublicHttpsUrl('https://127.0.0.1/')).rejects.toBeInstanceOf(UnsafeUrlError)
  })
})

describe('isNonPublicAddress', () => {
  it('treats unparseable input as non-public', () => {
    expect(isNonPublicAddress('not-an-ip')).toBe(true)
    expect(isNonPublicAddress('')).toBe(true)
  })
  it('classifies representative addresses', () => {
    expect(isNonPublicAddress('8.8.8.8')).toBe(false)
    expect(isNonPublicAddress('2001:4860:4860::8888')).toBe(false)
    expect(isNonPublicAddress('::ffff:8.8.8.8')).toBe(true)
  })
})
