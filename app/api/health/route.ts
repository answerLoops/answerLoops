import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Railway's deploy healthcheck and the Docker HEALTHCHECK both probe this
// path (see railway.toml, docker-compose.prod.yml). It only confirms the
// process is up — it used to also ping the DB, but that kept the Neon
// compute alive around the clock. Real traffic wakes the DB and surfaces
// outages on its own; a background health probe doesn't need to.
export async function GET() {
  return NextResponse.json({ ok: true })
}
