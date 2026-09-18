import { logger } from '../logger'

const MOD = 'slack-user-info'

/**
 * Resolves a Slack user id to a human-readable display name via users.info.
 * Slack's basic message event only ever carries the raw user id (e.g.
 * `U0BMB9H6SFQ`) — no name — so without this lookup the id itself ends up
 * stored and rendered as the ticket's "From" field. Needs the `users:read`
 * scope, which existing installs won't have until they reconnect Slack;
 * `missing_scope` is treated the same as any other failure. Returns null on
 * any failure — a missing name degrades to the raw id already being used
 * today, never blocks ticket creation.
 */
export async function getSlackDisplayName(
  botToken: string,
  userId: string
): Promise<string | null> {
  try {
    const url = new URL('https://slack.com/api/users.info')
    url.searchParams.set('user', userId)

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${botToken}` },
      signal: AbortSignal.timeout(10_000),
    })
    const data = (await res.json()) as {
      ok: boolean
      user?: { profile?: { display_name?: string; real_name?: string } }
      error?: string
    }

    if (!data.ok || !data.user) {
      logger.warn('users.info failed', { module: MOD, userId, error: data.error })
      return null
    }

    const name = data.user.profile?.display_name?.trim() || data.user.profile?.real_name?.trim()
    return name || null
  } catch (err) {
    logger.warn('users.info request failed', { module: MOD, userId, error: err })
    return null
  }
}
