import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { getDb } from '../drizzle'
import { slaConfigs } from '../schema'
import { BUILT_IN_SLA_TARGETS, SLA_PRIORITIES } from '@/lib/sla/defaults'
import type { SLAConfig, Priority } from '@/types'

function toSLAConfig(row: typeof slaConfigs.$inferSelect): SLAConfig {
  return {
    id: row.id,
    priority: row.priority as Priority,
    response_hours: row.responseHours,
    resolve_hours: row.resolveHours,
    updated_at: row.updatedAt,
  }
}

/**
 * The workspace's own target for a priority, else the global default row
 * (org_id NULL), else null. Other workspaces' rows are never considered.
 */
export async function getSLAConfig(priority: Priority, orgId: number): Promise<SLAConfig | null> {
  const rows = await getDb()
    .select()
    .from(slaConfigs)
    .where(and(eq(slaConfigs.priority, priority), or(eq(slaConfigs.orgId, orgId), isNull(slaConfigs.orgId))))
  const own = rows.find((r) => r.orgId === orgId)
  const row = own ?? rows.find((r) => r.orgId === null)
  return row ? toSLAConfig(row) : null
}

/** One entry per priority: the workspace's own row, else the default, else the built-in target. */
export async function getEffectiveSLAConfigs(orgId: number): Promise<SLAConfig[]> {
  const rows = await getDb()
    .select()
    .from(slaConfigs)
    .where(or(eq(slaConfigs.orgId, orgId), isNull(slaConfigs.orgId)))
  return SLA_PRIORITIES.map((priority, i) => {
    const row =
      rows.find((r) => r.priority === priority && r.orgId === orgId) ??
      rows.find((r) => r.priority === priority && r.orgId === null)
    if (row) return toSLAConfig(row)
    return { id: -(i + 1), priority, ...BUILT_IN_SLA_TARGETS[priority], updated_at: '' }
  })
}

/** Insert or update the workspace's own row for a priority; never touches defaults or other workspaces. */
export async function updateSLAConfig(
  orgId: number,
  priority: Priority,
  responseHours: number,
  resolveHours: number
): Promise<void> {
  await getDb()
    .insert(slaConfigs)
    .values({ orgId, priority, responseHours, resolveHours })
    .onConflictDoUpdate({
      target: [slaConfigs.orgId, slaConfigs.priority],
      targetWhere: sql`org_id IS NOT NULL`,
      set: { responseHours, resolveHours, updatedAt: new Date().toISOString() },
    })
}
