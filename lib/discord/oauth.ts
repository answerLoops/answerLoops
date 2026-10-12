// Discord "Add to Discord" install flow helpers: builds the authorize URL and,
// on the callback, confirms which server was authorized and that the person
// who authorized it can manage that server.

const DISCORD_API = 'https://discord.com/api/v10'

// Permissions: View Channel + Send Messages + Read Message History + Add Reactions + Embed Links
const DISCORD_BOT_PERMISSIONS = '85056'

// `bot` adds the bot to the chosen server; `identify guilds` lets us read the
// authorizing user's server list (with their permissions) after the exchange.
const DISCORD_INSTALL_SCOPES = 'bot identify guilds'

const ADMINISTRATOR = BigInt(0x8)
const MANAGE_GUILD = BigInt(0x20)
const ZERO = BigInt(0)

export function buildDiscordInviteUrl(args: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL('https://discord.com/oauth2/authorize')
  url.searchParams.set('client_id', args.clientId)
  url.searchParams.set('scope', DISCORD_INSTALL_SCOPES)
  url.searchParams.set('permissions', DISCORD_BOT_PERMISSIONS)
  url.searchParams.set('redirect_uri', args.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', args.state)
  return url.toString()
}

/** True when the user owns the server or the permission bitfield grants Administrator or Manage Server. */
export function canManageGuild(guild: { owner?: boolean; permissions?: string | number | null }): boolean {
  if (guild.owner) return true
  if (guild.permissions === undefined || guild.permissions === null) return false
  try {
    const bits = BigInt(guild.permissions)
    return (bits & ADMINISTRATOR) !== ZERO || (bits & MANAGE_GUILD) !== ZERO
  } catch {
    return false
  }
}

type DiscordInstallError =
  | 'server_misconfigured'
  | 'token_exchange_failed'
  | 'guild_not_authorized'
  | 'not_guild_admin'
  | 'bot_not_in_guild'

type DiscordInstallResult =
  | { ok: true; guildId: string; guildName: string | null }
  | { ok: false; error: DiscordInstallError }

interface DiscordTokenResponse {
  access_token?: string
  scope?: string
  guild?: { id?: string; name?: string }
}

/**
 * Exchanges the OAuth `code` and returns the server that was authorized. The
 * server id comes from the token response (what Discord actually granted), not
 * from the callback URL. Then checks, using the user's own token, that they own
 * the server or hold Administrator / Manage Server there, and, using the bot
 * token, that the bot is a member of it.
 */
export async function verifyDiscordInstall(args: {
  code: string
  redirectUri: string
  fetchImpl?: typeof fetch
}): Promise<DiscordInstallResult> {
  const clientId = process.env.DISCORD_CLIENT_ID
  const clientSecret = process.env.DISCORD_CLIENT_SECRET
  const botToken = process.env.DISCORD_TOKEN
  if (!clientId || !clientSecret || !botToken) return { ok: false, error: 'server_misconfigured' }

  const doFetch = args.fetchImpl ?? fetch

  const tokenRes = await doFetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code: args.code,
      redirect_uri: args.redirectUri,
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!tokenRes.ok) return { ok: false, error: 'token_exchange_failed' }

  const token = (await tokenRes.json()) as DiscordTokenResponse
  const userToken = token.access_token
  if (!userToken) return { ok: false, error: 'token_exchange_failed' }

  try {
    const guildId = token.guild?.id
    if (!guildId || !/^\d{5,25}$/.test(guildId)) return { ok: false, error: 'guild_not_authorized' }

    const userGuildsRes = await doFetch(`${DISCORD_API}/users/@me/guilds`, {
      headers: { Authorization: `Bearer ${userToken}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!userGuildsRes.ok) return { ok: false, error: 'not_guild_admin' }
    const userGuilds = (await userGuildsRes.json()) as Array<{
      id: string
      name?: string
      owner?: boolean
      permissions?: string | number
    }>
    const userGuild = Array.isArray(userGuilds) ? userGuilds.find((g) => g.id === guildId) : undefined
    if (!userGuild || !canManageGuild(userGuild)) return { ok: false, error: 'not_guild_admin' }

    const botGuildRes = await doFetch(`${DISCORD_API}/guilds/${guildId}`, {
      headers: { Authorization: `Bot ${botToken}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!botGuildRes.ok) return { ok: false, error: 'bot_not_in_guild' }
    const botGuild = (await botGuildRes.json()) as { id?: string; name?: string }
    if (botGuild.id !== guildId) return { ok: false, error: 'bot_not_in_guild' }

    return { ok: true, guildId, guildName: botGuild.name ?? userGuild.name ?? token.guild?.name ?? null }
  } finally {
    // The user token is only needed for the checks above.
    await doFetch(`${DISCORD_API}/oauth2/token/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        token: userToken,
        token_type_hint: 'access_token',
      }),
      signal: AbortSignal.timeout(5_000),
    }).catch(() => undefined)
  }
}
