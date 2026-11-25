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
import {
  SAFE_WIDGET_ANSWER_SCOPE_FALLBACK,
  isWidgetAnswerScope,
  normalizeWidgetGuidance,
  type WidgetAnswerScope,
} from '@/lib/widget/answer-scope'
import {
  normalizeBrandColor,
  normalizeWidgetTitle,
  normalizeWidgetWelcome,
  normalizeStarterQuestions,
  readFollowUpsEnabled,
  readStarterEnabled,
  readWidgetAppearance,
  serializeFollowUpsEnabled,
  serializeStarterEnabled,
  serializeStarterQuestions,
  type WidgetAppearance,
} from '@/lib/widget/appearance'

export interface WidgetOrg {
  id: number
  name: string
  widget_token: string
  plan_id: string
  /** Raw newline-separated allowlist; empty/null means unrestricted. */
  widget_allowed_origins: string | null
  /** When the widget asks for an email. See lib/widget/lead-capture.ts. */
  widget_lead_capture_mode: WidgetLeadCaptureMode
  /** What the widget may answer from. See lib/widget/answer-scope.ts. */
  widget_answer_scope: WidgetAnswerScope
  /** The owner's note on tone and next steps, or null. */
  widget_guidance: string | null
  /** Chat title, welcome message and brand color the owner chose, each null for the default. */
  widget_appearance: WidgetAppearance
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
      widget_answer_scope: orgs.widgetAnswerScope,
      widget_guidance: orgs.widgetGuidance,
      widget_title: orgs.widgetTitle,
      widget_welcome: orgs.widgetWelcome,
      widget_brand_color: orgs.widgetBrandColor,
      widget_starter_questions: orgs.widgetStarterQuestions,
      widget_starter_enabled: orgs.widgetStarterEnabled,
      widget_follow_ups_enabled: orgs.widgetFollowUpsEnabled,
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
    // Read the same defensive way, but an unreadable value falls back to the
    // narrower scope, not the old behaviour: this controls what an anonymous
    // visitor can be told, so an unclear value must not widen it.
    widget_answer_scope: isWidgetAnswerScope(row.widget_answer_scope)
      ? row.widget_answer_scope
      : SAFE_WIDGET_ANSWER_SCOPE_FALLBACK,
    // Re-cleaned on read so a note written outside the setter (a hand edit, a
    // restored backup) can never put oversized or malformed text into every
    // answer's instructions. Anything that does not pass is treated as none.
    widget_guidance: (() => {
      const result = normalizeWidgetGuidance(row.widget_guidance)
      return result.ok ? result.value : null
    })(),
    // Same defensive read: anything that would not pass the write-side checks
    // is treated as not set, so a hand-edited row cannot put oversized text or
    // an unusable color into a live widget.
    widget_appearance: readWidgetAppearance({
      title: row.widget_title,
      welcome: row.widget_welcome,
      brandColor: row.widget_brand_color,
      starterQuestions: row.widget_starter_questions,
      starterEnabled: row.widget_starter_enabled,
      followUpsEnabled: row.widget_follow_ups_enabled,
    }),
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

export interface WidgetAnswerSettings {
  answerScope: WidgetAnswerScope
  guidance: string | null
}

/** Current answer scope and guidance note, for the settings UI. */
export async function getWidgetAnswerSettings(orgId: number): Promise<WidgetAnswerSettings> {
  const [row] = await getDb()
    .select({ scope: orgs.widgetAnswerScope, guidance: orgs.widgetGuidance })
    .from(orgs)
    .where(eq(orgs.id, orgId))
    .limit(1)
  const guidance = normalizeWidgetGuidance(row?.guidance)
  return {
    answerScope: isWidgetAnswerScope(row?.scope) ? row.scope : SAFE_WIDGET_ANSWER_SCOPE_FALLBACK,
    guidance: guidance.ok ? guidance.value : null,
  }
}

/**
 * Set what the org's widget may answer from. Validated here, the only write
 * path, because the column has no DB-level CHECK: an unknown value must stop
 * here rather than be stored and later read as something it is not.
 */
export async function setWidgetAnswerScope(orgId: number, scope: string): Promise<void> {
  if (!isWidgetAnswerScope(scope)) {
    throw new Error(`Invalid widget answer scope: ${scope}`)
  }
  await getDb().update(orgs).set({ widgetAnswerScope: scope }).where(eq(orgs.id, orgId))
}

/**
 * Set the org's guidance note. Cleaned and length-checked here as well as in
 * the action, so no caller can store text the read path would then discard.
 * Pass an empty string or null to clear it.
 */
export async function setWidgetGuidance(orgId: number, guidance: string | null): Promise<void> {
  const result = normalizeWidgetGuidance(guidance)
  if (!result.ok) throw new Error(result.error)
  await getDb().update(orgs).set({ widgetGuidance: result.value }).where(eq(orgs.id, orgId))
}

/** What the owner has chosen for the widget's title, welcome message, brand color and starter questions. */
export async function getWidgetAppearance(orgId: number): Promise<WidgetAppearance> {
  const [row] = await getDb()
    .select({
      title: orgs.widgetTitle,
      welcome: orgs.widgetWelcome,
      brandColor: orgs.widgetBrandColor,
      starterQuestions: orgs.widgetStarterQuestions,
      starterEnabled: orgs.widgetStarterEnabled,
      followUpsEnabled: orgs.widgetFollowUpsEnabled,
    })
    .from(orgs)
    .where(eq(orgs.id, orgId))
    .limit(1)
  return readWidgetAppearance({
    title: row?.title,
    welcome: row?.welcome,
    brandColor: row?.brandColor,
    starterQuestions: row?.starterQuestions,
    starterEnabled: row?.starterEnabled,
    followUpsEnabled: row?.followUpsEnabled,
  })
}

/**
 * Save the widget's title, welcome message and brand color. Cleaned and checked
 * here as well as in the action, so no caller can store a value the read path
 * would then discard. A null or empty field goes back to the default.
 */
export async function setWidgetAppearance(
  orgId: number,
  input: { title: unknown; welcome: unknown; brandColor: unknown; starterQuestions?: unknown; starterEnabled?: unknown; followUpsEnabled?: unknown }
): Promise<WidgetAppearance> {
  const title = normalizeWidgetTitle(input.title)
  if (!title.ok) throw new Error(title.error)
  const welcome = normalizeWidgetWelcome(input.welcome)
  if (!welcome.ok) throw new Error(welcome.error)
  const color = normalizeBrandColor(input.brandColor)
  if (!color.ok) throw new Error(color.error)
  const starters = normalizeStarterQuestions(input.starterQuestions)
  if (!starters.ok) throw new Error(starters.error)
  const starterEnabled = readStarterEnabled(input.starterEnabled)
  const followUpsEnabled = readFollowUpsEnabled(input.followUpsEnabled)
  await getDb()
    .update(orgs)
    .set({
      widgetTitle: title.value,
      widgetWelcome: welcome.value,
      widgetBrandColor: color.value,
      widgetStarterQuestions: serializeStarterQuestions(starters.value),
      widgetStarterEnabled: serializeStarterEnabled(starterEnabled),
      widgetFollowUpsEnabled: serializeFollowUpsEnabled(followUpsEnabled),
    })
    .where(eq(orgs.id, orgId))
  return { title: title.value, welcome: welcome.value, brandColor: color.value, starterQuestions: starters.value, starterEnabled, followUpsEnabled }
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
