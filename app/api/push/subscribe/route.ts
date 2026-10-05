import { z } from 'zod'
import { requireOrgAccess } from '@/lib/auth/org'
import { getDb } from '@/lib/db/drizzle'
import { pushSubscriptions } from '@/lib/db/schema'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/push/subscribe'

const SubSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
})

export async function POST(request: Request) {
  try {
    const access = await requireOrgAccess()
    if (!access.ok) return Response.json({ error: access.error }, { status: 401 })
    const orgId = access.orgId

    const body = await request.json()
    const parsed = SubSchema.safeParse(body)
    if (!parsed.success) return Response.json({ error: 'Invalid subscription' }, { status: 400 })

    const { endpoint, keys } = parsed.data
    await getDb()
      .insert(pushSubscriptions)
      .values({ orgId, endpoint, p256dh: keys.p256dh, auth: keys.auth })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { orgId, p256dh: keys.p256dh, auth: keys.auth },
      })

    return Response.json({ ok: true })
  } catch (err) {
    logger.error('failed to save push subscription', { module: MOD, requestId: getRequestId(request), error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
