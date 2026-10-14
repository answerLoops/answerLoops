import http from 'node:http'
import https from 'node:https'
import { Readable, Transform, pipeline } from 'node:stream'
import { resolvePublicHttpsUrl } from '@/lib/http/safe-url'

/**
 * A `fetch` implementation for AI provider clients whose base URL a tenant
 * supplied. Unlike safeFetch (which buffers the whole response), this one
 * streams the response body, because chat completions arrive as an event
 * stream. Each request:
 *  - validates the URL and every resolved address (public https hosts only),
 *  - connects to the validated address itself, so a second DNS answer at
 *    connect time cannot redirect the request,
 *  - does not follow redirects (a 3xx comes back as-is and the provider
 *    client reports it as a failed call),
 *  - aborts on the caller's signal and after an overall time limit,
 *  - stops a response that grows past a byte ceiling.
 * Throws UnsafeUrlError for a disallowed URL.
 */

const DEFAULT_TIMEOUT_MS = 300_000
const DEFAULT_MAX_RESPONSE_BYTES = 32 * 1024 * 1024
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304])

interface SafeProviderFetchOptions {
  timeoutMs?: number
  maxResponseBytes?: number
}

async function encodeBody(body: BodyInit | null | undefined): Promise<Buffer | undefined> {
  if (body == null) return undefined
  if (typeof body === 'string') return Buffer.from(body, 'utf8')
  if (body instanceof URLSearchParams) return Buffer.from(body.toString(), 'utf8')
  if (body instanceof ArrayBuffer) return Buffer.from(body)
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength)
  if (body instanceof Blob) return Buffer.from(await body.arrayBuffer())
  throw new TypeError('Unsupported request body type')
}

export function createSafeProviderFetch(options: SafeProviderFetchOptions = {}): typeof fetch {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES

  return async function safeProviderFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = input instanceof Request ? input : null
    const rawUrl = request ? request.url : input.toString()
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
    const headers = new Headers(init?.headers ?? request?.headers)
    const body = await encodeBody(init?.body ?? (request ? await request.clone().arrayBuffer() : null))

    const target = await resolvePublicHttpsUrl(rawUrl)
    const { url, addresses } = target
    const pinned = addresses[0]
    const transport = url.protocol === 'http:' ? http : https

    const signals = [AbortSignal.timeout(timeoutMs)]
    const callerSignal = init?.signal ?? request?.signal
    if (callerSignal) signals.push(callerSignal)
    const signal = AbortSignal.any(signals)
    signal.throwIfAborted()

    const outHeaders: Record<string, string> = {}
    headers.forEach((v, k) => {
      outHeaders[k] = v
    })
    if (!headers.has('accept-encoding')) outHeaders['accept-encoding'] = 'identity'
    if (body) outHeaders['content-length'] = String(body.byteLength)

    return new Promise<Response>((resolve, reject) => {
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
          lookup: (_host, lookupOptions, cb) => {
            if ((lookupOptions as { all?: boolean })?.all) {
              ;(cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [pinned])
            } else {
              cb(null, pinned.address, pinned.family)
            }
          },
          signal,
        },
        (res) => {
          const resHeaders = new Headers()
          for (const [k, v] of Object.entries(res.headers)) {
            if (Array.isArray(v)) v.forEach((item) => resHeaders.append(k, item))
            else if (v != null) resHeaders.set(k, v)
          }
          const status = res.statusCode ?? 0
          if (NULL_BODY_STATUSES.has(status)) {
            res.resume()
            resolve(new Response(null, { status, statusText: res.statusMessage ?? '', headers: resHeaders }))
            return
          }
          // Count bytes as they pass; error the stream once the ceiling is crossed.
          let total = 0
          const counter = new Transform({
            transform(chunk: Buffer, _enc, cb) {
              total += chunk.byteLength
              if (total > maxBytes) cb(new Error('Response body too large'))
              else cb(null, chunk)
            },
          })
          pipeline(res, counter, () => {})
          resolve(
            new Response(Readable.toWeb(counter) as unknown as ReadableStream<Uint8Array>, {
              status,
              statusText: res.statusMessage ?? '',
              headers: resHeaders,
            })
          )
        }
      )
      req.on('error', reject)
      if (body) req.write(body)
      req.end()
    })
  }
}
