/**
 * How much the website chat widget may be used, per visitor, per widget and per
 * workspace.
 *
 * The defaults suit the hosted service. A self-hosted instance can change any
 * of them with the environment variables named below (see
 * content/docs/reference/environment-variables.mdx), for example to admit more
 * traffic from one office network or to set a lower ceiling for every
 * workspace. A missing, non-numeric or out-of-range value falls back to the
 * default rather than failing, so a typo never takes the widget down.
 *
 * On top of the instance's ceiling, each workspace owner can set a lower daily
 * limit for their own widget in Settings → Widget (orgs.widget_daily_answer_limit),
 * and is emailed once when a day's answers reach 80% of it and once when they
 * reach it.
 */

export interface WidgetUsageLimits {
  /** Chat requests per visitor address per widget, per minute. */
  perVisitorPerMinute: number
  /** Chat requests per widget across all visitors, per minute. */
  perWidgetPerMinute: number
  /** Any widget chat request from one address, per minute, whatever its shape. */
  perAddressPerMinute: number
  /** Answers per workspace per hour. */
  perWorkspacePerHour: number
  /** Answers per workspace per day: the instance's ceiling, which an owner can lower. */
  perWorkspacePerDay: number
  /** Widget page loads per visitor address, per minute. */
  loadsPerAddressPerMinute: number
  /** Widget page loads per widget, per minute. */
  loadsPerWidgetPerMinute: number
}

export const DEFAULT_WIDGET_USAGE_LIMITS: WidgetUsageLimits = {
  perVisitorPerMinute: 20,
  perWidgetPerMinute: 100,
  perAddressPerMinute: 60,
  perWorkspacePerHour: 500,
  perWorkspacePerDay: 3_000,
  loadsPerAddressPerMinute: 30,
  loadsPerWidgetPerMinute: 600,
}

export const WIDGET_USAGE_LIMIT_ENV: Record<keyof WidgetUsageLimits, string> = {
  perVisitorPerMinute: 'WIDGET_LIMIT_PER_VISITOR_PER_MINUTE',
  perWidgetPerMinute: 'WIDGET_LIMIT_PER_WIDGET_PER_MINUTE',
  perAddressPerMinute: 'WIDGET_LIMIT_PER_ADDRESS_PER_MINUTE',
  perWorkspacePerHour: 'WIDGET_LIMIT_PER_WORKSPACE_PER_HOUR',
  perWorkspacePerDay: 'WIDGET_LIMIT_PER_WORKSPACE_PER_DAY',
  loadsPerAddressPerMinute: 'WIDGET_LIMIT_LOADS_PER_ADDRESS_PER_MINUTE',
  loadsPerWidgetPerMinute: 'WIDGET_LIMIT_LOADS_PER_WIDGET_PER_MINUTE',
}

/** No limit may be set above this, so a stray extra digit cannot remove it in practice. */
export const MAX_WIDGET_LIMIT_VALUE = 1_000_000

function readLimit(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw || !/^\d+$/.test(raw)) return fallback
  const value = Number(raw)
  return value >= 1 && value <= MAX_WIDGET_LIMIT_VALUE ? value : fallback
}

/** The instance's limits, read from the environment each call so a restart is all a change needs. */
export function widgetUsageLimits(): WidgetUsageLimits {
  const limits = { ...DEFAULT_WIDGET_USAGE_LIMITS }
  for (const key of Object.keys(limits) as (keyof WidgetUsageLimits)[]) {
    limits[key] = readLimit(WIDGET_USAGE_LIMIT_ENV[key], DEFAULT_WIDGET_USAGE_LIMITS[key])
  }
  return limits
}

/**
 * The day's limit that applies to a workspace: the owner's own limit when they
 * set one, never above the instance's ceiling.
 */
export function effectiveDailyLimit(ownerLimit: number | null | undefined, ceiling: number): number {
  if (typeof ownerLimit !== 'number' || !Number.isInteger(ownerLimit) || ownerLimit < 1) return ceiling
  return Math.min(ownerLimit, ceiling)
}

export type DailyLimitInput = { ok: true; value: number | null } | { ok: false; error: string }

/**
 * Validates what an owner typed for their daily limit. Empty means no limit of
 * their own (the instance's ceiling applies).
 */
export function normalizeDailyLimit(raw: unknown, ceiling: number): DailyLimitInput {
  if (raw === null || raw === undefined) return { ok: true, value: null }
  const text = String(raw).trim().replace(/[,\s_]/g, '')
  if (text === '') return { ok: true, value: null }
  if (!/^\d+$/.test(text)) return { ok: false, error: 'Enter a whole number of answers.' }
  const value = Number(text)
  if (value < 1) return { ok: false, error: 'Enter at least 1 answer a day, or leave it empty for no limit of your own.' }
  if (value > ceiling) {
    return { ok: false, error: `This instance allows at most ${ceiling.toLocaleString('en-US')} answers a day per workspace.` }
  }
  return { ok: true, value }
}

/** Share of the daily limit at which the owner is warned. */
export const DAILY_LIMIT_WARNING_SHARE = 0.8

export type DailyLimitAlert = 'warning' | 'reached'

/**
 * Whether this answer is the one that crosses a threshold, given the day's
 * count including it. Each count is returned once per day by the shared
 * counter, so each alert fires at most once a day without separate bookkeeping.
 */
export function dailyLimitAlert(count: number, limit: number): DailyLimitAlert | null {
  if (count === limit) return 'reached'
  if (count === Math.ceil(limit * DAILY_LIMIT_WARNING_SHARE)) return 'warning'
  return null
}
