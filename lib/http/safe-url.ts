import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/**
 * Validation for URLs that a tenant (or a webhook payload) supplies and the
 * server then fetches. A URL passes only when it is https, carries no
 * credentials, and every address its hostname resolves to (A and AAAA) is a
 * public, globally routable address.
 *
 * Local development and tests can opt out with ALLOW_PRIVATE_OUTBOUND_URLS=true.
 * The opt-out is ignored whenever NODE_ENV is "production". Installs that are
 * not DEPLOYMENT_MODE=cloud may also use http and hosts on their own network;
 * link-local and cloud-metadata addresses are rejected either way.
 */

export class UnsafeUrlError extends Error {
  constructor(message = 'URL is not allowed') {
    super(message)
    this.name = 'UnsafeUrlError'
  }
}

export function privateOutboundAllowed(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.ALLOW_PRIVATE_OUTBOUND_URLS === 'true'
}

/**
 * Self-hosted installs (anything other than DEPLOYMENT_MODE=cloud) may point
 * integrations and AI providers at hosts on their own network, such as a local
 * Ollama server. Link-local and cloud-metadata addresses stay blocked.
 */
function selfHostedLocalAllowed(): boolean {
  return process.env.DEPLOYMENT_MODE !== 'cloud'
}

function isLinkLocalOrMetadata(ip: string): boolean {
  if (isIP(ip) === 4) return ip.startsWith('169.254.')
  const lower = ip.toLowerCase()
  return /^fe[89ab]/.test(lower) || lower === 'fd00:ec2::254' || lower.startsWith('::ffff:169.254.')
}

// ── IPv4 ────────────────────────────────────────────────────────────────

function parseIPv4(ip: string): number[] | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  const out: number[] = []
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null
    const n = Number(p)
    if (n > 255) return null
    out.push(n)
  }
  return out
}

/** True when the IPv4 address is not a public, globally routable unicast address. */
function isNonPublicIPv4(b: number[]): boolean {
  const [a, c, d] = b
  if (a === 0) return true // "this" network, unspecified
  if (a === 10) return true // RFC1918
  if (a === 100 && c >= 64 && c <= 127) return true // CGNAT
  if (a === 127) return true // loopback
  if (a === 169 && c === 254) return true // link-local, cloud metadata
  if (a === 172 && c >= 16 && c <= 31) return true // RFC1918
  if (a === 192 && c === 0 && d === 0) return true // IETF protocol assignments
  if (a === 192 && c === 0 && d === 2) return true // TEST-NET-1
  if (a === 192 && c === 88 && d === 99) return true // 6to4 relay anycast
  if (a === 192 && c === 168) return true // RFC1918
  if (a === 198 && (c === 18 || c === 19)) return true // benchmarking
  if (a === 198 && c === 51 && d === 100) return true // TEST-NET-2
  if (a === 203 && c === 0 && d === 113) return true // TEST-NET-3
  if (a >= 224) return true // multicast, reserved, broadcast
  return false
}

// ── IPv6 ────────────────────────────────────────────────────────────────

/** Parse an IPv6 literal (no brackets, no zone) into 16 bytes. */
function parseIPv6(ip: string): number[] | null {
  let s = ip
  const pct = s.indexOf('%')
  if (pct !== -1) s = s.slice(0, pct)
  if (s.includes(':::')) return null

  // Embedded dotted IPv4 tail (e.g. ::ffff:1.2.3.4).
  let tail: number[] | null = null
  const lastColon = s.lastIndexOf(':')
  if (lastColon !== -1 && s.slice(lastColon + 1).includes('.')) {
    const v4 = parseIPv4(s.slice(lastColon + 1))
    if (!v4) return null
    tail = v4
    s = s.slice(0, lastColon + 1) + '0:0'
  }

  const halves = s.split('::')
  if (halves.length > 2) return null
  const toGroups = (part: string): number[] | null => {
    if (part === '') return []
    const groups: number[] = []
    for (const g of part.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null
      groups.push(parseInt(g, 16))
    }
    return groups
  }
  const head = toGroups(halves[0])
  if (!head) return null
  let groups: number[]
  if (halves.length === 2) {
    const rest = toGroups(halves[1])
    if (!rest) return null
    const fill = 8 - head.length - rest.length
    if (fill < 1) return null
    groups = [...head, ...new Array<number>(fill).fill(0), ...rest]
  } else {
    groups = head
  }
  if (groups.length !== 8) return null
  if (tail) {
    groups[6] = (tail[0] << 8) | tail[1]
    groups[7] = (tail[2] << 8) | tail[3]
  }
  const bytes: number[] = []
  for (const g of groups) bytes.push(g >> 8, g & 0xff)
  return bytes
}

/** True when the IPv6 address is not a public, globally routable unicast address. */
function isNonPublicIPv6(b: number[]): boolean {
  const embeddedV4 = (offset: number) => isNonPublicIPv4(b.slice(offset, offset + 4))
  const g = (i: number) => (b[i * 2] << 8) | b[i * 2 + 1]

  // Only global unicast 2000::/3 is considered routable; this excludes
  // unspecified, loopback, IPv4-mapped/compatible, NAT64, ULA, link-local,
  // site-local and multicast in one rule.
  if ((b[0] & 0xe0) !== 0x20) return true

  if (g(0) === 0x2001 && g(1) === 0x0db8) return true // documentation
  if (g(0) === 0x2001 && g(1) === 0x0000) return true // Teredo
  if (g(0) === 0x2001 && g(1) < 0x0200) return true // IETF protocol assignments
  if (g(0) === 0x2002) return embeddedV4(2) // 6to4 embeds an IPv4 address
  return false
}

/** True when `ip` (IPv4 or IPv6 literal, no brackets) is not publicly routable. Unparseable input counts as non-public. */
export function isNonPublicAddress(ip: string): boolean {
  const family = isIP(ip)
  if (family === 4) {
    const b = parseIPv4(ip)
    return !b || isNonPublicIPv4(b)
  }
  if (family === 6) {
    const b = parseIPv6(ip)
    return !b || isNonPublicIPv6(b)
  }
  return true
}

// ── Hostnames ───────────────────────────────────────────────────────────

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home.arpa']
const BLOCKED_HOSTS = new Set(['localhost', 'metadata', 'metadata.google.internal', 'instance-data'])

function isBlockedMetadataHostname(host: string): boolean {
  const h = host.replace(/\.$/, '').toLowerCase()
  return h === 'metadata' || h === 'metadata.google.internal' || h === 'instance-data'
}

function isBlockedHostname(host: string): boolean {
  const h = host.replace(/\.$/, '').toLowerCase()
  return BLOCKED_HOSTS.has(h) || BLOCKED_HOST_SUFFIXES.some((s) => h.endsWith(s))
}

export interface ResolvedPublicUrl {
  url: URL
  /** Validated addresses the hostname resolved to; connections should be pinned to one of these. */
  addresses: { address: string; family: 4 | 6 }[]
}

/**
 * Parse and validate `raw`, resolving its hostname. Returns the URL and the
 * validated address list so callers can pin the connection to them.
 */
export async function resolvePublicHttpsUrl(
  raw: string,
  opts: { strict?: boolean } = {},
): Promise<ResolvedPublicUrl> {
  const devRelaxed = privateOutboundAllowed()
  // `strict` is for targets that are always public services (e.g. browser push
  // endpoints), so self-hosted installs get no local-network exemption there.
  const relaxed = devRelaxed || (!opts.strict && selfHostedLocalAllowed())

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new UnsafeUrlError('Invalid URL')
  }

  if (url.protocol !== 'https:' && !(relaxed && url.protocol === 'http:')) {
    throw new UnsafeUrlError('Only https URLs are allowed')
  }
  if (url.username || url.password) throw new UnsafeUrlError('URLs with credentials are not allowed')

  // WHATWG URL normalizes decimal/hex/octal IPv4 forms to dotted quad and
  // brackets IPv6 literals, so the hostname below is already canonical.
  let host = url.hostname
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  if (!host) throw new UnsafeUrlError('Invalid URL')

  if (relaxed) {
    const family = isIP(host)
    if (family) {
      if (!devRelaxed && isLinkLocalOrMetadata(host)) throw new UnsafeUrlError('Host is not an allowed address')
      return { url, addresses: [{ address: host, family: family as 4 | 6 }] }
    }
    if (!devRelaxed && isBlockedMetadataHostname(host)) throw new UnsafeUrlError('Host is not an allowed address')
    const found = await lookup(host, { all: true, verbatim: true }).catch(() => {
      throw new UnsafeUrlError('Host could not be resolved')
    })
    if (found.length === 0) throw new UnsafeUrlError('Host could not be resolved')
    if (!devRelaxed && found.some((f) => isLinkLocalOrMetadata(f.address))) {
      throw new UnsafeUrlError('Host is not an allowed address')
    }
    return { url, addresses: found.map((f) => ({ address: f.address, family: f.family as 4 | 6 })) }
  }

  const literalFamily = isIP(host)
  if (literalFamily) {
    if (isNonPublicAddress(host)) throw new UnsafeUrlError('Host is not a public address')
    return { url, addresses: [{ address: host, family: literalFamily as 4 | 6 }] }
  }

  if (isBlockedHostname(host)) throw new UnsafeUrlError('Host is not a public address')

  let found: { address: string; family: number }[]
  try {
    found = await lookup(host, { all: true, verbatim: true })
  } catch {
    throw new UnsafeUrlError('Host could not be resolved')
  }
  if (found.length === 0) throw new UnsafeUrlError('Host could not be resolved')
  for (const f of found) {
    if (isNonPublicAddress(f.address)) throw new UnsafeUrlError('Host is not a public address')
  }
  return { url, addresses: found.map((f) => ({ address: f.address, family: f.family as 4 | 6 })) }
}

/**
 * Throws UnsafeUrlError unless `raw` is an https URL without credentials whose
 * host resolves only to public addresses. Returns the parsed URL.
 */
export async function assertPublicHttpsUrl(raw: string, opts: { strict?: boolean } = {}): Promise<URL> {
  return (await resolvePublicHttpsUrl(raw, opts)).url
}
