import crypto from 'crypto'
import { and, eq, isNull, type SQL } from 'drizzle-orm'
import { getDb } from '../drizzle'
import { orgs, subscriptions } from '../schema'
import { isUniqueViolation } from '@/lib/ingest/db-errors'
import { validateWidgetSlug } from '@/lib/widget/slug'
import {
  SAFE_WIDGET_LEAD_CAPTURE_MODE_FALLBACK,
  isWidgetLeadCaptureMode,
  type WidgetLeadCaptureMode,
} from '@/lib/widget/lead-capture'

export interface WidgetOrg {
  id: number
  name: string
  widget_token: string
  plan_id: string
  /** Raw newline-separated allowlist; empty/null means unrestricted. */
  widget_allowed_origins: string | null
  /** When the widget asks for an email. See lib/widget/lead-capture.ts. */
  widget_lead_capture_mode: WidgetLeadCaptureMode
}

export interface WidgetTokenInfo {
  token: string
  expiresAt: string
}

const TOKEN_TTL_DAYS = 90

function expiryFromNow(): string {
  const d = new Date()
  d.setDate(d.getDate() + TOKEN_TTL_DAYS)
  return d.toISOString()
}

async function findWidgetOrg(match: SQL): Promise<WidgetOrg | null> {
  const [row] = await getDb()
    .select({
      id: orgs.id,
      name: orgs.name,
      widget_token: orgs.widgetToken,
      widget_token_expires_at: orgs.widgetTokenExpiresAt,
      widget_allowed_origins: orgs.widgetAllowedOrigins,
      widget_lead_capture_mode: orgs.widgetLeadCaptureMode,
      plan_id: subscriptions.planId,
    })
    .from(orgs)
    .leftJoin(subscriptions, eq(subscriptions.orgId, orgs.id))
    // deletedAt is part of the predicate, not an afterthought: softDeleteOrg is
    // documented as revoking access the moment it is set, and auth.ts enforces
    // that for every dashboard and API path. The widget is unauthenticated, so
    // nothing else was applying it here — a deleted customer's widget kept
    // answering from their knowledge base, spending against their AI provider
    // and writing new leads, for the whole 30-day grace period.
    .where(and(match, isNull(orgs.deletedAt)))
    .limit(1)

  if (!row) return null
  if (row.widget_token_expires_at && new Date(row.widget_token_expires_at) < new Date()) return null
  return {
    id: row.id,
    name: row.name,
    widget_token: row.widget_token!,
    plan_id: row.plan_id ?? 'none',
    widget_allowed_origins: row.widget_allowed_origins,
    // Defensive fallback for a row written before validation existed, or
    // touched directly outside setWidgetLeadCaptureMode — never trust a text
    // column at read time just because the write path validates it. Falls
    // back to the pre-existing behaviour (SAFE_..._FALLBACK), not the
    // new-org default — see its doc comment in lib/widget/lead-capture.ts.
    widget_lead_capture_mode: isWidgetLeadCaptureMode(row.widget_lead_capture_mode)
      ? row.widget_lead_capture_mode
      : SAFE_WIDGET_LEAD_CAPTURE_MODE_FALLBACK,
  }
}

export async function getOrgByWidgetToken(token: string): Promise<WidgetOrg | null> {
  return findWidgetOrg(eq(orgs.widgetToken, token))
}

/**
 * Resolve a public slug to the workspace it names, under exactly the rules a
 * token gets: a deleted workspace or an expired token resolves to nothing.
 */
export async function getOrgByWidgetSlug(slug: string): Promise<WidgetOrg | null> {
  return findWidgetOrg(eq(orgs.widgetSlug, slug))
}

export async function ensureWidgetToken(orgId: number): Promise<WidgetTokenInfo> {
  const [row] = await getDb()
    .select({ widgetToken: orgs.widgetToken, widgetTokenExpiresAt: orgs.widgetTokenExpiresAt })
    .from(orgs)
    .where(eq(orgs.id, orgId))
    .limit(1)

  if (row?.widgetToken && row.widgetTokenExpiresAt && new Date(row.widgetTokenExpiresAt) > new Date()) {
    return { token: row.widgetToken, expiresAt: row.widgetTokenExpiresAt }
  }

  return rotateWidgetToken(orgId)
}

export async function rotateWidgetToken(orgId: number): Promise<WidgetTokenInfo> {
  const token = crypto.randomBytes(24).toString('hex')
  const expiresAt = expiryFromNow()
  await getDb()
    .update(orgs)
    .set({ widgetToken: token, widgetTokenExpiresAt: expiresAt })
    .where(eq(orgs.id, orgId))
  return { token, expiresAt }
}

/** Replace the org's widget origin allowlist. Empty list clears it (unrestricted). */
export async function setWidgetAllowedOrigins(orgId: number, origins: string[]): Promise<void> {
  await getDb()
    .update(orgs)
    .set({ widgetAllowedOrigins: origins.length ? origins.join('\n') : null })
    .where(eq(orgs.id, orgId))
}

/** Current allowlist for the settings UI, as normalised hostnames. */
export async function getWidgetAllowedOrigins(orgId: number): Promise<string | null> {
  const [row] = await getDb()
    .select({ origins: orgs.widgetAllowedOrigins })
    .from(orgs)
    .where(eq(orgs.id, orgId))
    .limit(1)
  return row?.origins ?? null
}

/** Current lead-capture mode for the settings UI and the widget page. */
export async function getWidgetLeadCaptureMode(orgId: number): Promise<WidgetLeadCaptureMode> {
  const [row] = await getDb()
    .select({ mode: orgs.widgetLeadCaptureMode })
    .from(orgs)
    .where(eq(orgs.id, orgId))
    .limit(1)
  return isWidgetLeadCaptureMode(row?.mode) ? row.mode : SAFE_WIDGET_LEAD_CAPTURE_MODE_FALLBACK
}

/**
 * Set the org's widget lead-capture mode. Validated here rather than trusted
 * from the caller — this is the only write path, so an invalid value must
 * stop here rather than reach the column (see widgetLeadCaptureMode's doc
 * comment in lib/db/schema.ts: there is no DB-level CHECK for it).
 */
export async function setWidgetLeadCaptureMode(orgId: number, mode: string): Promise<void> {
  if (!isWidgetLeadCaptureMode(mode)) {
    throw new Error(`Invalid widget lead capture mode: ${mode}`)
  }
  await getDb().update(orgs).set({ widgetLeadCaptureMode: mode }).where(eq(orgs.id, orgId))
}

/** The org's current public slug, or null when none has been chosen. */
export async function getWidgetSlug(orgId: number): Promise<string | null> {
  const [row] = await getDb()
    .select({ slug: orgs.widgetSlug })
    .from(orgs)
    .where(eq(orgs.id, orgId))
    .limit(1)
  return row?.slug ?? null
}

export type SetWidgetSlugResult = { ok: true; slug: string | null } | { ok: false; error: string }

/**
 * Set or clear (null) the org's public widget slug. Validated here as well as
 * in the action, because this is the only write path and the column has no
 * CHECK. A slug already held by another workspace reports as taken rather than
 * throwing, so two owners racing for the same name get a clear answer.
 */
export async function setWidgetSlug(orgId: number, raw: string | null): Promise<SetWidgetSlugResult> {
  let slug: string | null = null
  if (raw !== null) {
    const checked = validateWidgetSlug(raw)
    if (!checked.ok) return checked
    slug = checked.slug
  }
  try {
    await getDb().update(orgs).set({ widgetSlug: slug }).where(eq(orgs.id, orgId))
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: 'That name is already taken. Try another.' }
    throw err
  }
  return { ok: true, slug }
}
