/**
 * When set, all external services (OpenAI, Discord) are replaced with
 * deterministic in-process fakes. Used by the e2e suite so tests are free,
 * offline, and reproducible — never spending tokens or posting to Discord.
 *
 * Enabled by `MOCK_EXTERNALS=1` in the environment. Mock mode switches off
 * request verification and replaces real services, so a production process
 * refuses to start with it set. The e2e suite serves a production build, so
 * it opts in explicitly with `MOCK_EXTERNALS_E2E=1` (set in
 * playwright.config.ts); no deployment should ever set that variable.
 */
function resolveMockExternals(): boolean {
  const enabled = process.env.MOCK_EXTERNALS === '1'
  if (
    enabled &&
    process.env.NODE_ENV === 'production' &&
    process.env.NEXT_PHASE !== 'phase-production-build' &&
    process.env.MOCK_EXTERNALS_E2E !== '1'
  ) {
    throw new Error('MOCK_EXTERNALS must not be set when NODE_ENV=production')
  }
  return enabled
}

export const MOCK_EXTERNALS = resolveMockExternals()
