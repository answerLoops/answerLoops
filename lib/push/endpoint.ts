import { assertPublicHttpsUrl, UnsafeUrlError } from '@/lib/http/safe-url'

/**
 * Browser push endpoints are issued by the browser vendor's push service.
 * Only those services are accepted: https, no credentials, a known hostname,
 * and public addresses only.
 */
const EXACT_HOSTS = new Set([
  'fcm.googleapis.com',
  'android.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
])
const HOST_SUFFIXES = ['.notify.windows.com', '.push.apple.com']

export function isAllowedPushHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '')
  return EXACT_HOSTS.has(h) || HOST_SUFFIXES.some((s) => h.endsWith(s) && h.length > s.length)
}

/** Throws UnsafeUrlError unless `endpoint` is a known push-service https URL resolving to public addresses. */
export async function assertValidPushEndpoint(endpoint: string): Promise<void> {
  let host: string
  try {
    host = new URL(endpoint).hostname
  } catch {
    throw new UnsafeUrlError('Invalid push endpoint')
  }
  if (!isAllowedPushHost(host)) throw new UnsafeUrlError('Push endpoint host is not allowed')
  await assertPublicHttpsUrl(endpoint, { strict: true })
}
