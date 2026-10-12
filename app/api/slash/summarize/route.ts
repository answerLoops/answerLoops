import { z } from 'zod'
import { Agent } from '@mastra/core/agent'
import type { MastraModelConfig } from '@mastra/core/llm'
import { getIntegrationByBotSecret } from '@/lib/db/queries/integrations'
import { chatModel, DEFAULT_CHAT_MODEL, NoAIProviderConfiguredError } from '@/lib/ai/models'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { reserveGeneration, commitDeflection } from '@/lib/billing/usage'
import { orgRateLimitPerMinute } from '@/lib/billing/entitlements-server'
import { rateLimitShared } from '@/lib/ratelimit'
import { getBearerToken, matchesPlatformBotSecret } from '@/lib/http/bearer-auth'
import { logger } from '@/lib/logger'

const MOD = 'api/slash/summarize'
const RATE_LIMIT_WINDOW_MS = 60_000

const Schema = z.object({
  messages: z.array(z.string().max(2000)).min(1).max(50),
  channel_id: z.string(),
})

export async function POST(request: Request) {
  const bearerSecret = getBearerToken(request)
  if (!bearerSecret) return new Response('Unauthorized', { status: 401 })

  let orgId: number
  const integration = await getIntegrationByBotSecret(bearerSecret, 'discord')
  if (integration) {
    orgId = integration.org_id
  } else if (matchesPlatformBotSecret(bearerSecret)) {
    orgId = DEFAULT_ORG_ID
  } else {
    return new Response('Unauthorized', { status: 401 })
  }

  const orgRateLimitMax = await orgRateLimitPerMinute(orgId)
  const rateLimit = await rateLimitShared(`slash-summarize:${orgId}`, orgRateLimitMax, RATE_LIMIT_WINDOW_MS)
  if (!rateLimit.ok) {
    return Response.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  let body: unknown
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = Schema.safeParse(body)
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 })

  const { messages } = parsed.data
  const transcript = messages.join('\n')

  // Reserved before any model work starts — see slash/ask/route.ts for why
  // this endpoint needs the same atomic quota path as generate_answer.
  const reservation = await reserveGeneration(orgId)
  if (!reservation.granted) {
    return Response.json({ error: 'Monthly usage limit reached — upgrade the plan or wait for the next billing cycle.' }, { status: 402 })
  }

  try {
    // Agent instantiated per-call — see lib/ai/agent.ts for why (model is
    // resolved per-org, so no single instance is valid across orgs).
    const summarizeAgent = new Agent({
      id: 'slash-summarize-agent',
      name: 'slash-summarize-agent',
      instructions: `You are summarizing a Discord channel conversation for support staff.
Output a tight bullet-point summary in markdown:
- What was asked or discussed
- Key decisions or answers given
- Any open questions or unresolved issues
Keep it under 400 words. Respond in the same language as the conversation.`,
      model: (await chatModel(DEFAULT_CHAT_MODEL, orgId)) as MastraModelConfig,
    })
    const { text } = await summarizeAgent.generate(`Summarize this conversation:\n\n${transcript}`)

    // Billed unconditionally on a successful summary — no confidence
    // assessment exists for this endpoint, so a delivered result is the bar.
    await commitDeflection(orgId, reservation.generationId).catch((e) => {
      logger.error('slash /summarize commitDeflection failed', { module: MOD, orgId, error: e })
    })

    logger.info('slash /summarize done', { module: MOD, orgId, messageCount: messages.length })
    return Response.json({ summary: text })
  } catch (err) {
    if (err instanceof NoAIProviderConfiguredError) {
      return Response.json({ error: 'No AI provider configured for this org — an admin needs to connect one in Settings → AI Model.' }, { status: 503 })
    }
    logger.error('slash /summarize AI failed', { module: MOD, error: err })
    return Response.json({ error: 'AI failed to summarize' }, { status: 500 })
  }
}
