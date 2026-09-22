import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { parseDiscordGuildChannelIds, DiscordGuildTakenError, type DiscordGuild } from '../../lib/db/queries/discord-guilds'

const ROOT = process.cwd()
function readSource(relPath: string): string {
  const absPath = path.join(ROOT, relPath)
  expect(fs.existsSync(absPath), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(absPath, 'utf-8')
}

function makeGuild(overrides: Partial<DiscordGuild> = {}): DiscordGuild {
  return {
    id: 1,
    org_id: 1,
    guild_id: '111',
    guild_name: 'Test Server',
    channel_ids: null,
    escalation_role_id: null,
    enabled: 1,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

describe('parseDiscordGuildChannelIds', () => {
  it('returns [] when channel_ids is null', () => {
    expect(parseDiscordGuildChannelIds(makeGuild({ channel_ids: null }))).toEqual([])
  })

  it('parses a JSON array of channel ids', () => {
    const guild = makeGuild({ channel_ids: JSON.stringify(['111', '222']) })
    expect(parseDiscordGuildChannelIds(guild)).toEqual(['111', '222'])
  })

  it('returns [] on malformed JSON instead of throwing', () => {
    const guild = makeGuild({ channel_ids: 'not json' })
    expect(parseDiscordGuildChannelIds(guild)).toEqual([])
  })
})

describe('DiscordGuildTakenError', () => {
  it('carries the guild id in its message', () => {
    const err = new DiscordGuildTakenError('123456789')
    expect(err.message).toContain('123456789')
    expect(err.name).toBe('DiscordGuildTakenError')
  })
})

// A second org can't silently steal a guild connection that's already owned
// by another org — connecting the same guild id must throw, not overwrite.
// Reconnecting the SAME org's own guild must be a no-op, not an error
// (re-clicking "Add to Discord" for a server you already own shouldn't break).
describe('addDiscordGuild ownership rules (source assertions)', () => {
  const src = readSource('lib/db/queries/discord-guilds.ts')

  it('throws DiscordGuildTakenError only when the existing row belongs to a different org', () => {
    expect(src).toContain('existing.org_id !== orgId')
    expect(src).toContain('throw new DiscordGuildTakenError(guildId)')
  })

  it('is idempotent when the requesting org already owns the guild', () => {
    expect(src).toContain('return existing')
  })
})

describe('bot process routes per-guild lookups through discord_guilds, not the single-guild integrations column', () => {
  it('bot/index.ts imports getDiscordGuildByGuildId', () => {
    const src = readSource('bot/index.ts')
    expect(src).toContain("import { getDiscordGuildByGuildId, parseDiscordGuildChannelIds } from '../lib/db/queries/discord-guilds'")
  })

  it('loadOrgConfigForGuild resolves botSecret from the org-level integrations row, not the guild row', () => {
    const src = readSource('bot/index.ts')
    expect(src).toContain('getDiscordGuildByGuildId(guildId)')
    expect(src).toContain("getIntegration(guildRow.org_id, 'discord')")
  })
})

describe('OAuth callback connects guilds without overwriting existing connections', () => {
  it('app/api/discord/callback/route.ts calls addDiscordGuild instead of upserting a single connected_guild_id', () => {
    const src = readSource('app/api/discord/callback/route.ts')
    expect(src).toContain('addDiscordGuild(orgId, guildId)')
    expect(src).not.toContain('connectedGuildId: guildId')
  })

  it('surfaces a guild-already-connected error to the redirect instead of throwing an unhandled 500', () => {
    const src = readSource('app/api/discord/callback/route.ts')
    expect(src).toContain('DiscordGuildTakenError')
    expect(src).toContain('guild_already_connected')
  })
})

describe('settings actions expose per-guild save/remove, not just the single-integration actions', () => {
  it('lib/actions/integrations.ts exports saveDiscordGuildChannelsAction and removeDiscordGuildAction', () => {
    const src = readSource('lib/actions/integrations.ts')
    expect(src).toContain('export async function saveDiscordGuildChannelsAction')
    expect(src).toContain('export async function removeDiscordGuildAction')
  })
})
