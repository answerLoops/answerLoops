/**
 * Opens a browser already signed in to the local app as the demo workspace
 * owner, so you can click around the whole dashboard without Google sign-in.
 *
 * Usage (the demo database seeded and the app running; see README.md):
 *   DATABASE_URL=<local-postgres-url> AUTH_SECRET=<same-value-the-app-uses> pnpm demo:open
 *   pnpm demo:open /integrations          open a specific page
 *
 * Environment:
 *   DOCS_BASE_URL   defaults to http://localhost:3112
 *
 * Nothing here exists inside the app: it only mints a session cookie that the
 * app accepts if, and only if, it is running with the same local AUTH_SECRET.
 * It refuses to run anywhere but a local development machine (see guard.ts).
 */

import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { chromium } from '@playwright/test'
import { assertLocalDatabaseUrl, assertLocalEnvironment } from './guard'
import { STORAGE_STATE_PATH } from './session'

const DEFAULT_BASE_URL = 'http://localhost:3112'

/** A path such as /integrations or /tickets/3; anything else is ignored. */
export function resolveStartPath(arg: string | undefined): string {
  if (!arg || !/^\/(?!\/)[\w\-./?=&%]*$/.test(arg)) return '/dashboard'
  return arg
}

export function resolveBaseUrl(raw: string | undefined): URL {
  const url = new URL((raw ?? DEFAULT_BASE_URL).replace(/\/$/, ''))
  if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error(`Refusing to open ${url.origin}: the demo login only works against a local app.`)
  }
  return url
}

async function main() {
  assertLocalEnvironment()
  assertLocalDatabaseUrl(process.env.DATABASE_URL)
  const base = resolveBaseUrl(process.env.DOCS_BASE_URL)
  const target = new URL(resolveStartPath(process.argv[2]), base)

  // Reuses the session script, so the cookie is minted in exactly one place.
  execFileSync('pnpm', ['docs:session'], { stdio: 'inherit', env: process.env })

  const browser = await chromium
    .launch({ headless: false, channel: 'chrome' })
    .catch(() => chromium.launch({ headless: false }))
  const context = await browser.newContext({ storageState: STORAGE_STATE_PATH, viewport: null })
  const page = await context.newPage()
  await page.goto(target.toString())
  console.log(`[docs-demo] signed in as the demo owner at ${target.toString()}`)
  console.log(`[docs-demo] session file: ${path.relative(process.cwd(), STORAGE_STATE_PATH)} (close the window to exit)`)
  await new Promise<void>((resolve) => browser.on('disconnected', () => resolve()))
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
