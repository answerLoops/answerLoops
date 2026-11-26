import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Circle replies add two nullable columns to `integrations`: bot_user_id (the
// member id answerLoops's comments are posted as, learned from Circle) and
// team_member_ids (members whose comments are kept as thread context). These
// catch the migration and the Drizzle schema drifting apart, and the hydrated
// row losing either field.

const ROOT = process.cwd()
const file = path.join(ROOT, 'drizzle/0089_circle_replies.sql')

describe('drizzle/0089_circle_replies.sql', () => {
  const sql = fs.readFileSync(file, 'utf-8')

  it('adds both columns to integrations, safe to apply twice', () => {
    expect(sql).toMatch(/ALTER TABLE integrations ADD COLUMN IF NOT EXISTS bot_user_id TEXT;/)
    expect(sql).toMatch(/ALTER TABLE integrations ADD COLUMN IF NOT EXISTS team_member_ids TEXT;/)
  })

  it('separates statements for the migration runner', () => {
    expect(sql).toContain('--> statement-breakpoint')
  })
})

describe('lib/db/schema.ts: integrations', () => {
  it('defines botUserId and teamMemberIds on the matching columns', async () => {
    const { integrations } = await import('../../lib/db/schema')
    const cols = integrations as unknown as Record<string, { name: string }>
    expect(cols.botUserId.name).toBe('bot_user_id')
    expect(cols.teamMemberIds.name).toBe('team_member_ids')
  })
})

describe('parseTeamMemberIds', () => {
  it('reads the stored list, and treats an empty or unreadable value as none', async () => {
    const { parseTeamMemberIds } = await import('@/lib/db/queries/integrations')
    expect(parseTeamMemberIds({ team_member_ids: '["101","202"]' })).toEqual(['101', '202'])
    expect(parseTeamMemberIds({ team_member_ids: null })).toEqual([])
    expect(parseTeamMemberIds({ team_member_ids: 'not json' })).toEqual([])
    expect(parseTeamMemberIds({ team_member_ids: '{"a":1}' })).toEqual([])
  })
})
