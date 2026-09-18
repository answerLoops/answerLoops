import * as Sentry from '@sentry/nextjs'

type Level = 'debug' | 'info' | 'warn' | 'error'

interface LogFields {
  module?: string
  ticketId?: number
  orgId?: number
  durationMs?: number
  error?: unknown
  /** Correlation id for tracing one request across logs — see lib/request-id.ts. */
  requestId?: string
  [key: string]: unknown
}

const IS_PROD = process.env.NODE_ENV === 'production'

// Driver errors (postgres.js, etc.) attach the actually-useful fields — code,
// detail, hint, severity, column, table, cause — as extra own-enumerable
// properties beyond the standard Error shape. Without capturing those, every
// database error logs as an unhelpful "Failed query: ..." with the query
// text but no reason it failed.
function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const base: Record<string, unknown> = { message: err.message, name: err.name, stack: err.stack }
    for (const key of Object.keys(err)) {
      if (key in base) continue
      const value = (err as unknown as Record<string, unknown>)[key]
      if (typeof value === 'function') continue
      base[key] = value instanceof Error ? serializeError(value) : value
    }
    return base
  }
  return { raw: String(err) }
}

function log(level: Level, message: string, fields: LogFields = {}): void {
  const { error, ...rest } = fields
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...rest,
    ...(error !== undefined ? { error: serializeError(error) } : {}),
  }

  // No-ops when SENTRY_DSN is unset (see sentry.server.config.ts) — every
  // logger.error() call also reports to Sentry so a real error tracker
  // captures the same failures the structured log already records, instead
  // of only whatever Next.js's own onRequestError hook happens to catch.
  if (level === 'error') {
    Sentry.withScope((scope) => {
      for (const [key, value] of Object.entries(rest)) scope.setExtra(key, value)
      if (typeof rest.requestId === 'string') scope.setTag('requestId', rest.requestId)
      if (typeof rest.module === 'string') scope.setTag('module', rest.module)
      Sentry.captureException(error instanceof Error ? error : new Error(message), scope)
    })
  }

  if (IS_PROD) {
    // JSON to stdout — structured for log aggregators
    process.stdout.write(JSON.stringify(entry) + '\n')
  } else {
    const prefix = `[${entry.ts}] ${level.toUpperCase().padEnd(5)} ${fields.module ? `[${fields.module}]` : ''}`
    const detail = Object.keys(rest).filter((k) => k !== 'module').length
      ? ' ' + JSON.stringify(rest)
      : ''
    if (level === 'error' || level === 'warn') {
      console.error(`${prefix} ${message}${detail}`, error ?? '') // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring
    } else {
      console.log(`${prefix} ${message}${detail}`) // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring
    }
  }
}

export const logger = {
  debug: (msg: string, fields?: LogFields) => log('debug', msg, fields),
  info:  (msg: string, fields?: LogFields) => log('info',  msg, fields),
  warn:  (msg: string, fields?: LogFields) => log('warn',  msg, fields),
  error: (msg: string, fields?: LogFields) => log('error', msg, fields),
}
