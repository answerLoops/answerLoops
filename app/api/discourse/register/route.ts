import { NextRequest } from 'next/server'
import { requireOrgAccess } from '@/lib/auth/org'
import { getIntegration } from '@/lib/db/queries/integrations'
import { discourseFetch, normalizeSiteUrl } from '@/lib/discourse/client'
import { logger } from '@/lib/logger'

const MOD = 'api/discourse/register'

const GENERIC_ERROR = 'Could not register the webhook with your Discourse site. Check the site URL, API key and username, then try again.'

interface EventType { id: number; name: string }
interface WebHook { id: number; payload_url: string }

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
    // Resolve the numeric event-type ids for topic + post events.
    const typesRes = await discourseFetch(creds, '/admin/api/web_hooks/event_types.json')
    if (!typesRes.ok) {
      logger.warn('Discourse event type lookup rejected', { module: MOD, orgId, status: typesRes.status })
      return Response.json({ error: GENERIC_ERROR }, { status: 502 })
    }
    const { web_hook_event_types: types } = (await typesRes.json()) as { web_hook_event_types: EventType[] }
    const eventTypeIds = types
      .filter((t) => t.name.startsWith('topic') || t.name.startsWith('post'))
      .map((t) => t.id)
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
    const listRes = await discourseFetch(creds, '/admin/api/web_hooks.json')
    let existingId: number | undefined
    if (listRes.ok) {
      const { web_hooks: hooks } = (await listRes.json()) as { web_hooks: WebHook[] }
      existingId = hooks.find((h) => normalizeSiteUrl(h.payload_url) === normalizeSiteUrl(payloadUrl))?.id
    }

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
      return Response.json({ error: GENERIC_ERROR }, { status: 502 })
    }

    return Response.json({ ok: true, webhookUrl: payloadUrl })
  } catch (err) {
    logger.error('Discourse webhook registration threw', { module: MOD, orgId, error: err })
    return Response.json({ error: GENERIC_ERROR }, { status: 502 })
  }
}
