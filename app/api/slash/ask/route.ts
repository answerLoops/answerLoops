import { z } from 'zod'
import { Agent } from '@mastra/core/agent'
import type { MastraModelConfig } from '@mastra/core/llm'
import { getIntegrationByBotSecret } from '@/lib/db/queries/integrations'
import { searchArticles } from '@/lib/db/queries/kb'
import { embedText } from '@/lib/ai/embed'
import { chatModel, DEFAULT_CHAT_MODEL, NoAIProviderConfiguredError } from '@/lib/ai/models'
import { aiUnavailableMessage } from '@/lib/ai/errors'
import { DEFAULT_ORG_ID } from '@/lib/db/schema'
import { reserveGeneration, commitDeflection } from '@/lib/billing/usage'
import { orgRateLimitPerMinute } from '@/lib/billing/entitlements-server'
import { rateLimitShared } from '@/lib/ratelimit'
import { getBearerToken, matchesPlatformBotSecret } from '@/lib/http/bearer-auth'
import { logger } from '@/lib/logger'
import { countArticleUsage } from '@/lib/kb/usage'

const MOD = 'api/slash/ask'
const RATE_LIMIT_WINDOW_MS = 60_000

const Schema = z.object({
  question: z.string().min(5).max(1000),
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
  const rateLimit = await rateLimitShared(`slash-ask:${orgId}`, orgRateLimitMax, RATE_LIMIT_WINDOW_MS)
  if (!rateLimit.ok) {
    return Response.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  let body: unknown
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = Schema.safeParse(body)
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 })

  const { question } = parsed.data

  // Reserved before any model work starts — same atomic quota path as
  // generate_answer (MCP/Agent API), which this endpoint had never gone
  // through, letting it run unmetered against the org's deflection allowance.
  const reservation = await reserveGeneration(orgId)
  if (!reservation.granted) {
    return Response.json({ error: 'Monthly usage limit reached — upgrade the plan or wait for the next billing cycle.' }, { status: 402 })
  }

  // Embed question → KB semantic search for context
  let kbContext = ''
  let kbArticleIds: { articleId: number }[] = []
  try {
    const vector = await embedText(question, orgId)
    const kbResults = await searchArticles(vector, 3, orgId)
    kbArticleIds = kbResults.map((a) => ({ articleId: a.id }))
    if (kbResults.length) {
      kbContext = `\n\nKnowledge base:\n${kbResults.map((a) => `Q: "${a.question}"\nA: ${a.answer}`).join('\n\n')}`
    }
  } catch {
    // KB context is best-effort — answer without it if embedding fails
  }

  try {
    // Agent instantiated per-call — see lib/ai/agent.ts for why (model is
    // resolved per-org, so no single instance is valid across orgs).
    const askAgent = new Agent({
      id: 'slash-ask-agent',
      name: 'slash-ask-agent',
      instructions: `You are a helpful support assistant for a Discord community.
Answer concisely in markdown. Respond in the same language as the question.
If you cite a KB article, reference the question it answered. If you don't know, say so honestly.${kbContext}`,
      model: (await chatModel(DEFAULT_CHAT_MODEL, orgId)) as MastraModelConfig,
    })
    const { text } = await askAgent.generate(question)

    // Billed unconditionally on a successful answer — this endpoint has no
    // confidence-assessment step like the MCP/ticket pipelines do, so a
    // delivered answer is the bar for what counts as a deflection here.
    await commitDeflection(orgId, reservation.generationId).catch((e) => {
      logger.error('slash /ask commitDeflection failed', { module: MOD, orgId, error: e })
    })

    await countArticleUsage(orgId, kbArticleIds)

    logger.info('slash /ask answered', { module: MOD, orgId })
    return Response.json({ answer: text })
  } catch (err) {
    if (err instanceof NoAIProviderConfiguredError) {
      return Response.json({ error: aiUnavailableMessage(err, 'No AI provider configured for this org — an admin needs to connect one in Settings → AI Model.') }, { status: 503 })
    }
    logger.error('slash /ask AI failed', { module: MOD, error: err })
    return Response.json({ error: 'AI failed to generate an answer' }, { status: 500 })
  }
}
