/**
 * Board timestamps come from two writers: Postgres' `now()` cast to text
 * ("2026-10-07 17:08:00.123+00") and `new Date().toISOString()`. The first is
 * not valid ISO 8601 and Safari rejects it, so normalise before parsing.
 */
export function parseBoardDate(value: string): Date | null {
  let v = value.trim().replace(' ', 'T')
  if (/[+-]\d{2}$/.test(v)) v += ':00'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

export function formatBoardDate(value: string): string {
  const d = parseBoardDate(value)
  if (!d) return ''
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
