import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Roadmap item 11 (continued from no-ai-provider-configured.test.ts, which
// covers lib/ai/models.ts's core logic): every production call site that
// resolves a chat/embedding model must catch NoAIProviderConfiguredError
// specifically and degrade gracefully — skip drafting, surface a clear
// state — rather than let it bubble up as an unhandled 500 or, worse (for
// ingestion), block ticket creation outright. Source-shape assertions,
// matching this repo's convention (see tests/unit/agent-api.test.ts).

const ROOT = process.cwd()

function readSrc(relPath: string): string {
  const absPath = path.join(ROOT, relPath)
  expect(fs.existsSync(absPath), `File not found: ${relPath}`).toBe(true)
  return fs.readFileSync(absPath, 'utf-8')
}

describe('lib/ingest/pipeline.ts — ticket creation never depends on AI', () => {
  const src = () => readSrc('lib/ingest/pipeline.ts')

  it('imports NoAIProviderConfiguredError', () => {
    expect(src()).toContain("NoAIProviderConfiguredError")
    expect(src()).toContain("from '@/lib/ai/models'")
  })

  it('creates the ticket without depending on triage at all — triage is an LLM call, too slow to sit in front of an inbound webhook ack, so it runs in the background after the ticket already exists with a placeholder', () => {
    const s = src()
    const fnStart = s.indexOf('export async function processCommunityMessage')
    const fnEnd = s.indexOf('export async function runBackgroundEnrichment')
    const body = s.slice(fnStart, fnEnd)
    expect(fnStart).toBeGreaterThan(-1)
    expect(fnEnd).toBeGreaterThan(fnStart)
    expect(body).not.toContain('triageMessage(')
    expect(body).toContain('const ticket = await createTicket(')
  })

  it('runBackgroundEnrichment catches NoAIProviderConfiguredError around the triage call and leaves the ticket on its placeholder rather than rethrowing', () => {
    const s = src()
    const fnStart = s.indexOf('export async function runBackgroundEnrichment')
    const body = s.slice(fnStart)
    const triageCallIdx = body.indexOf('triageMessage(content, orgId, aiPurpose)')
    const catchIdx = body.indexOf('if (!(err instanceof NoAIProviderConfiguredError)) throw err')

    expect(triageCallIdx).toBeGreaterThan(-1)
    expect(catchIdx).toBeGreaterThan(triageCallIdx)
  })

  it('rethrows any other error from the triage call instead of masking it', () => {
    const s = src()
    const catchIdx = s.indexOf('if (!(err instanceof NoAIProviderConfiguredError)) throw err')
    expect(catchIdx).toBeGreaterThan(-1)
  })
})

describe('lib/ai/agent.ts — main answering path skips drafting cleanly', () => {
  const src = () => readSrc('lib/ai/agent.ts')

  it('imports NoAIProviderConfiguredError', () => {
    expect(src()).toContain('NoAIProviderConfiguredError')
    expect(src()).toContain("from '@/lib/ai/models'")
  })

  it('the outer catch checks for NoAIProviderConfiguredError and routes the ticket to needs_human instead of rethrowing/crashing', () => {
    const s = src()
    const catchIdx = s.indexOf('if (err instanceof NoAIProviderConfiguredError)')
    expect(catchIdx).toBeGreaterThan(-1)
    const block = s.slice(catchIdx, catchIdx + 700)
    expect(block).toContain("updateTicketAIDraftStatus(ticketId, 'needs_human')")
    expect(block).toContain('createNotification(')
    expect(block).toContain('return')
  })
})

describe('lib/agent/core.ts — generate_answer and search_kb (MCP/Agent API)', () => {
  const src = () => readSrc('lib/agent/core.ts')

  it('imports NoAIProviderConfiguredError', () => {
    expect(src()).toContain('NoAIProviderConfiguredError')
  })

  it('generateAnswerCore returns a structured err() instead of throwing on no-provider', () => {
    const s = src()
    const fnIdx = s.indexOf('export async function generateAnswerCore')
    const nextFnIdx = s.indexOf('export async function', fnIdx + 1)
    const fnBody = s.slice(fnIdx, nextFnIdx > -1 ? nextFnIdx : undefined)
    expect(fnBody).toContain('e instanceof NoAIProviderConfiguredError')
    expect(fnBody).toContain("return err('No AI provider configured")
  })

  it('searchKbCore returns a structured err() instead of throwing on no-provider', () => {
    const s = src()
    const fnIdx = s.indexOf('export async function searchKbCore')
    const nextFnIdx = s.indexOf('export async function', fnIdx + 1)
    const fnBody = s.slice(fnIdx, nextFnIdx > -1 ? nextFnIdx : undefined)
    expect(fnBody).toContain('e instanceof NoAIProviderConfiguredError')
    expect(fnBody).toContain("return err('No AI provider configured")
  })
})

describe('app/api/widget/chat/route.ts — customer-facing 503, not a crash', () => {
  const src = () => readSrc('app/api/widget/chat/route.ts')

  it('resolves the model before streaming, in its own try/catch', () => {
    const s = src()
    const modelResolveIdx = s.indexOf('model = await chatModel(DEFAULT_FAST_MODEL, org.id)')
    const catchIdx = s.indexOf('e instanceof NoAIProviderConfiguredError')
    const streamIdx = s.indexOf('widgetAgent.stream(')

    expect(modelResolveIdx).toBeGreaterThan(-1)
    expect(catchIdx).toBeGreaterThan(modelResolveIdx)
    expect(catchIdx).toBeLessThan(streamIdx)
  })

  it('returns 503 with a generic customer-facing message, not an internal "connect a provider" instruction', () => {
    const s = src()
    const catchIdx = s.indexOf('e instanceof NoAIProviderConfiguredError')
    // Widened from 600: isSelfPreview's comment block and message ternary
    // (see app/widget/[widgetToken]/page.tsx) push the literal 503 further
    // out than the old fixed-length window fit.
    const block = s.slice(catchIdx, catchIdx + 900)
    expect(block).toContain('503')
    expect(block).toContain('isSelfPreview')
    // Neither branch of the ternary — including the isSelfPreview one,
    // scoped to the org owner testing their own instance — phrases the
    // config hint as "connect a/an AI provider"; a real customer-site
    // visitor only ever sees the generic fallback message either way.
    expect(block).not.toMatch(/connect an? AI provider/i)
  })
})

describe('app/api/slash/ask and slash/summarize — clear 503 for admins', () => {
  it('slash/ask distinguishes NoAIProviderConfiguredError with a 503 and an admin-facing message', () => {
    const s = readSrc('app/api/slash/ask/route.ts')
    const catchIdx = s.indexOf('err instanceof NoAIProviderConfiguredError')
    expect(catchIdx).toBeGreaterThan(-1)
    const block = s.slice(catchIdx, catchIdx + 250)
    expect(block).toContain('503')
    expect(block).toMatch(/connect one in Settings/i)
  })

  it('slash/summarize distinguishes NoAIProviderConfiguredError with a 503 and an admin-facing message', () => {
    const s = readSrc('app/api/slash/summarize/route.ts')
    const catchIdx = s.indexOf('err instanceof NoAIProviderConfiguredError')
    expect(catchIdx).toBeGreaterThan(-1)
    const block = s.slice(catchIdx, catchIdx + 250)
    expect(block).toContain('503')
    expect(block).toMatch(/connect one in Settings/i)
  })
})

describe('app/api/faq/generate/route.ts — clear 503 instead of an unhandled 500', () => {
  it('wraps generateFAQ and distinguishes NoAIProviderConfiguredError', () => {
    const s = readSrc('app/api/faq/generate/route.ts')
    const tryIdx = s.indexOf('content = await generateFAQ(tickets, orgId)')
    const catchIdx = s.indexOf('err instanceof NoAIProviderConfiguredError')
    expect(tryIdx).toBeGreaterThan(-1)
    expect(catchIdx).toBeGreaterThan(tryIdx)
    const block = s.slice(catchIdx, catchIdx + 200)
    expect(block).toContain('503')
  })
})

describe('app/api/simulation/run/route.ts — the one production surface that may use the platform key', () => {
  const src = () => readSrc('app/api/simulation/run/route.ts')

  it('passes purpose \'sandbox\' to both chatModel and embedText', () => {
    const s = src()
    expect(s).toContain("chatModel(model, orgId, 'sandbox')")
    expect(s).toContain("embedText(ticket.content, orgId, 'sandbox')")
  })
})

describe('app/(dashboard)/simulation — model picker only offers runnable models', () => {
  it('page.tsx fetches the org AI config and passes provider/model props to the client', () => {
    const s = readSrc('app/(dashboard)/simulation/page.tsx')
    expect(s).toContain("import { getOrgAIConfig } from '@/lib/db/queries/ai-config'")
    expect(s).toContain('configuredProvider=')
    expect(s).toContain('configuredModel=')
  })

  it('simulation-client.tsx derives its model list from the configured provider, not a fixed cross-provider list', () => {
    const s = readSrc('app/(dashboard)/simulation/simulation-client.tsx')
    expect(s).toContain('MODELS_BY_PROVIDER')
    expect(s).toContain('const runnableModels = configuredProvider')
    expect(s).not.toContain("const MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo', 'claude-sonnet-4-6'")
  })

  it('shows a note when running on the platform default key (no provider configured)', () => {
    const s = readSrc('app/(dashboard)/simulation/simulation-client.tsx')
    expect(s).toMatch(/!configuredProvider/)
    expect(s).toMatch(/No AI provider connected/i)
  })
})
