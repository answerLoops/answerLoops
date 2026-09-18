export async function register() {
  // Set before any route module (and so before @copilotkit/runtime) is ever
  // imported — this is a fully self-hosted, open-source integration and must
  // not phone home to CopilotKit's telemetry endpoint by default. Only set if
  // absent so an operator who explicitly wants telemetry can still opt back
  // in via their own environment.
  process.env.COPILOTKIT_TELEMETRY_DISABLED ??= 'true'

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
    const { runMigrations } = await import('@/lib/db/migrate')
    await runMigrations()
  } else if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

// Catches exceptions Next.js itself surfaces (render errors, route handler
// throws that escape a try/catch) that a deliberate logger.error() call
// would otherwise miss. Set SENTRY_DSN to enable — a no-op without it, see
// sentry.server.config.ts / sentry.edge.config.ts.
export async function onRequestError(...args: Parameters<NonNullable<typeof import('@sentry/nextjs').captureRequestError>>) {
  const Sentry = await import('@sentry/nextjs')
  Sentry.captureRequestError(...args)
}
