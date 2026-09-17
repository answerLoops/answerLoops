import { NextRequest, NextResponse } from 'next/server'
import { searchKbCore } from '@/lib/agent/core'
import { authenticateAgentRequest, agentError, withHeaders } from '@/lib/agent/http'

/**
 * GET /api/agent/kb/search?query=...&limit=...
 * REST counterpart to the MCP search_kb tool — same underlying
 * lib/agent/core.ts logic, same validation, same response shape.
 */
export async function GET(req: NextRequest) {
  const auth = await authenticateAgentRequest(req, 'kb:read')
  if ('response' in auth) return auth.response

  const { searchParams } = req.nextUrl
  const result = await searchKbCore(auth.orgId, {
    query: searchParams.get('query') ?? undefined,
    limit: searchParams.get('limit') ?? undefined,
  })

  if (!result.ok) return withHeaders(agentError(400, result.error), auth.rateLimitHeaders)
  return withHeaders(NextResponse.json({ results: result.data }), auth.rateLimitHeaders)
}
