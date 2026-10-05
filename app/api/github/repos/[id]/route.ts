import type { NextRequest } from 'next/server'
import { requireOrgAccess } from '@/lib/auth/org'
import { removeRepo } from '@/lib/db/queries/github'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-id'

const MOD = 'api/github/repos/[id]'

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const access = await requireOrgAccess()
  if (!access.ok) return Response.json({ error: access.error }, { status: 401 })
  const orgId = access.orgId

  const { id } = await ctx.params

  try {
    await removeRepo(Number(id), orgId)
    return Response.json({ ok: true })
  } catch (err) {
    logger.error('github repo removal failed', { module: MOD, requestId: getRequestId(req), orgId, repoId: id, error: err })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
