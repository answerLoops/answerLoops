import { MOCK_EXTERNALS } from '@/lib/mock-mode'
import { getIntegration } from '@/lib/db/queries/integrations'
import { logger } from '@/lib/logger'
import { discourseFetch } from '@/lib/discourse/client'

const MOD = 'discourse/send'

/**
 * Post a reply into a Discourse topic as the configured bot user. `topicId`
 * is the numeric topic id — `lib/channels/post-reply.ts` always passes the
 * topic id here (every caller resolves `threadId ?? channelId`, and the
 * ingest route sets `threadId` to the topic id). Returns the new post id on
 * success, or null if the integration is not fully configured or Discourse
 * rejects the write.
 */
export async function postToDiscourseTopic(
  topicId: string,
  content: string,
  orgId: number
): Promise<string | null> {
  if (MOCK_EXTERNALS) return `mock-discourse-${topicId}`

  const integration = await getIntegration(orgId, 'discourse')
  const apiKey = integration?.bot_token
  const siteUrl = integration?.team_id
  const apiUsername = integration?.bot_username
  if (!apiKey || !siteUrl || !apiUsername) {
    logger.warn('Discourse integration not fully configured — skipping send', {
      module: MOD,
      orgId,
      hasKey: !!apiKey,
      hasSite: !!siteUrl,
      hasUsername: !!apiUsername,
    })
    return null
  }

  let res: Response
  try {
    res = await discourseFetch(
      { siteUrl, apiKey, apiUsername },
      '/posts.json',
      { method: 'POST', body: JSON.stringify({ topic_id: Number(topicId), raw: content }) }
    )
  } catch (err) {
    logger.error('failed to reach Discourse site', { module: MOD, orgId, topicId, error: err })
    return null
  }

  if (!res.ok) {
    logger.error('failed to post Discourse reply', { module: MOD, orgId, topicId, status: res.status })
    return null
  }

  const data = (await res.json()) as { id?: number }
  return data.id != null ? String(data.id) : null
}
