import { NextRequest, NextResponse } from 'next/server'
import { getTicketsCore, createTicketCore } from '@/lib/agent/core'
import { authenticateAgentRequest, readAgentJsonBody, agentError, withHeaders } from '@/lib/agent/http'

/**
 * GET /api/v1/agent/tickets?status=&priority=&category=&limit=&cursor=
 * REST counterpart to the MCP get_tickets tool. `cursor` from a prior
 * response's `next_cursor` fetches the next page; omitted, it starts from
 * the most recent ticket.
 */
export async function GET(req: NextRequest) {
  const auth = await authenticateAgentRequest(req, 'tickets:read')
  if ('response' in auth) return auth.response

  const { searchParams } = req.nextUrl
  const result = await getTicketsCore(auth.orgId, {
    status: searchParams.get('status') ?? undefined,
    priority: searchParams.get('priority') ?? undefined,
    category: searchParams.get('category') ?? undefined,
    limit: searchParams.get('limit') ?? undefined,
    cursor: searchParams.get('cursor') ?? undefined,
  })

  if (!result.ok) return withHeaders(agentError(400, result.error), auth.rateLimitHeaders)
  return withHeaders(NextResponse.json(result.data), auth.rateLimitHeaders)
}

/**
 * POST /api/v1/agent/tickets
 * REST counterpart to the MCP create_ticket tool. Runs through the exact
 * same processCommunityMessage pipeline as every other channel.
 */
export async function POST(req: NextRequest) {
  const auth = await authenticateAgentRequest(req, 'tickets:write')
  if ('response' in auth) return auth.response

  const bodyResult = await readAgentJsonBody(req)
  if (!bodyResult.ok) return bodyResult.response

  // The `Idempotency-Key` header is the standard convention (most HTTP
  // clients/SDKs attach it automatically); the idempotencyKey body field
  // predates it and is kept for direct callers who already set it there.
  // The header wins when both are present — it's the more deliberate signal
  // when a client sends both.
  const idempotencyKeyHeader = req.headers.get('idempotency-key')
  const body = idempotencyKeyHeader ? { ...bodyResult.body, idempotencyKey: idempotencyKeyHeader } : bodyResult.body

  // idPrefix must be distinct from MCP's 'mcp' prefix so an idempotencyKey a
  // client reuses across both surfaces can never collide on the same
  // messageId (see CreateTicketOpts JSDoc in lib/agent/core.ts).
  const result = await createTicketCore(auth.orgId, body, { idPrefix: 'agent', defaultAuthorName: 'Agent API' })
  if (!result.ok) return withHeaders(agentError(400, result.error), auth.rateLimitHeaders)
  return withHeaders(NextResponse.json(result.data, { status: 201 }), auth.rateLimitHeaders)
}
