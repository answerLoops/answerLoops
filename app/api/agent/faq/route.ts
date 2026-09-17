import { NextRequest, NextResponse } from 'next/server'
import { getFaqCore } from '@/lib/agent/core'
import { authenticateAgentRequest, withHeaders } from '@/lib/agent/http'

/**
 * GET /api/agent/faq
 * REST counterpart to the MCP get_faq tool.
 */
export async function GET(req: NextRequest) {
  const auth = await authenticateAgentRequest(req, 'faq:read')
  if ('response' in auth) return auth.response

  const result = await getFaqCore(auth.orgId)
  // getFaqCore never returns ok: false — an org with no FAQ yet gets a
  // { message } payload, not an error — but the shape is checked anyway so
  // this route doesn't silently mis-handle it if that ever changes.
  if (!result.ok) return withHeaders(NextResponse.json({ error: { message: result.error } }, { status: 400 }), auth.rateLimitHeaders)
  return withHeaders(NextResponse.json(result.data), auth.rateLimitHeaders)
}
