import type { TrendPoint } from '@/lib/db/queries/analytics'

/** The windows the trend chart offers, in days. */
export const TREND_RANGES = [7, 30, 90] as const
export type TrendRange = (typeof TREND_RANGES)[number]
export const DEFAULT_TREND_RANGE: TrendRange = 30

/** A ?range= value as a supported window, or the default for anything else. */
export function parseTrendRange(value: string | string[] | undefined): TrendRange {
  const n = Number(Array.isArray(value) ? value[0] : value)
  return (TREND_RANGES as readonly number[]).includes(n) ? (n as TrendRange) : DEFAULT_TREND_RANGE
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10)

/**
 * One point per day for the last `days` days, ending today (UTC, the same way
 * the query groups them). The query only returns days that had answers, which
 * would squash a chart with gaps, so quiet days are filled in as zeros.
 */
export function fillTrendDays(trend: TrendPoint[], days: number, now: Date = new Date()): TrendPoint[] {
  const byDay = new Map(trend.map((t) => [t.day, t]))
  const out: TrendPoint[] = []
  for (let i = days - 1; i >= 0; i--) {
    const day = dayKey(new Date(now.getTime() - i * 86_400_000))
    const hit = byDay.get(day)
    out.push({ day, answered: hit?.answered ?? 0, deflected: hit?.deflected ?? 0 })
  }
  return out
}
