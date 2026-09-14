import { defineConfig, devices } from '@playwright/test'
import path from 'path'

process.env.MOCK_EXTERNALS = '1'
process.env.AUTH_SECRET = 'test-auth-secret'
process.env.BOT_SECRET = 'test-bot-secret'

const PORT = 3100
const BASE_URL = `http://localhost:${PORT}`

export const STORAGE_STATE = path.join(__dirname, 'e2e', '.tmp', 'state.json')

// Never fall back to an ambient DATABASE_URL here — e2e's global-setup truncates
// and reseeds whatever database it resolves to, so silently inheriting a value
// meant for prod debugging or another branch would be destructive, not just wrong.
// If you need a non-default e2e database, set TEST_DATABASE_URL explicitly.
function resolveTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://community:community@localhost:5432/community_test'

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(
      `E2E DATABASE_URL "${url}" doesn't look like a local test database (expected host localhost/127.0.0.1 and a database name containing "test"). Set TEST_DATABASE_URL explicitly if you need something else.`
    )
  }

  const host = parsed.hostname
  const database = parsed.pathname.replace(/^\//, '')
  const isLocalHost = host === 'localhost' || host === '127.0.0.1'
  const looksLikeTestDb = database.toLowerCase().includes('test')

  if (!isLocalHost || !looksLikeTestDb) {
    throw new Error(
      `E2E DATABASE_URL "${url}" doesn't look like a local test database (expected host localhost/127.0.0.1 and a database name containing "test"). Set TEST_DATABASE_URL explicitly if you need something else.`
    )
  }

  return url
}

export const TEST_ENV = {
  DATABASE_URL: resolveTestDatabaseUrl(),
  // Pinned for the same reason AUTH_SECRET/BOT_SECRET are pinned below: Next
  // only fills a var from .env when it's not already in the spawned process's
  // env, so leaving this unset lets a developer's real .env (DEPLOYMENT_MODE=
  // cloud, a live Stripe key) leak into the webServer process. That flips
  // auth.ts's product-access gate on for every non-exempt route, and since
  // global-setup.ts seeds no `subscriptions` row, the whole suite gets
  // redirected to /checkout/start-trial instead of testing the app.
  DEPLOYMENT_MODE: 'self-hosted',
  MOCK_EXTERNALS: '1',
  BOT_SECRET: 'test-bot-secret',
  AUTH_SECRET: 'test-auth-secret',
  AUTH_URL: BASE_URL,
  OPENAI_API_KEY: 'test-openai-key',
  VAPID_PUBLIC_KEY: 'BL_test_vapid_public_key',
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'BL_test_vapid_public_key',
  VAPID_PRIVATE_KEY: 'test_vapid_private_key',
  VAPID_SUBJECT: 'mailto:test@example.com',
}

// Make DATABASE_URL available to globalSetup (same process as config)
process.env.DATABASE_URL = TEST_ENV.DATABASE_URL

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
    storageState: STORAGE_STATE,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node_modules/.bin/next build && node_modules/.bin/next start -p 3100',
    url: BASE_URL,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    env: TEST_ENV,
  },
})
