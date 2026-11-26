import { MOCK_EXTERNALS } from '@/lib/mock-mode'
import { getIntegration, setIntegrationBotUserId } from '@/lib/db/queries/integrations'
import { circleFetch } from '@/lib/circle/client'
import { logger } from '@/lib/logger'

const MOD = 'circle/send'

/**
 * Post a reply into Circle as a comment on a post. `postId` is the Circle post
 * id: every caller passes `threadId ?? channelId`, and the Circle webhook sets
 * threadId to the post id, so a reply on a comment's ticket lands on the
 * comment's parent post.
 *
 * Uses the saved Admin API token. The comment is created as the member whose
 * email is saved as "Post replies as" (`bot_username`), or as the token's
 * admin when none is saved. Returns the new comment id, or null when Circle is
 * not set up or refuses the comment. Never throws.
 */
export async function postToCirclePost(postId: string, content: string, orgId: number): Promise<string | null> {
  if (MOCK_EXTERNALS) return `mock-circle-${postId}`

  try {
    const integration = await getIntegration(orgId, 'circle')
    const token = integration?.bot_token
    if (!integration || !token) {
      logger.warn('Circle is not set up to post replies, skipping send', { module: MOD, orgId, hasToken: !!token })
      return null
    }
    if (!/^\d+$/.test(postId)) {
      logger.warn('Circle reply has no numeric post id, skipping send', { module: MOD, orgId })
      return null
    }

    // Request and response shape for creating a comment. This must be
    // confirmed against a live community: the endpoint, the field names, and
    // whether the response wraps the comment are not in Circle's public docs.
    // Everything that depends on that shape stays in this block.
    const payload: Record<string, unknown> = { post_id: Number(postId), body: content }
    if (integration.bot_username) payload.user_email = integration.bot_username
    const res = await circleFetch(token, '/comments', { method: 'POST', body: JSON.stringify(payload) })
    if (!res.ok) {
      logger.error('Circle did not accept the reply comment', { module: MOD, orgId, postId, status: res.status })
      return null
    }
    const data: unknown = await res.json()
    const wrapped = data && typeof data === 'object' ? (data as { comment?: unknown }).comment : undefined
    const record = (wrapped && typeof wrapped === 'object' ? wrapped : data) as { id?: unknown; user_id?: unknown } | null
    const commentId = record && (typeof record.id === 'number' || typeof record.id === 'string') ? String(record.id) : null
    const authorId = record && (typeof record.user_id === 'number' || typeof record.user_id === 'string') ? String(record.user_id) : null

    if (!commentId) {
      logger.error('Circle accepted the reply but returned no comment id', { module: MOD, orgId, postId, status: res.status })
      return null
    }

    if (authorId && authorId !== integration.bot_user_id) {
      try {
        await setIntegrationBotUserId(orgId, 'circle', authorId)
      } catch (err) {
        logger.warn('could not save the Circle member id replies are posted as', { module: MOD, orgId, error: err })
      }
    }
    return commentId
  } catch (err) {
    logger.error('failed to post Circle reply', {
      module: MOD,
      orgId,
      postId,
      error: err instanceof Error ? err.name : 'unknown',
    })
    return null
  }
}
