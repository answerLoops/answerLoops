export async function register() {
  // Set before any route module (and so before @copilotkit/runtime) is ever
  // imported — this is a fully self-hosted, open-source integration and must
  // not phone home to CopilotKit's telemetry endpoint by default. Only set if
  // absent so an operator who explicitly wants telemetry can still opt back
  // in via their own environment.
  process.env.COPILOTKIT_TELEMETRY_DISABLED ??= 'true'

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { runMigrations } = await import('@/lib/db/migrate')
    await runMigrations()

    const { logSignupPosture } = await import('@/lib/auth/signup-posture')
    logSignupPosture()
  }
}
