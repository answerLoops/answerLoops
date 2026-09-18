import type { NextRequest } from 'next/server'
import { auth } from '@/auth'
import { removeRepo } from '@/lib/db/queries/github'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/github/repos/[id]'

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId = session.orgId ?? DEFAULT_ORG_ID

  const { id } = await ctx.params

  try {
    await removeRepo(Number(id), orgId)
    return Response.json({ ok: true })
  } catch (err) {
    logger.error('github repo removal failed', { module: MOD, requestId: getRequestId(req), orgId, repoId: id, error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
