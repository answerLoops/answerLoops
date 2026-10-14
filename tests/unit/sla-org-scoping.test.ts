import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PgDialect } from 'drizzle-orm/pg-core'

type Row = {
  id: number
  orgId: number | null
  priority: string
  responseHours: number
  resolveHours: number
  updatedAt: string
}

const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  where: undefined as unknown,
  insertValues: undefined as unknown,
  conflict: undefined as unknown,
}))

vi.mock('@/lib/db/drizzle', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: (cond: unknown) => {
          h.where = cond
          return Promise.resolve(h.rows)
        },
      }),
    }),
    insert: () => ({
      values: (v: unknown) => {
        h.insertValues = v
        return {
          onConflictDoUpdate: (c: unknown) => {
            h.conflict = c
            return Promise.resolve()
          },
        }
      },
    }),
  }),
}))

import { getSLAConfig, getEffectiveSLAConfigs, updateSLAConfig } from '@/lib/db/queries/sla'
import { calculateDeadlines } from '@/lib/sla/engine'

const dialect = new PgDialect()
const row = (id: number, orgId: number | null, priority: string, r: number, s: number): Row => ({
  id, orgId, priority, responseHours: r, resolveHours: s, updatedAt: 't',
})

beforeEach(() => {
  h.rows = []
  h.where = undefined
  h.insertValues = undefined
  h.conflict = undefined
})

describe('getSLAConfig', () => {
  it('prefers the workspace row over the global default', async () => {
    h.rows = [row(1, null, 'high', 4, 24), row(2, 7, 'high', 2, 8)]
    expect(await getSLAConfig('high', 7)).toMatchObject({ id: 2, response_hours: 2, resolve_hours: 8 })
  })

  it('falls back to the global default when the workspace has no row', async () => {
    h.rows = [row(1, null, 'high', 4, 24)]
    expect(await getSLAConfig('high', 7)).toMatchObject({ id: 1, response_hours: 4 })
  })

  it('returns null when neither exists', async () => {
    expect(await getSLAConfig('high', 7)).toBeNull()
  })

  it('filters by the requested org id or NULL, never another org', async () => {
    await getSLAConfig('high', 7)
    const { sql: text, params } = dialect.sqlToQuery(h.where as never)
    expect(text).toContain('"org_id" = $')
    expect(text).toContain('"org_id" is null')
    expect(params).toContain(7)
  })
})

describe('getEffectiveSLAConfigs', () => {
  it('returns every priority: own row, else default, else built-in', async () => {
    h.rows = [row(1, null, 'critical', 3, 6), row(2, 7, 'critical', 2, 5), row(3, null, 'high', 5, 30)]
    const out = await getEffectiveSLAConfigs(7)
    expect(out.map((c) => c.priority)).toEqual(['critical', 'high', 'medium', 'low'])
    expect(out[0]).toMatchObject({ id: 2, response_hours: 2, resolve_hours: 5 })
    expect(out[1]).toMatchObject({ id: 3, response_hours: 5 })
    expect(out[2]).toMatchObject({ response_hours: 24, resolve_hours: 72 })
    expect(out[3]).toMatchObject({ response_hours: 72, resolve_hours: 168 })
  })

  it('never exposes another workspace row (filter is org or NULL)', async () => {
    await getEffectiveSLAConfigs(9)
    const { sql: text, params } = dialect.sqlToQuery(h.where as never)
    expect(text).toContain('"org_id" is null')
    expect(params).toEqual([9])
  })
})

describe('updateSLAConfig', () => {
  it('upserts the org-scoped row on the (org_id, priority) partial index', async () => {
    await updateSLAConfig(7, 'low', 10, 20)
    expect(h.insertValues).toMatchObject({ orgId: 7, priority: 'low', responseHours: 10, resolveHours: 20 })
    const c = h.conflict as { target: unknown[]; targetWhere: unknown; set: Record<string, unknown> }
    expect(c.target).toHaveLength(2)
    expect(dialect.sqlToQuery(c.targetWhere as never).sql).toContain('org_id IS NOT NULL')
    expect(c.set).toMatchObject({ responseHours: 10, resolveHours: 20 })
    expect(c.set).not.toHaveProperty('orgId')
  })
})

describe('calculateDeadlines', () => {
  it('uses the ticket org\'s targets', async () => {
    h.rows = [row(1, null, 'high', 4, 24), row(2, 7, 'high', 2, 8)]
    const at = new Date('2026-01-01T00:00:00.000Z')
    const own = await calculateDeadlines('high', 7, at)
    expect(own.sla_response_deadline).toBe('2026-01-01T02:00:00.000Z')
    expect(own.sla_resolve_deadline).toBe('2026-01-01T08:00:00.000Z')
    h.rows = [row(1, null, 'high', 4, 24)]
    const other = await calculateDeadlines('high', 8, at)
    expect(other.sla_response_deadline).toBe('2026-01-01T04:00:00.000Z')
  })

  it('returns null deadlines when no config exists', async () => {
    expect(await calculateDeadlines('high', 7)).toEqual({ sla_response_deadline: null, sla_resolve_deadline: null })
  })
})

describe('migration 0050', () => {
  const sql = readFileSync(join(process.cwd(), 'drizzle/0050_org_scoped_sla_configs.sql'), 'utf8')
  it('adds a cascading org_id, keeps rows as defaults, and enforces both uniqueness rules', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS org_id INTEGER REFERENCES orgs\(id\) ON DELETE CASCADE/)
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS sla_configs_priority_unique')
    expect(sql).toMatch(/sla_configs_org_priority_unique[\s\S]*\(org_id, priority\)[\s\S]*WHERE org_id IS NOT NULL/)
    expect(sql).toMatch(/sla_configs_default_priority_unique[\s\S]*\(priority\)[\s\S]*WHERE org_id IS NULL/)
    expect(sql).not.toMatch(/UPDATE sla_configs|DELETE FROM sla_configs/)
  })
})
