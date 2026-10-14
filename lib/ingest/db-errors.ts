/** Postgres unique-violation SQLSTATE; drizzle nests the driver error under `cause`. */
export function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: unknown; cause?: unknown }
  if (e.code === '23505') return true
  return isUniqueViolation(e.cause)
}
