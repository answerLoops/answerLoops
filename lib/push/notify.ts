import https from 'node:https'
import dns from 'node:dns'
import webpush from 'web-push'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/drizzle'
import { pushSubscriptions } from '@/lib/db/schema'
import { MOCK_EXTERNALS } from '@/lib/mock-mode'
import { assertValidPushEndpoint } from '@/lib/push/endpoint'
import { UnsafeUrlError, isNonPublicAddress, privateOutboundAllowed } from '@/lib/http/safe-url'
import { logger } from '@/lib/logger'

/**
 * DNS lookup for the push connection: resolves the hostname and fails the
 * connection unless every address is public, so the address web-push connects
 * to is the one that was checked (no second, unchecked lookup).
 */
export function publicOnlyLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void
): void {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0)
    const list = addresses as dns.LookupAddress[]
    if (!privateOutboundAllowed() && (list.length === 0 || list.some((a) => isNonPublicAddress(a.address)))) {
      const blocked: NodeJS.ErrnoException = new Error('Push endpoint host is not a public address')
      blocked.code = 'EUNSAFEHOST'
      return callback(blocked, '', 0)
    }
    if (options.all) return callback(null, list)
    callback(null, list[0].address, list[0].family)
  })
}

const pushAgent = new https.Agent({ lookup: publicOnlyLookup as unknown as https.AgentOptions['lookup'] })

function initWebPush() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
      process.env.VAPID_EMAIL ?? 'mailto:admin@example.com',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    )
  }
}

interface PushPayload {
  title: string
  body: string
  url?: string
}

export async function sendPushToAll(payload: PushPayload, orgId: number): Promise<void> {
  if (MOCK_EXTERNALS) return
  if (!process.env.VAPID_PUBLIC_KEY) return

  initWebPush()

  const db = getDb()
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.orgId, orgId))

  const results = await Promise.allSettled(
    subs.map(async (sub) => {
      // Re-validate at send time: only known push services on public hosts.
      await assertValidPushEndpoint(sub.endpoint)
      return webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { timeout: 10_000, agent: pushAgent }
      )
    })
  )

  // Remove expired subscriptions (410 Gone)
  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    if (result.status === 'rejected') {
      if (result.reason instanceof UnsafeUrlError) {
        logger.warn('skipping push subscription with a disallowed endpoint', { module: 'push/notify', orgId })
        continue
      }
      const err = result.reason as { statusCode?: number }
      if (err?.statusCode === 410) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, subs[i].endpoint))
      }
    }
  }
}
