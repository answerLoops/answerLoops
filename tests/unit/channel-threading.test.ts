// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import type { MessagePayload, Platform } from '@/lib/ingest/pipeline'
import { CHANNEL_THREADING, githubThreadId, telegramThreadId } from '@/lib/ingest/thread-keys'
import { telegramSourceMessageId } from '@/lib/telegram/message-id'

// One scenario, run against every channel: the first message opens a ticket,
// a later message in the same conversation joins it, a message in another
// conversation opens its own, a redelivery is stored once, and another
// organization never joins this one's conversation. The real pipeline runs
// against an in-memory ticket store; the SQL behind getTicketByThreadId is
// covered separately in get-ticket-by-thread-id.test.ts.
//
// CHANNEL_THREADING is typed over every Platform and a test below ties it to
// the Platform union in the pipeline source, so a channel added without
// stating how it threads fails here instead of silently fragmenting tickets.

interface StoredTicket {
  id: number
  orgId: number
  org_ticket_number: number
  source_message_id: string
  source_thread_id: string | null
  status: string
}
interface StoredReply {
  ticketId: number
  author: string
  role: 'customer' | 'context'
  messageId: string | null
  content: string
}

const store = vi.hoisted(() => ({
  tickets: [] as StoredTicket[],
  replies: [] as StoredReply[],
}))

vi.mock('@/lib/db/queries/tickets', () => ({
  getTicketBySourceMessageId: vi.fn(async (messageId: string, orgId: number) =>
    store.tickets.find((t) => t.source_message_id === messageId && t.orgId === orgId) ?? null),
  getTicketByThreadId: vi.fn(async (threadId: string, orgId: number) => {
    const viaReply = new Set(store.replies.filter((r) => r.messageId === threadId).map((r) => r.ticketId))
    return store.tickets.find((t) =>
      t.orgId === orgId &&
      (t.source_thread_id === threadId || t.source_message_id === threadId || viaReply.has(t.id))) ?? null
  }),
  createTicket: vi.fn(async (input: { source_message_id: string; source_thread_id?: string }, orgId: number) => {
    const ticket: StoredTicket = {
      id: store.tickets.length + 1,
      orgId,
      org_ticket_number: store.tickets.filter((t) => t.orgId === orgId).length + 1,
      source_message_id: input.source_message_id,
      source_thread_id: input.source_thread_id ?? null,
      status: 'open',
    }
    store.tickets.push(ticket)
    return { ...ticket, content: '', source_platform: 'x', category: null, ai_summary: null }
  }),
  recordCustomerReply: vi.fn(async (ticketId: number, content: string, input: { authorName?: string; messageId?: string } = {}) => {
    if (input.messageId && store.replies.some((r) => r.ticketId === ticketId && r.messageId === input.messageId)) return false
    store.replies.push({ ticketId, author: input.authorName ?? 'Customer', role: 'customer', messageId: input.messageId ?? null, content })
    return true
  }),
  recordThreadContext: vi.fn(async (ticketId: number, content: string, input: { authorName: string; messageId?: string }) => {
    if (input.messageId && store.replies.some((r) => r.ticketId === ticketId && r.messageId === input.messageId)) return false
    store.replies.push({ ticketId, author: input.authorName, role: 'context', messageId: input.messageId ?? null, content })
    return true
  }),
  updateTicketTriage: vi.fn(),
}))

const { createNotification, triageMessage, runAIAgent } = vi.hoisted(() => ({
  createNotification: vi.fn(),
  triageMessage: vi.fn(),
  runAIAgent: vi.fn(),
}))
vi.mock('@/lib/db/queries/notifications', () => ({ createNotification }))
vi.mock('@/lib/ai/triage', () => ({ triageMessage }))
vi.mock('@/lib/ai/agent', () => ({ runAIAgent }))
vi.mock('@/lib/ai/models', () => ({ NoAIProviderConfiguredError: class extends Error {} }))
vi.mock('@/lib/sla/engine', () => ({
  calculateDeadlines: vi.fn(async () => ({ sla_response_deadline: null, sla_resolve_deadline: null })),
  checkSlaBreaches: vi.fn(async () => []),
}))
vi.mock('@/lib/push/notify', () => ({ sendPushToAll: vi.fn() }))
vi.mock('@/lib/email/send', () => ({ sendNewTicketEmail: vi.fn(), sendSlaBreachEmails: vi.fn() }))
vi.mock('@/lib/ai/embed', () => ({ embedTextWithModel: vi.fn(), embedText: vi.fn(), EMBEDDING_MODEL: 'test-model' }))
vi.mock('@/lib/ai/related', () => ({ findRelated: vi.fn(() => []), isDuplicate: vi.fn(() => false) }))
vi.mock('@/lib/db/queries/embeddings', () => ({
  saveEmbedding: vi.fn(),
  getCandidateVectors: vi.fn(async () => []),
  replaceLinks: vi.fn(),
  getPriorAnswers: vi.fn(async () => []),
}))
vi.mock('@/lib/db/queries/kb', () => ({ getKBContext: vi.fn(async () => []) }))
vi.mock('@/lib/retry', () => ({ withRetry: vi.fn((fn: () => unknown) => fn()) }))
vi.mock('next/server', () => ({ after: () => undefined }))

type Msg = Pick<MessagePayload, 'messageId' | 'threadId' | 'channelId'>

interface Conversation {
  platform: Platform
  /** Opens the conversation. */
  root: Msg
  /** A later message in the same conversation, as this channel's entry point builds it. */
  reply: Msg
  /** A message from a different conversation in the same place. */
  other: Msg
  /** For channels where a reply can answer a reply: a message answering `reply`. */
  replyToReply?: Msg
}

const TG = '-1001'
// Built from the same functions the entry points use where those exist, and
// from the ids each channel documents otherwise.
const CONVERSATIONS: Conversation[] = [
  {
    platform: 'slack',
    root: { messageId: '100.1', channelId: 'C1' },
    reply: { messageId: '100.2', threadId: '100.1', channelId: 'C1' },
    other: { messageId: '200.1', channelId: 'C1' },
  },
  {
    platform: 'discord',
    root: { messageId: 'd-1', channelId: 'chan' },
    reply: { messageId: 'd-2', threadId: 'd-1', channelId: 'chan' },
    other: { messageId: 'd-9', channelId: 'chan' },
  },
  {
    platform: 'google_chat',
    root: { messageId: 'spaces/S/messages/m1', threadId: 'spaces/S/threads/t1', channelId: 'spaces/S' },
    reply: { messageId: 'spaces/S/messages/m2', threadId: 'spaces/S/threads/t1', channelId: 'spaces/S' },
    other: { messageId: 'spaces/S/messages/m9', threadId: 'spaces/S/threads/t9', channelId: 'spaces/S' },
  },
  {
    platform: 'discourse',
    root: { messageId: 'discourse-post-1', threadId: '10', channelId: '3' },
    reply: { messageId: 'discourse-post-2', threadId: '10', channelId: '3' },
    other: { messageId: 'discourse-post-9', threadId: '11', channelId: '3' },
  },
  {
    platform: 'circle',
    root: { messageId: 'circle-post-5', threadId: '5', channelId: 'space' },
    reply: { messageId: 'circle-comment-9', threadId: '5', channelId: 'space' },
    other: { messageId: 'circle-post-6', threadId: '6', channelId: 'space' },
  },
  {
    platform: 'github',
    root: { messageId: githubThreadId('o', 'r', 'issue', 5), channelId: 'o/r' },
    reply: { messageId: 'github-issue-comment-o-r-77', threadId: githubThreadId('o', 'r', 'issue', 5), channelId: 'o/r' },
    other: { messageId: 'github-issue-comment-o-r-78', threadId: githubThreadId('o', 'r', 'issue', 6), channelId: 'o/r' },
  },
  {
    platform: 'telegram',
    root: { messageId: telegramSourceMessageId(TG, 1), channelId: TG },
    reply: { messageId: telegramSourceMessageId(TG, 2), threadId: telegramThreadId(TG, 1)!, channelId: TG },
    other: { messageId: telegramSourceMessageId(TG, 9), channelId: TG },
    replyToReply: { messageId: telegramSourceMessageId(TG, 3), threadId: telegramThreadId(TG, 2)!, channelId: TG },
  },
]

// Channels whose reply never reaches processCommunityMessage's thread match.
const NOT_THIS_SCENARIO: Partial<Record<Platform, string>> = {
  email: 'replies are matched by the Message-ID / References chain before the pipeline runs; covered in email-ingest-thread-sender.test.ts',
  mcp: 'each API or MCP call is a standalone question with nothing to continue',
}

const BODY = 'a message long enough to be kept as a ticket'

async function send(platform: Platform, m: Msg, orgId = 1, authorName = 'someone') {
  const { processCommunityMessage } = await import('@/lib/ingest/pipeline')
  return processCommunityMessage(
    { ...m, content: `${BODY} ${m.messageId}`, authorId: 'u1', authorName, platform },
    orgId
  )
}

beforeEach(() => {
  store.tickets.length = 0
  store.replies.length = 0
  vi.clearAllMocks()
})

describe('every channel states how it threads', () => {
  it('CHANNEL_THREADING lists exactly the Platform union', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/ingest/pipeline.ts'), 'utf-8')
    const union = /export type Platform =([^\n]+)/.exec(src)?.[1] ?? ''
    const platforms = [...union.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
    expect(platforms.length).toBeGreaterThan(0)
    expect(Object.keys(CHANNEL_THREADING).sort()).toEqual(platforms)
  })

  it('every channel is either run through the scenario below or has a stated reason it is not', () => {
    const covered = new Set<string>([...CONVERSATIONS.map((c) => c.platform), ...Object.keys(NOT_THIS_SCENARIO)])
    expect([...covered].sort()).toEqual(Object.keys(CHANNEL_THREADING).sort())
  })

  it('each entry point exists and, for pipeline channels, supplies a thread id', () => {
    for (const [platform, { source, entryPoint }] of Object.entries(CHANNEL_THREADING)) {
      const file = path.join(process.cwd(), entryPoint)
      expect(fs.existsSync(file), `${platform}: ${entryPoint} not found`).toBe(true)
      if (source === 'standalone' || source === 'message-header-chain') continue
      expect(fs.readFileSync(file, 'utf-8'), `${platform} entry point never passes a thread id`).toMatch(/thread_?[iI]d/)
    }
  })
})

describe.each(CONVERSATIONS)('$platform threading through the pipeline', (c) => {
  it('the first message opens a ticket', async () => {
    const result = await send(c.platform, c.root)
    expect(result.appended).toBeUndefined()
    expect(store.tickets).toHaveLength(1)
  })

  it('a later message in the same conversation joins that ticket with its author, and does not re-triage', async () => {
    const first = await send(c.platform, c.root)
    triageMessage.mockClear()
    runAIAgent.mockClear()
    const result = await send(c.platform, c.reply, 1, 'alice')

    expect(result).toEqual({ ticket_id: first.ticket_id, appended: true })
    expect(store.tickets).toHaveLength(1)
    expect(store.replies).toEqual([
      expect.objectContaining({ ticketId: first.ticket_id, author: 'alice', role: 'customer', messageId: c.reply.messageId }),
    ])
    expect(createNotification).toHaveBeenCalledTimes(1)
    expect(triageMessage).not.toHaveBeenCalled()
    expect(runAIAgent).not.toHaveBeenCalled()
  })

  it('a message in a different conversation opens its own ticket', async () => {
    const first = await send(c.platform, c.root)
    const other = await send(c.platform, c.other)
    expect(other.appended).toBeUndefined()
    expect(other.ticket_id).not.toBe(first.ticket_id)
    expect(store.tickets).toHaveLength(2)
    expect(store.replies).toHaveLength(0)
  })

  it('the same reply delivered twice is stored and notified once', async () => {
    await send(c.platform, c.root)
    await send(c.platform, c.reply)
    const again = await send(c.platform, c.reply)
    expect(again.duplicate).toBe(true)
    expect(store.replies).toHaveLength(1)
    expect(createNotification).toHaveBeenCalledTimes(1)
  })

  it('another organization with the same ids never joins this conversation', async () => {
    await send(c.platform, c.root, 1)
    const foreign = await send(c.platform, c.reply, 2)
    expect(foreign.appended).toBeUndefined()
    expect(store.replies).toHaveLength(0)
    expect(store.tickets.map((t) => t.orgId).sort()).toEqual([1, 2])
  })

  if (c.replyToReply) {
    it('a reply to a reply still reaches the ticket', async () => {
      const first = await send(c.platform, c.root)
      await send(c.platform, c.reply)
      const chained = await send(c.platform, c.replyToReply!, 1, 'bob')
      expect(chained).toEqual({ ticket_id: first.ticket_id, appended: true })
      expect(store.replies.map((r) => r.messageId)).toEqual([c.reply.messageId, c.replyToReply!.messageId])
    })
  }
})

describe('context-only messages (a maintainer in the conversation)', () => {
  const ctx = (messageId = 'github-issue-comment-o-r-80', threadId = githubThreadId('o', 'r', 'issue', 5)) => ({
    messageId, threadId, content: 'Looking into this now', authorName: 'maint',
  })

  it('joins the thread as context: no ticket, no notification, no AI work', async () => {
    const { recordThreadContextMessage } = await import('@/lib/ingest/pipeline')
    const root = CONVERSATIONS.find((c) => c.platform === 'github')!.root
    const first = await send('github', root)
    createNotification.mockClear()

    expect(await recordThreadContextMessage(ctx(), 1)).toBe(true)
    expect(store.tickets).toHaveLength(1)
    expect(store.replies).toEqual([
      expect.objectContaining({ ticketId: first.ticket_id, role: 'context', author: 'maint', messageId: 'github-issue-comment-o-r-80' }),
    ])
    expect(createNotification).not.toHaveBeenCalled()
    expect(runAIAgent).not.toHaveBeenCalled()
  })

  it('is dropped when there is no ticket for the conversation', async () => {
    const { recordThreadContextMessage } = await import('@/lib/ingest/pipeline')
    expect(await recordThreadContextMessage(ctx(), 1)).toBe(false)
    expect(store.tickets).toHaveLength(0)
    expect(store.replies).toHaveLength(0)
  })

  it('is dropped when it has no thread at all', async () => {
    const { recordThreadContextMessage } = await import('@/lib/ingest/pipeline')
    expect(await recordThreadContextMessage({ ...ctx(), threadId: undefined }, 1)).toBe(false)
  })

  it('never lands in another organization’s ticket', async () => {
    const { recordThreadContextMessage } = await import('@/lib/ingest/pipeline')
    await send('github', CONVERSATIONS.find((c) => c.platform === 'github')!.root, 1)
    expect(await recordThreadContextMessage(ctx(), 2)).toBe(false)
    expect(store.replies).toHaveLength(0)
  })

  it('is stored once when delivered twice', async () => {
    const { recordThreadContextMessage } = await import('@/lib/ingest/pipeline')
    await send('github', CONVERSATIONS.find((c) => c.platform === 'github')!.root)
    await recordThreadContextMessage(ctx(), 1)
    expect(await recordThreadContextMessage(ctx(), 1)).toBe(false)
    expect(store.replies).toHaveLength(1)
  })

  it('sits in the thread in order alongside customer messages', async () => {
    const { recordThreadContextMessage } = await import('@/lib/ingest/pipeline')
    const gh = CONVERSATIONS.find((c) => c.platform === 'github')!
    await send('github', gh.root)
    await send('github', gh.reply, 1, 'alice')
    await recordThreadContextMessage(ctx(), 1)
    expect(store.replies.map((r) => [r.role, r.author])).toEqual([['customer', 'alice'], ['context', 'maint']])
  })
})
