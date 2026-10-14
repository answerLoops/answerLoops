import http from 'node:http'
import https from 'node:https'
import { resolvePublicHttpsUrl, UnsafeUrlError, type ResolvedPublicUrl } from '@/lib/http/safe-url'

/**
 * fetch() for URLs that a tenant supplied. Each request:
 *  - validates the URL and every resolved address (see safe-url.ts),
 *  - connects to the validated address itself, so a second DNS answer at
 *    connect time cannot redirect the request,
 *  - follows at most MAX_REDIRECTS redirects, validating each hop,
 *  - enforces an overall timeout and a response size cap.
 * Throws UnsafeUrlError for a disallowed URL and Error for other failures.
 */

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 3
const SENSITIVE_HEADERS = ['authorization', 'cookie', 'proxy-authorization', 'api-key', 'api-username', 'x-api-key']
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304])

interface SafeFetchInit {
  method?: string
  headers?: HeadersInit
  body?: string | Uint8Array | URLSearchParams | null
  signal?: AbortSignal | null
  timeoutMs?: number
  maxBytes?: number
}

class ResponseTooLargeError extends Error {
  constructor() {
    super('Response body too large')
    this.name = 'ResponseTooLargeError'
  }
}

function encodeBody(body: SafeFetchInit['body']): Buffer | undefined {
  if (body == null) return undefined
  if (typeof body === 'string') return Buffer.from(body, 'utf8')
  if (body instanceof URLSearchParams) return Buffer.from(body.toString(), 'utf8')
  return Buffer.from(body)
}

function requestOnce(
  target: ResolvedPublicUrl,
  method: string,
  headers: Headers,
  body: Buffer | undefined,
  signal: AbortSignal,
  maxBytes: number
): Promise<{ status: number; statusText: string; headers: Headers; body: Buffer }> {
  const { url, addresses } = target
  const pinned = addresses[0]
  const transport = url.protocol === 'http:' ? http : https

  return new Promise((resolve, reject) => {
    const outHeaders: Record<string, string> = {}
    headers.forEach((v, k) => {
      outHeaders[k] = v
    })
    if (!headers.has('accept-encoding')) outHeaders['accept-encoding'] = 'identity'
    if (body) outHeaders['content-length'] = String(body.byteLength)

    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method,
        headers: outHeaders,
        // Connect to the address that was validated, not a fresh DNS answer.
        // TLS still verifies the certificate against the original hostname.
        lookup: (_host, options, cb) => {
          if ((options as { all?: boolean })?.all) {
            ;(cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [pinned])
          } else {
            cb(null, pinned.address, pinned.family)
          }
        },
        signal,
      },
      (res) => {
        const chunks: Buffer[] = []
        let total = 0
        res.on('data', (chunk: Buffer) => {
          total += chunk.byteLength
          if (total > maxBytes) {
            reject(new ResponseTooLargeError())
            req.destroy()
            return
          }
          chunks.push(chunk)
        })
        res.on('end', () => {
          const resHeaders = new Headers()
          for (const [k, v] of Object.entries(res.headers)) {
            if (Array.isArray(v)) v.forEach((item) => resHeaders.append(k, item))
            else if (v != null) resHeaders.set(k, v)
          }
          resolve({
            status: res.statusCode ?? 0,
            statusText: res.statusMessage ?? '',
            headers: resHeaders,
            body: Buffer.concat(chunks),
          })
        })
        res.on('error', reject)
        // A connection that closes before the body finishes is a failure.
        res.on('close', () => {
          if (!res.complete) reject(new Error('Connection closed before the response finished'))
        })
      }
    )
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

export async function safeFetch(rawUrl: string | URL, init: SafeFetchInit = {}): Promise<Response> {
  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = init.maxBytes ?? DEFAULT_MAX_BYTES
  const signal = init.signal
    ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs)

  let method = (init.method ?? 'GET').toUpperCase()
  let body = encodeBody(init.body)
  let headers = new Headers(init.headers)
  let current = typeof rawUrl === 'string' ? rawUrl : rawUrl.toString()

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const target = await resolvePublicHttpsUrl(current)
    const res = await requestOnce(target, method, headers, body, signal, maxBytes)

    const location = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && location) {
      if (hop === MAX_REDIRECTS) throw new Error('Too many redirects')
      const next = new URL(location, target.url)
      if (next.origin !== target.url.origin) {
        const stripped = new Headers(headers)
        for (const h of SENSITIVE_HEADERS) stripped.delete(h)
        headers = stripped
      }
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
        method = 'GET'
        body = undefined
        headers.delete('content-type')
        headers.delete('content-length')
      }
      current = next.toString()
      continue
    }

    return new Response(NULL_BODY_STATUSES.has(res.status) ? null : new Uint8Array(res.body), {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    })
  }
  throw new UnsafeUrlError('Too many redirects')
}
