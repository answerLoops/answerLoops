import { NextRequest, NextResponse } from 'next/server'
import { generateAnswerCore } from '@/lib/agent/core'
import { authenticateAgentRequest, readAgentJsonBody, agentError, withHeaders } from '@/lib/agent/http'

/**
 * POST /api/agent/answers
 * REST counterpart to the MCP generate_answer tool. Gated by the org's
 * monthly deflection limit before any LLM call runs.
 */
export async function POST(req: NextRequest) {
  const auth = await authenticateAgentRequest(req, 'answers:write')
  if ('response' in auth) return auth.response

  const bodyResult = await readAgentJsonBody(req)
  if (!bodyResult.ok) return bodyResult.response

  const result = await generateAnswerCore(auth.orgId, bodyResult.body, auth.keyId)
  // The quota-reached cases (billed deflections, and total call attempts) are
  // quota errors, not validation errors — 429 (Too Many Requests) fits the
  // "come back later or upgrade" semantics better than a flat 400, and lets a
  // client's retry logic treat them the way it already treats rate limiting.
  if (!result.ok) {
    const deflectionLimit = result.error.startsWith('Monthly deflection limit reached')
    const callLimit = result.error.startsWith('Monthly generate_answer call limit reached')
    if (deflectionLimit) return withHeaders(agentError(429, result.error, 'deflection_limit_reached'), auth.rateLimitHeaders)
    if (callLimit) return withHeaders(agentError(429, result.error, 'call_limit_reached'), auth.rateLimitHeaders)
    return withHeaders(agentError(400, result.error), auth.rateLimitHeaders)
  }
  return withHeaders(NextResponse.json(result.data), auth.rateLimitHeaders)
}
