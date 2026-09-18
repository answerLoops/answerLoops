import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/drizzle'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

// Railway's deploy healthcheck and the Docker HEALTHCHECK both probe this
// path (see railway.toml, docker-compose.prod.yml) with a 30s timeout — a
// static 200 meant a dead DB would never surface as a failed deploy or a
// restarted container. 5s keeps the DB check well inside that budget.
const DB_CHECK_TIMEOUT_MS = 5000

export async function GET() {
  try {
    await Promise.race([
      getDb().execute(sql`select 1`),
      new Promise((_, reject) => setTimeout(() => reject(new Error('DB health check timed out')), DB_CHECK_TIMEOUT_MS)),
    ])
    return NextResponse.json({ ok: true })
  } catch (error) {
    logger.error('Health check failed: database unreachable', { module: 'health', error })
    return NextResponse.json({ ok: false, error: 'database unreachable' }, { status: 503 })
  }
}
