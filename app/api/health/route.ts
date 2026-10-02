import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/drizzle'

export const dynamic = 'force-dynamic'

// Railway's deploy healthcheck and the Docker HEALTHCHECK both probe this
// path (see railway.toml, docker-compose.prod.yml), and .github/workflows/
// keep-alive.yml probes it on a schedule. The DB query is intentional here:
// prod runs on the database which can auto-pauses a project
// so to ensure it stays healthy, an endpoint needs to touch the
// database, not just report the process is up.
export async function GET() {
  await getDb().execute(sql`select 1`)
  return NextResponse.json({ ok: true })
}
