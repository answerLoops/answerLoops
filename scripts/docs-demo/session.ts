/**
 * Mints an Auth.js session cookie for the demo workspace owner and writes a
 * Playwright storageState file, exactly the way e2e/global-setup.ts does, so a
 * screenshot script can open the real dashboard without a sign-in flow.
 *
 * Usage:
 *   DATABASE_URL=<local-postgres-url> AUTH_SECRET=<same-value-the-app-uses> pnpm docs:session
 *
 * AUTH_SECRET must be identical to the value the running app was started with.
 * It is read from the environment and never written to the output file; the
 * file holds only the signed session token.
 */

import fs from 'node:fs'
import path from 'node:path'
import { assertLocalDatabaseUrl } from './guard'
import { DEMO_ORG_SLUG, DEMO_OWNER_EMAIL } from './constants'

const SESSION_COOKIE = 'authjs.session-token'
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60
export const STORAGE_STATE_PATH = path.join(__dirname, '.tmp', 'storage-state.json')

async function main() {
  assertLocalDatabaseUrl(process.env.DATABASE_URL)
  const authSecret = process.env.AUTH_SECRET
  if (!authSecret) {
    throw new Error('AUTH_SECRET is not set. Use the same value the app is started with.')
  }

  const { getDb } = await import('@/lib/db/drizzle')
  const { and, eq } = await import('drizzle-orm')
  const { orgs, users, memberships } = await import('@/lib/db/schema')
  const db = getDb()

  const [row] = await db
    .select({ userId: users.id, name: users.name, orgId: orgs.id })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .innerJoin(orgs, eq(orgs.id, memberships.orgId))
    .where(and(eq(users.email, DEMO_OWNER_EMAIL), eq(orgs.slug, DEMO_ORG_SLUG)))
    .limit(1)
  if (!row) throw new Error('Demo owner not found. Run `pnpm docs:seed` first.')

  const now = Math.floor(Date.now() / 1000)
  const exp = now + MAX_AGE_SECONDS
  const { encode } = await import('next-auth/jwt')
  const token = await encode({
    token: {
      sub: String(row.userId),
      name: row.name,
      email: DEMO_OWNER_EMAIL,
      userId: String(row.userId),
      orgId: row.orgId,
      iat: now,
      exp,
    },
    secret: authSecret,
    salt: SESSION_COOKIE,
    maxAge: MAX_AGE_SECONDS,
  })

  fs.mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true })
  fs.writeFileSync(
    STORAGE_STATE_PATH,
    JSON.stringify({
      cookies: [
        {
          name: SESSION_COOKIE,
          value: token,
          domain: 'localhost',
          path: '/',
          expires: exp,
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    })
  )
  console.log(`[docs-demo] wrote ${path.relative(process.cwd(), STORAGE_STATE_PATH)} for ${DEMO_OWNER_EMAIL} (org ${row.orgId})`)
  process.exit(0)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
