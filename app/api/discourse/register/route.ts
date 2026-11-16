import { NextRequest } from 'next/server'
import { requireOrgAccess } from '@/lib/auth/org'
import { getIntegration } from '@/lib/db/queries/integrations'
import { discourseFetch, normalizeSiteUrl } from '@/lib/discourse/client'
import { logger } from '@/lib/logger'

const MOD = 'api/discourse/register'

const GENERIC_ERROR = 'Could not register the webhook with your Discourse site. Check the site URL, API key and username, then try again.'

// Discourse answers 404 (not 403) to any account that is not an admin on its
// webhook endpoints, whatever the key's scope: a Global key used as a regular
// bot user is refused too, and no granular scope exists for webhooks. The
// manual route shown on the card always works.
const ADMIN_KEY_ERROR = 'Discourse would not let this account manage webhooks. Only an admin account can, so a regular bot user cannot. Add the webhook by hand with the payload URL and secret shown below.'

// Discourse refuses a webhook whose URL resolves to a private address unless
// the host is listed in its "allowed internal hosts" site setting.
const INTERNAL_HOST_ERROR = 'Discourse refused the payload URL because it points at a private address. Add this app\'s host to Discourse\'s "allowed internal hosts" site setting, or use a public https URL.'

interface EventType { id: number; name: string }
interface WebHook { id: number; payload_url: string }
// GET /admin/api/web_hooks.json carries both the existing webhooks and, under
// `extras`, the event types grouped by name. Discourse has no separate
// event-types endpoint.
interface WebHooksList {
  web_hooks?: WebHook[]
  extras?: { grouped_event_types?: Record<string, EventType[]> }
}

export async function POST(req: NextRequest) {
  const access = await requireOrgAccess()
  if (!access.ok) return Response.json({ error: access.error }, { status: 401 })

  const orgId = access.orgId
  const integration = await getIntegration(orgId, 'discourse')

  if (!integration?.bot_token || !integration.bot_username) {
    return Response.json({ error: 'Save the API key and bot username first' }, { status: 400 })
  }
  if (!integration.team_id) {
    return Response.json({ error: 'Save the Discourse site URL first' }, { status: 400 })
  }
  if (!integration.bot_secret) {
    return Response.json({ error: 'Webhook secret missing — re-save the integration' }, { status: 400 })
  }

  const creds = { siteUrl: integration.team_id, apiKey: integration.bot_token, apiUsername: integration.bot_username }
  const baseUrl = process.env.AUTH_URL ?? `${req.nextUrl.protocol}//${req.nextUrl.host}`
  const payloadUrl = `${baseUrl}/api/discourse/webhook`

  try {
    // One call returns the existing webhooks and the numeric event-type ids.
    const listRes = await discourseFetch(creds, '/admin/api/web_hooks.json')
    if (!listRes.ok) {
      logger.warn('Discourse webhook list rejected', { module: MOD, orgId, status: listRes.status })
      const adminOnly = listRes.status === 403 || listRes.status === 404
      return Response.json({ error: adminOnly ? ADMIN_KEY_ERROR : GENERIC_ERROR }, { status: 502 })
    }
    const list = (await listRes.json()) as WebHooksList
    // The Topic and Post groups only. Matching on the event name would also pick
    // up `post_liked` and the voting plugin's `topic_upvote`, which belong to
    // other groups and would send a delivery for every like and vote.
    const grouped = list.extras?.grouped_event_types ?? {}
    const eventTypeIds = [...(grouped.topic ?? []), ...(grouped.post ?? [])].map((t) => t.id)
    if (eventTypeIds.length === 0) {
      logger.warn('Discourse returned no usable event types', { module: MOD, orgId })
      return Response.json({ error: GENERIC_ERROR }, { status: 502 })
    }

    const categoryIds = (integration.channel_ids ? JSON.parse(integration.channel_ids) as string[] : [])
      .map((c) => Number(c))
      .filter((n) => Number.isFinite(n))

    const webHookBody = {
      web_hook: {
        payload_url: payloadUrl,
        content_type: 1,
        secret: integration.bot_secret,
        wildcard_web_hook: false,
        verify_certificate: true,
        active: true,
        web_hook_event_type_ids: eventTypeIds,
        category_ids: categoryIds,
        group_ids: [],
        tag_names: [],
      },
    }

    // Update in place if a webhook already points at our URL.
    const existingId = (list.web_hooks ?? []).find(
      (h) => normalizeSiteUrl(h.payload_url) === normalizeSiteUrl(payloadUrl)
    )?.id

    const res = existingId
      ? await discourseFetch(creds, `/admin/api/web_hooks/${existingId}.json`, {
          method: 'PUT',
          body: JSON.stringify(webHookBody),
        })
      : await discourseFetch(creds, '/admin/api/web_hooks.json', {
          method: 'POST',
          body: JSON.stringify(webHookBody),
        })

    if (!res.ok) {
      logger.error('Discourse webhook registration failed', { module: MOD, orgId, status: res.status })
      if (res.status === 422) {
        const body = (await res.json().catch(() => null)) as { errors?: string[] } | null
        if (body?.errors?.some((e) => /internal/i.test(e))) {
          return Response.json({ error: INTERNAL_HOST_ERROR }, { status: 502 })
        }
      }
      return Response.json({ error: GENERIC_ERROR }, { status: 502 })
    }

    return Response.json({ ok: true, webhookUrl: payloadUrl })
  } catch (err) {
    logger.error('Discourse webhook registration threw', { module: MOD, orgId, error: err })
    return Response.json({ error: GENERIC_ERROR }, { status: 502 })
  }
}
