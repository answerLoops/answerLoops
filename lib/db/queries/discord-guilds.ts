import { eq, and } from 'drizzle-orm'
import { getDb } from '../drizzle'
import { discordGuilds } from '../schema'

export interface DiscordGuild {
  id: number
  org_id: number
  guild_id: string
  guild_name: string | null
  channel_ids: string | null
  escalation_role_id: string | null
  enabled: number
  created_at: string
  updated_at: string
}

export class DiscordGuildTakenError extends Error {
  constructor(guildId: string) {
    super(`Discord server ${guildId} is already connected to another answerLoops org`)
    this.name = 'DiscordGuildTakenError'
  }
}

function toDiscordGuild(row: typeof discordGuilds.$inferSelect): DiscordGuild {
  return {
    id: row.id,
    org_id: row.orgId,
    guild_id: row.guildId,
    guild_name: row.guildName,
    channel_ids: row.channelIds,
    escalation_role_id: row.escalationRoleId,
    enabled: row.enabled,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }
}

export async function listDiscordGuilds(orgId: number): Promise<DiscordGuild[]> {
  const rows = await getDb()
    .select()
    .from(discordGuilds)
    .where(eq(discordGuilds.orgId, orgId))
    .orderBy(discordGuilds.createdAt)
  return rows.map(toDiscordGuild)
}

export async function getDiscordGuildByGuildId(guildId: string): Promise<DiscordGuild | null> {
  const [row] = await getDb()
    .select()
    .from(discordGuilds)
    .where(and(eq(discordGuilds.guildId, guildId), eq(discordGuilds.enabled, 1)))
    .limit(1)
  return row ? toDiscordGuild(row) : null
}

/** Connects a new Discord server to an org. Idempotent if this org already owns it; throws if another org does. */
export async function addDiscordGuild(orgId: number, guildId: string, guildName?: string | null): Promise<DiscordGuild> {
  const existing = await getDiscordGuildByGuildId(guildId)
  if (existing) {
    if (existing.org_id !== orgId) throw new DiscordGuildTakenError(guildId)
    return existing
  }

  const [row] = await getDb()
    .insert(discordGuilds)
    .values({ orgId, guildId, guildName: guildName ?? null })
    .returning()
  return toDiscordGuild(row)
}

export async function updateDiscordGuildChannels(
  orgId: number,
  guildId: string,
  channelIds: string[],
  escalationRoleId?: string | null
): Promise<void> {
  await getDb()
    .update(discordGuilds)
    .set({
      channelIds: JSON.stringify(channelIds),
      escalationRoleId: escalationRoleId !== undefined ? escalationRoleId : undefined,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(discordGuilds.orgId, orgId), eq(discordGuilds.guildId, guildId)))
}

export async function removeDiscordGuild(orgId: number, guildId: string): Promise<void> {
  await getDb()
    .delete(discordGuilds)
    .where(and(eq(discordGuilds.orgId, orgId), eq(discordGuilds.guildId, guildId)))
}

export function parseDiscordGuildChannelIds(guild: DiscordGuild): string[] {
  if (!guild.channel_ids) return []
  try {
    return JSON.parse(guild.channel_ids) as string[]
  } catch {
    return []
  }
}
