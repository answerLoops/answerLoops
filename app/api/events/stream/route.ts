import { auth } from '@/auth'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { getDirectDatabaseUrl } from '@/lib/db/direct-url'
import { logger } from '@/lib/logger'
import { isFeedbackWidgetEnabled } from '@/lib/product-feedback/enabled'
import postgres from 'postgres'
import type { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

const MOD = 'sse'

// Proxies (Railway, Vercel, nginx) drop an idle connection around 60s. This
// ping is sent browser-ward only — it never queries Postgres, so it does not
// keep a serverless database compute from suspending on idle.
const KEEPALIVE_MS = 25_000

// Deliberately end the stream on a fixed cycle and let the browser's
// EventSource rebuild it. A LISTEN connection can die silently on some
// network paths (proxy idle-drop, database failover, a laptop sleeping)
// without the clean close event that postgres.js's auto-resubscribe needs to
// see. Recycling caps how long a silently-dead LISTEN can persist even if
// both the heartbeat below and the client-side watchdog miss it.
const STREAM_MAX_AGE_MS = 15 * 60 * 1000

// Heartbeat on the LISTEN connection itself, matching the bot's config
// listener (bot/index.ts). The browser-ward `ping` above proves only that the
// HTTP stream is alive; it never touches Postgres, so a LISTEN that has died
// underneath a healthy stream is invisible without this. A failed heartbeat
// ends the stream, the browser reconnects, and every subscriber gets a
// `resync` — which is what makes the client's backstop affordable at ten
// minutes instead of one.
const LISTEN_HEARTBEAT_MS = 4 * 60 * 1000

export async function GET(_request: NextRequest) {
  const session = await auth()
  if (!session?.user) return new Response('Unauthorized', { status: 401 })

  const orgId = (session as { orgId?: number }).orgId ?? DEFAULT_ORG_ID

  const url = getDirectDatabaseUrl()
  if (!url) return new Response('database not configured', { status: 503 })

  const encoder = new TextEncoder()
  // Assigned inside start(); cancel() runs it when the client disconnects.
  let teardown = () => {}

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false

      // Every event this stream sends is a bare signal with no payload — the
      // client re-fetches on its own — so the data line is always `{}`.
      const send = (event: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: {}\n\n`))
        } catch {
          // Client already gone — teardown runs via cancel().
        }
      }

      const forOrg = (event: string) => (payload: string) => {
        if (Number(payload) === orgId) send(event)
      }
      const channels: Record<string, (payload: string) => void> = {
        data_changed: forOrg('data_changed'),
        member_joined: forOrg('member_joined'),
        // The feedback board is shared across every workspace, so unlike the
        // org-scoped channels above this one is forwarded to every stream.
        // The payload is empty; clients re-fetch their own per-viewer snapshot.
        product_feedback_changed: () => {
          if (isFeedbackWidgetEnabled()) send('feedback_changed')
        },
      }

      // Dedicated connection: a NOTIFY arrives on whichever backend Postgres
      // picks, so a pooled connection can miss it (same reason as the bot's
      // config listener). postgres.js does not idle-close a connection by
      // default, so the LISTEN stays registered between notifications.
      //
      // The raw connection is managed here rather than through postgres.js's
      // `.listen()` sugar, which opens its own hidden internal instance
      // (`listen.sql = Postgres({ max: 1 })`, src/index.js) and runs LISTEN on
      // that socket. A heartbeat on this object would then exercise a
      // different, otherwise-idle socket and prove nothing about the
      // subscription — and hold a second connection per tab. bot/index.ts
      // avoids the sugar for the same reason.
      const options: postgres.Options<{}> & {
        onnotify: (channel: string, payload: string) => void
      } = {
        max: 1,
        // Load-bearing: postgres.js otherwise retires a connection after a
        // randomised 30-60 minutes (max_lifetime(), src/index.js). LISTEN is
        // registered by hand here, so nothing re-subscribes on the replacement
        // socket — the subscription would go silently dead while the heartbeat
        // kept passing on the new connection.
        max_lifetime: null,
        onnotify: (channel, payload) => channels[channel]?.(payload),
        // A dropped socket ends the stream immediately; the browser rebuilds
        // it rather than waiting for the next heartbeat to notice.
        onclose: () => close(),
      }
      const listener = postgres(url, options)

      const keepalive = setInterval(() => send('ping'), KEEPALIVE_MS)

      // If the connection is gone, close the stream rather than sitting on a
      // dead LISTEN: the browser reopens and the server registers a fresh one.
      // Runs on the same socket as the LISTEN above, which is the whole point.
      let beatInFlight = false
      const heartbeat = setInterval(() => {
        // A half-open socket can swallow a query without ever resolving or
        // rejecting. Without this the interval would queue another SELECT 1
        // every four minutes with nothing ever reaching .catch(), and the
        // stream would never be torn down.
        if (beatInFlight) {
          logger.warn('SSE listener heartbeat stalled', { module: MOD, orgId })
          close()
          return
        }
        beatInFlight = true
        listener
          .unsafe('SELECT 1')
          .then(() => {
            beatInFlight = false
          })
          .catch((err: unknown) => {
            beatInFlight = false
            // Message only: a driver error object can carry connection detail.
            logger.warn('SSE listener heartbeat failed', {
              module: MOD,
              orgId,
              error: err instanceof Error ? err.message : String(err),
            })
            close()
          })
      }, LISTEN_HEARTBEAT_MS)

      const recycle = setTimeout(() => {
        send('cycle')
        close()
      }, STREAM_MAX_AGE_MS)

      const close = () => {
        if (closed) return
        closed = true
        clearInterval(keepalive)
        clearInterval(heartbeat)
        clearTimeout(recycle)
        listener.end({ timeout: 5 }).catch(() => {})
        try {
          controller.close()
        } catch {
          // already closed
        }
      }
      teardown = close

      try {
        await listener.unsafe('LISTEN data_changed')
        await listener.unsafe('LISTEN member_joined')
        await listener.unsafe('LISTEN product_feedback_changed')
        send('connected')
      } catch (err) {
        logger.warn('SSE listen setup failed', {
          module: MOD,
          orgId,
          error: err instanceof Error ? err.message : String(err),
        })
        close()
      }
    },
    cancel() {
      teardown()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disable nginx / Railway proxy buffering so events reach the client
      // immediately instead of being held in a buffer.
      'X-Accel-Buffering': 'no',
    },
  })
}
