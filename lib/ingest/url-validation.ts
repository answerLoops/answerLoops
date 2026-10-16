import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { isNonPublicAddress } from '@/lib/http/safe-url'

/**
 * Validation for URLs a workspace asks us to import. Imports accept public
 * http(s) web addresses on ports 80 and 443.
 */

export class UrlValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UrlValidationError'
  }
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])
const ALLOWED_PORTS = new Set(['', '80', '443'])
const BLOCKED_NAME_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home.arpa']
const BLOCKED_NAMES = new Set(['localhost', 'metadata', 'instance-data'])
const DNS_CONCURRENCY = 8

const GENERIC_MESSAGE = 'Enter a public web address (http or https) that people can open without signing in.'

type Resolver = (host: string) => Promise<{ address: string; family: number }[]>

const defaultResolver: Resolver = (host) => lookup(host, { all: true, verbatim: true })

function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
}

/**
 * Synchronous checks: scheme, port, credentials and host shape. Returns the
 * parsed URL (without any fragment) and its bare hostname.
 */
export function parseImportUrl(raw: string): { url: URL; host: string } {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new UrlValidationError('That does not look like a valid web address.')
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new UrlValidationError('Only http and https addresses can be imported.')
  }
  if (url.username || url.password) {
    throw new UrlValidationError('Addresses that include a username or password cannot be imported.')
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new UrlValidationError('Only the standard web ports (80 and 443) can be imported.')
  }

  const host = stripBrackets(url.hostname).replace(/\.$/, '').toLowerCase()
  if (!host) throw new UrlValidationError('That does not look like a valid web address.')

  if (isIP(host) !== 0 || host.includes(':')) {
    throw new UrlValidationError('Use a website name rather than an IP address.')
  }
  if (BLOCKED_NAMES.has(host) || BLOCKED_NAME_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new UrlValidationError(GENERIC_MESSAGE)
  }
  url.hash = ''
  return { url, host }
}

async function assertHostResolvesPublic(host: string, resolve: Resolver): Promise<void> {
  let found: { address: string; family: number }[]
  try {
    found = await resolve(host)
  } catch {
    throw new UrlValidationError('We could not find that website. Check the address and try again.')
  }
  if (found.length === 0) {
    throw new UrlValidationError('We could not find that website. Check the address and try again.')
  }
  if (found.some((f) => isNonPublicAddress(f.address))) {
    throw new UrlValidationError(GENERIC_MESSAGE)
  }
}

export interface ValidateOptions {
  /** Skip the DNS step (mock/test mode only). Syntax rules still apply. */
  resolveDns?: boolean
  /** Injectable resolver, for tests. */
  resolver?: Resolver
}

/**
 * A web address that has been through assertImportableUrl. It is in canonical
 * form (lowercase host, normalised path, no fragment), which is also the form
 * import sources are stored under. The brand lets the import functions require
 * an already-checked address without checking it a second time.
 */
export type ValidatedImportUrl = string & { readonly __validatedImportUrl: true }

/** Validate one URL end to end. Returns the canonical href or throws UrlValidationError. */
export async function assertImportableUrl(raw: string, opts: ValidateOptions = {}): Promise<ValidatedImportUrl> {
  const { url, host } = parseImportUrl(raw)
  if (opts.resolveDns !== false) await assertHostResolvesPublic(host, opts.resolver ?? defaultResolver)
  return url.href as ValidatedImportUrl
}

/** One discovered address in both spellings: as given, and in canonical form. */
export interface ImportableUrlEntry {
  raw: string
  canonical: ValidatedImportUrl
}

/**
 * Validate many URLs (such as a site map). Each distinct host is resolved once.
 * URLs that do not pass are dropped and counted rather than aborting the run.
 * `allowed` holds canonical addresses without duplicates; `entries` pairs each
 * with the spelling it was discovered under.
 */
export async function filterImportableUrls(
  urls: string[],
  opts: ValidateOptions = {},
): Promise<{ allowed: ValidatedImportUrl[]; entries: ImportableUrlEntry[]; rejected: number }> {
  const parsed: { raw: string; href: string; host: string }[] = []
  let rejected = 0
  for (const raw of urls) {
    try {
      const { url, host } = parseImportUrl(raw)
      parsed.push({ raw, href: url.href, host })
    } catch {
      rejected++
    }
  }

  const verdicts = new Map<string, boolean>()
  const hosts = [...new Set(parsed.map((p) => p.host))]
  if (opts.resolveDns === false) {
    for (const h of hosts) verdicts.set(h, true)
  } else {
    const resolve = opts.resolver ?? defaultResolver
    for (let i = 0; i < hosts.length; i += DNS_CONCURRENCY) {
      await Promise.all(
        hosts.slice(i, i + DNS_CONCURRENCY).map(async (h) => {
          try {
            await assertHostResolvesPublic(h, resolve)
            verdicts.set(h, true)
          } catch {
            verdicts.set(h, false)
          }
        }),
      )
    }
  }

  const entries: ImportableUrlEntry[] = []
  const seen = new Set<string>()
  for (const p of parsed) {
    if (!verdicts.get(p.host)) {
      rejected++
      continue
    }
    if (seen.has(p.href)) continue
    seen.add(p.href)
    entries.push({ raw: p.raw, canonical: p.href as ValidatedImportUrl })
  }
  return { allowed: entries.map((e) => e.canonical), entries, rejected }
}
