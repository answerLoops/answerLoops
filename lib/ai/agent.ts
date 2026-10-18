// Platform-wide Mastra migration reference point — see feat/mastra-platform-integration.
import { Agent } from '@mastra/core/agent'
import { createTool } from '@mastra/core/tools'
import type { MastraModelConfig } from '@mastra/core/llm'
import { chatModel, DEFAULT_CHAT_MODEL, NoAIProviderConfiguredError } from '@/lib/ai/models'
import { z } from 'zod'
import { searchCode, readFile, listFiles } from '@/lib/github/tools'
import { getConfiguredRepos } from '@/lib/github/app'
import { updateTicketAIDraft } from '@/lib/db/queries/tickets'
import { createNotification } from '@/lib/db/queries/notifications'
import { saveAssessment } from '@/lib/db/queries/assessments'
import { mapAnswerMessage } from '@/lib/db/queries/feedback'
import { mapCsatMessage } from '@/lib/db/queries/csat'
import { assessAnswer, shouldAutoDeflect, AUTO_DEFLECT_THRESHOLD, ASSESS_MODEL } from '@/lib/ai/assess'
import { postReply, postReplyToGithub, sendKeepAlive, type Platform } from '@/lib/channels/post-reply'
import { reserveAutoDeflect } from '@/lib/billing/usage'
import { orgHasFeature } from '@/lib/billing/entitlements-server'
import { captureUnansweredQuestion } from '@/lib/kb/review-capture'
import { getIntegration } from '@/lib/db/queries/integrations'
import { updateTicketAIDraftStatus, getTicketById } from '@/lib/db/queries/tickets'
import { logger } from '@/lib/logger'
import { countArticleUsage } from '@/lib/kb/usage'
import type { AIDraftSkipReason, PriorAnswer, TicketCategory } from '@/types'
import { REFERENCE_MATERIAL_NOTICE, renderReferenceBlock } from '@/lib/ai/reference-block'
import type { Match } from '@/lib/ai/related'

const MOD = 'ai/agent'

// GitHub has no channelId-shaped destination — postReply (lib/channels/
// post-reply.ts) no-ops for it and expects callers to branch instead. Every
// call site in this file already has `ticketId` in scope, so look the
// ticket up for its owner/repo + issue number rather than threading a new
// parameter through runAIAgent's whole call chain.
async function dispatch(
  channelId: string,
  content: string,
  orgId: number,
  platform: Platform,
  ticketId?: number,
  slackChannelId?: string,
  slackThreadTs?: string
): Promise<string | null> {
  if (platform === 'github' && ticketId) {
    const ticket = await getTicketById(ticketId, orgId)
    if (!ticket?.source_channel_id || !ticket?.source_message_id) return null
    return postReplyToGithub(ticket.source_channel_id, ticket.source_message_id, content, orgId)
  }
  return postReply(channelId, content, orgId, platform, ticketId, slackChannelId, slackThreadTs)
}

// Formats the "needs human review" @mention for the configured escalation
// role/group, per platform mention syntax. Shared by the KB-graded
// needs-human path and the bug/feature_request acknowledgment path so the
// mention format never drifts between the two.
function formatEscalationMention(
  escalationRoleId: string | null,
  platform: Platform,
  reasonText: string
): string {
  if (!escalationRoleId) return ''
  if (platform === 'discord') {
    return `\n\n<@&${escalationRoleId}> ${reasonText}`
  }
  if (platform === 'slack') {
    // Slack: S = user group, U = user, else raw
    if (escalationRoleId.startsWith('S')) return `\n\n<!subteam^${escalationRoleId}> ${reasonText}`
    if (escalationRoleId.startsWith('U')) return `\n\n<@${escalationRoleId}> ${reasonText}`
    return `\n\n${escalationRoleId} ${reasonText}`
  }
  if (platform === 'email') {
    // Email: note escalation contact in reply body (can't @mention)
    return `\n\nThis question has been flagged for human review. ${escalationRoleId} will follow up.`
  }
  if (platform === 'google_chat') {
    // Google Chat has no role/group concept like Discord/Slack — a mention
    // targets one specific user by their Chat user resource id
    // (`users/12345`), so escalationRoleId is expected in that form here.
    return `\n\n<${escalationRoleId}> ${reasonText}`
  }
  // Telegram and Discourse: plain `@username` mention
  return `\n\n@${escalationRoleId} ${reasonText}`
}

// Posts the standard "Needs Human Review" message and marks the ticket
// accordingly. Shared by the low-confidence KB-graded path and the
// bug/feature_request path (which never runs the confidence grader at all,
// so it has no percentage to show).
//
// `postDraftPublicly` defaults to true for the bug/feature_request caller,
// whose bodyText is always a generic template acknowledgment ("we don't
// have this tracked yet") — safe to post as-is, it never exposes anything
// AI wrote. The KB-graded low-confidence caller passes false: its bodyText
// is the actual AI-drafted answer, and posting an unreviewed AI answer
// publicly the moment confidence comes back low defeats the entire
// confidence-gate premise ("only high-confidence answers post
// automatically, everything else is routed to a human with a draft" — the
// draft was going out live anyway). When false, the ticket is marked
// needs_human, the draft stays saved (updateTicketAIDraft already ran
// before this) for a staff member to approve from the dashboard, and a
// brief generic acknowledgment (never the draft text) is sent instead —
// asking a question and getting total silence is indistinguishable from a
// broken bot, so something must go out even though the real answer can't.
//
// `postToChannel` defaults to true and is set to `autoDeflectEnabled` by
// every call site. Automatic Deflections off means the bot posts no real
// content to the live channel — the ticket is still marked needs_human and
// the draft still waits on the dashboard, and an org that turned
// auto-replies off does not want the bot talking in the channel
// unsupervised. Google Chat still gets sendKeepAlive's neutral receipt in
// this case (see its doc comment in lib/channels/post-reply.ts) — that's
// not "content," it carries no information about the ticket at all, it
// only stops Chat's client from flagging the app as broken.
//
// There is deliberately no "headerLabel" param here anymore — a prior
// version prefixed every outbound message with `**[Needs Human Review —
// 70% confidence]**`, which meant a customer could read their own AI
// confidence score in plain text. That's an internal metric with no
// business being customer-facing, on any platform, so the message this
// function sends never includes it; the equivalent label still reaches
// staff via the `createNotification` call each caller makes separately.
async function postNeedsHumanReview(
  ticketId: number,
  channelId: string,
  orgId: number,
  platform: Platform,
  bodyText: string,
  escalationRoleId: string | null,
  escalationReasonText: string,
  slackChannelId?: string,
  slackThreadTs?: string,
  postDraftPublicly: boolean = true,
  postToChannel: boolean = true,
  skipReason?: AIDraftSkipReason
): Promise<void> {
  await updateTicketAIDraftStatus(ticketId, 'needs_human', undefined, skipReason)
  if (!postToChannel) {
    await sendKeepAlive(platform, channelId, orgId)
    return
  }
  const escalationMention = formatEscalationMention(escalationRoleId, platform, escalationReasonText)
  const message = postDraftPublicly
    ? `${bodyText}\n\n*A team member will follow up shortly.*${escalationMention}`
    : `Thanks for reaching out — a team member will follow up shortly.${escalationMention}`
  const postedMessageId = await dispatch(channelId, message, orgId, platform, ticketId, slackChannelId, slackThreadTs)
  if (postedMessageId) await mapAnswerMessage(postedMessageId, ticketId)
}

export async function runAIAgent(
  ticketId: number,
  question: string,
  channelId: string,
  priorAnswers: PriorAnswer[] = [],
  orgId: number,
  platform: Platform = 'discord',
  category: TicketCategory,
  duplicates: Match[] = [],
  // The number actually shown to users ("#3") — distinct from ticketId,
  // which is the global DB primary key and must never appear in anything a
  // customer or staff member reads. See lib/db/schema.ts's tickets table.
  orgTicketNumber: number,
  // Slack-only, see postReply above: the real channel id and (if this is a
  // thread reply) the thread's ts, kept separate from `channelId` since
  // that param means something different for Discord (thread-id-or-channel)
  // than for Slack (which needs both a real channel and thread_ts).
  slackChannelId?: string,
  slackThreadTs?: string
): Promise<void> {
  // A ticket already held for a person gets no draft and no automated message.
  let held: Awaited<ReturnType<typeof getTicketById>> | null = null
  try {
    held = await getTicketById(ticketId, orgId)
  } catch {
    held = null
  }
  if (held?.ai_draft_status === 'needs_human') {
    logger.info('ticket held for review — skipping automated answer', { module: MOD, ticketId, orgId })
    return
  }

  // Load escalation config for this platform (github/mcp have no integrations row — returns null)
  const integration = platform === 'github' || platform === 'mcp'
    ? null
    : await getIntegration(orgId, platform as Exclude<Platform, 'github' | 'mcp'>).catch(() => null)
  // human_escalation is a Pro+ feature. Gated here rather than only at save
  // time, so a role id saved before a downgrade (or set before this gate
  // existed) stops being honored the moment the org's entitlement lapses —
  // not just for newly-configured roles.
  const rawEscalationRoleId = integration?.escalation_role_id ?? null
  const escalationRoleId = rawEscalationRoleId && (await orgHasFeature(orgId, 'human_escalation'))
    ? rawEscalationRoleId
    : null

  // Automatic Deflections — per-platform/per-repo toggle, default OFF.
  // Computed once up front (not just for the KB-graded path below) because
  // it now gates every automated message this function can send: while
  // it's off, nothing gets posted to the live channel for ANY ticket —
  // bug/feature acks and duplicate/workaround replies included, not only
  // the confidence-graded answer. The ticket, its AI draft, and the staff
  // notification are unaffected; only the outbound post is suppressed,
  // leaving a human to approve and send from the dashboard. GitHub has no
  // `integrations` row (see the `integration` fetch above), so its toggle
  // lives on the repo's own auto_deflect_enabled column instead.
  const autoDeflectEnabled = await (async () => {
    if (platform === 'mcp') return false // no live channel regardless
    if (platform === 'circle') return false // ingest-only (stage 1) — no write path
    if (platform === 'github') {
      const [owner, repo] = channelId.split('/')
      if (!owner || !repo) return false
      const { getRepoByOwnerAndName } = await import('@/lib/db/queries/github')
      const repoRecord = await getRepoByOwnerAndName(owner, repo)
      return repoRecord?.auto_deflect_enabled === 1
    }
    return integration?.auto_deflect_enabled === 1
  })()

  // Bug reports and feature requests are not KB-deflectable — the fix or feature
  // doesn't exist yet, so a generated "answer" would either hallucinate a
  // resolution or explain away a real problem. Skip the KB-grounded draft and
  // the confidence grader entirely; this category never auto-deflects.
  if (category === 'bug' || category === 'feature_request') {
    try {
      if (duplicates.length > 0) {
        const top = duplicates[0]
        // top.related_id is a different ticket's global DB id — its own
        // org_ticket_number has to be looked up separately, it's never the
        // same number as the current ticket's.
        const relatedTicket = await getTicketById(top.related_id, orgId)
        const relatedNumber = relatedTicket?.org_ticket_number ?? top.related_id
        const text = `Thanks for the report — this looks like something we're already tracking as ticket #${relatedNumber}. We'll keep that ticket updated as it progresses.`
        await createNotification(
          'ai_draft_ready',
          `Duplicate report linked to ticket #${relatedNumber} — ticket #${orgTicketNumber}`,
          ticketId,
          orgId
        )
        if (autoDeflectEnabled) {
          await updateTicketAIDraft(ticketId, text)
          const message = `${text}\n\n*React 👍 / 👎 if this helped. A team member will follow up if not.*`
          const postedMessageId = await dispatch(channelId, message, orgId, platform, ticketId, slackChannelId, slackThreadTs)
          if (postedMessageId) await mapAnswerMessage(postedMessageId, ticketId)
        } else {
          // Automatic Deflections off — draft stays saved for approval, no real content posts to the channel.
          await updateTicketAIDraftStatus(ticketId, 'needs_human', text)
          await sendKeepAlive(platform, channelId, orgId)
        }
        logger.info('bug/feature_request matched to existing ticket', {
          module: MOD, ticketId, category, relatedId: top.related_id, platform, autoDeflectEnabled,
        })
        return
      }

      if (priorAnswers.length > 0) {
        const workaround = priorAnswers[0]
        const text = `We don't have a fix for this yet, but as a workaround: ${workaround.answer}\n\nThis isn't a resolution — a team member will follow up on the underlying issue.`
        await createNotification(
          'ai_draft_ready',
          `Workaround posted (no fix yet) — ticket #${orgTicketNumber}`,
          ticketId,
          orgId
        )
        if (autoDeflectEnabled) {
          await updateTicketAIDraft(ticketId, text)
          const message = `${text}\n\n*React 👍 / 👎 if this helped. A team member will follow up if not.*`
          const postedMessageId = await dispatch(channelId, message, orgId, platform, ticketId, slackChannelId, slackThreadTs)
          if (postedMessageId) await mapAnswerMessage(postedMessageId, ticketId)
        } else {
          // Automatic Deflections off — draft stays saved for approval, no real content posts to the channel.
          await updateTicketAIDraftStatus(ticketId, 'needs_human', text)
          await sendKeepAlive(platform, channelId, orgId)
        }
        logger.info('bug/feature_request offered KB workaround', { module: MOD, ticketId, category, platform, autoDeflectEnabled })
        return
      }

      await createNotification(
        'ai_draft_ready',
        `${category === 'bug' ? 'Bug report' : 'Feature request'} needs human review — ticket #${orgTicketNumber}`,
        ticketId,
        orgId
      )
      const bodyText = category === 'bug'
        ? "Thanks for the report — we don't have this tracked yet. A team member will take a look and follow up here."
        : "Thanks for the suggestion — we don't have this in progress yet. A team member will review it and follow up here."
      await postNeedsHumanReview(
        ticketId,
        channelId,
        orgId,
        platform,
        bodyText,
        escalationRoleId,
        `this ${category === 'bug' ? 'report' : 'request'} needs human review`,
        slackChannelId,
        slackThreadTs,
        true, // this ack is always a static template, never AI-drafted content — safe to post as-is when Automatic Deflections is on
        autoDeflectEnabled, // off means no channel post at all, not even the generic ack
        'bug_or_feature'
      )
      logger.info('bug/feature_request routed to human review', { module: MOD, ticketId, category, platform, autoDeflectEnabled })
    } catch (err) {
      logger.error('agent failed', { module: MOD, ticketId, error: err })
    }
    return
  }

  const repos = await getConfiguredRepos(orgId)
  const hasCodeSearch = repos.length > 0
  const repoList = repos.join(', ')

  if (!hasCodeSearch) {
    logger.info('no GitHub repos configured — running agent in KB-only mode', { module: MOD, ticketId, orgId })
  }

  // Prior resolved answers for similar questions — prefer reusing these.
  const priorContext = priorAnswers.length
    ? `\n\nThe team has already answered similar questions before. Prefer reusing and adapting these resolved answers when they fit${hasCodeSearch ? '; only search the source code if they don’t fully cover the question' : ''}:\n\n${REFERENCE_MATERIAL_NOTICE}\n${renderReferenceBlock(priorAnswers.map((p) => ({ question: p.summary, answer: p.answer })))}`
    : ''

  const system = hasCodeSearch
    ? `You are a technical support agent for an open source software project.
You have tools to search and read the project source code on GitHub.
Configured repositories: ${repoList}

Guidelines:
- If a prior resolved answer below already covers the question, reuse and adapt it instead of searching
- Otherwise search the source code before answering
- Cite specific files and relevant code when applicable
- Be concise, accurate, and helpful
- If you cannot find relevant code, say so honestly
- Format your answer in markdown for Discord
- Respond in the same language as the question — if the user wrote in Spanish, reply in Spanish; French, reply in French; etc.${priorContext}`
    : `You are a technical support agent for a software project.

Guidelines:
- Answer using the team's prior resolved answers below when they cover the question
- Do not invent project-specific details (APIs, file names, config options) that are not in the prior answers — if the prior answers don't cover the question, say honestly that a team member will follow up
- Be concise, accurate, and helpful
- Format your answer in markdown for Discord
- Respond in the same language as the question — if the user wrote in Spanish, reply in Spanish; French, reply in French; etc.${priorContext}`

  try {
    const t0 = Date.now()

    // Tools are built per-call (not module-level) because they close over
    // orgId and repoList, both of which vary per ticket — see searchCode/
    // readFile/listFiles in lib/github/tools.ts.
    const tools = hasCodeSearch
      ? {
          searchCode: createTool({
            id: 'searchCode',
            description: 'Search for code, functions, or patterns in the configured repositories',
            inputSchema: z.object({
              query: z.string().describe('Search query — use function names, error messages, or keywords'),
              repo: z.string().describe(`Repository in owner/repo format. Available: ${repoList}`),
            }),
            execute: async (input) => searchCode(input.query, input.repo, orgId),
          }),
          readFile: createTool({
            id: 'readFile',
            description: 'Read the full contents of a specific file from a repository',
            inputSchema: z.object({
              path: z.string().describe('File path relative to repo root, e.g. src/auth/index.ts'),
              repo: z.string().describe(`Repository in owner/repo format. Available: ${repoList}`),
              ref: z.string().optional().describe('Branch name or commit SHA (default: main)'),
            }),
            execute: async (input) => readFile(input.path, input.repo, orgId, input.ref),
          }),
          listFiles: createTool({
            id: 'listFiles',
            description: 'List files and directories at a path in a repository',
            inputSchema: z.object({
              path: z.string().describe('Directory path, e.g. src/components or empty string for root'),
              repo: z.string().describe(`Repository in owner/repo format. Available: ${repoList}`),
            }),
            execute: async (input) => listFiles(input.path, input.repo, orgId),
          }),
        }
      : undefined

    // Instantiated per-call rather than module-level: the model itself is
    // resolved per-org by chatModel() (mock mode, org-configured provider,
    // included platform usage — see lib/ai/models.ts), so there is
    // no single Agent instance that would be valid across orgs.
    const supportAgent = new Agent({
      id: 'support-agent',
      name: 'support-agent',
      instructions: system,
      // chatModel() returns the real 'ai' package's LanguageModel — runtime
      // compatible with Mastra (Mastra just calls doGenerate/doStream), but
      // @mastra/core vendors its own copy of the @ai-sdk/provider types with
      // branded `unique symbol` fields, so the two structurally-identical
      // types don't unify nominally. Cast at this one boundary.
      model: (await chatModel(DEFAULT_CHAT_MODEL, orgId)) as MastraModelConfig,
      tools,
    })

    const { text } = await supportAgent.generate(question, { maxSteps: 5 })

    logger.info('agent answer generated', { module: MOD, ticketId, durationMs: Date.now() - t0 })
    await updateTicketAIDraft(ticketId, text)
    // The draft is written, so the articles it was grounded on count as used.
    await countArticleUsage(orgId, priorAnswers)

    let assessment
    try {
      assessment = await assessAnswer(question, text, orgId)
    } catch (err) {
      logger.error('assessment failed — defaulting to human review', { module: MOD, ticketId, error: err })
      assessment = { confidence: 0, answered_fully: false, reasoning: 'Assessment failed; routed to human review.' }
    }

    // autoDeflectEnabled is computed once at the top of runAIAgent — see the
    // comment there. GitHub's confidence threshold has no per-repo column,
    // so it always falls back to the platform-wide AUTO_DEFLECT_THRESHOLD.
    const threshold = integration?.confidence_threshold ?? AUTO_DEFLECT_THRESHOLD
    const meetsConfidenceBar = shouldAutoDeflect(assessment, threshold)
    const wantsAutoDeflect = meetsConfidenceBar && autoDeflectEnabled
    const pct = Math.round(assessment.confidence * 100)

    const assessmentFields = {
      ticketId,
      confidence: assessment.confidence,
      answeredFully: assessment.answered_fully,
      reasoning: assessment.reasoning,
      model: ASSESS_MODEL,
    }

    // Only the auto-deflect path counts against the plan's monthly limit, so
    // only it needs the atomic check-and-write. A non-deflected assessment
    // isn't racing anything and can just be saved directly.
    const autoDeflect = wantsAutoDeflect
      ? await reserveAutoDeflect(orgId, (tx, allowed) =>
          saveAssessment({ ...assessmentFields, autoDeflected: allowed }, tx)
        )
      : await saveAssessment({ ...assessmentFields, autoDeflected: false }).then(() => false)

    if (wantsAutoDeflect && !autoDeflect) {
      logger.warn('deflection limit reached — routing to human review', { module: MOD, ticketId, orgId })
    }

    logger.info('assessment complete', { module: MOD, ticketId, confidence: pct, autoDeflect })

    if (autoDeflect) {
      await createNotification('ai_draft_ready', `Auto-answered (${pct}%) — ticket #${orgTicketNumber}`, ticketId, orgId)
      const message = `${text}\n\n*React 👍 / 👎 if this helped. A team member will follow up if not.*`
      const postedMessageId = await dispatch(channelId, message, orgId, platform, ticketId, slackChannelId, slackThreadTs)
      if (postedMessageId) await mapAnswerMessage(postedMessageId, ticketId)

      // Post CSAT prompt as follow-up and store its message ID
      const csatPrompt = `*How would you rate this answer?*\n1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣\n_(React with a number to rate)_`
      const csatMessageId = await dispatch(channelId, csatPrompt, orgId, platform, ticketId, slackChannelId, slackThreadTs)
      if (csatMessageId) await mapCsatMessage(csatMessageId, ticketId)

      logger.info('auto-deflected', { module: MOD, ticketId, confidence: pct, platform })
    } else {
      // Two distinct reasons an answer didn't auto-post: it genuinely wasn't
      // confident enough, or it was confident enough but the org hasn't
      // turned Automatic Deflections on for this platform yet. Label these
      // differently on the dashboard — a staff member seeing "92% confidence,
      // needs review" when the answer would have cleared the bar is
      // confusing; "ready to send, just waiting on the toggle" isn't.
      const heldByToggleOnly = meetsConfidenceBar && !autoDeflectEnabled
      const notificationText = heldByToggleOnly
        ? `Ready to send (${pct}%) — Automatic Deflections is off — ticket #${orgTicketNumber}`
        : `Needs human review (${pct}%) — ticket #${orgTicketNumber}`
      await createNotification('ai_draft_ready', notificationText, ticketId, orgId)
      await postNeedsHumanReview(
        ticketId,
        channelId,
        orgId,
        platform,
        text,
        escalationRoleId,
        // No confidence percentage here — this reason text is appended
        // straight into the customer-visible message by
        // formatEscalationMention, and AI confidence is an internal metric,
        // not something a customer should ever read.
        'this question needs human review',
        slackChannelId,
        slackThreadTs,
        false, // never post the unreviewed AI draft publicly — a generic ack goes out instead, see postNeedsHumanReview's doc comment
        autoDeflectEnabled // Automatic Deflections off means no channel post at all, not even the generic ack
      )
      logger.info('routed to human review — draft held for approval, generic ack sent instead', { module: MOD, ticketId, confidence: pct, platform, escalated: !!escalationRoleId, heldByToggleOnly })
    }

    // Nothing in the KB or the team's prior answers covered this question, so
    // queue it for a person to turn into an article. Runs after the reply is
    // out, so it can never delay an answer. The draft only rides along when
    // the grader judged it a full answer; otherwise the reviewer writes one.
    if (priorAnswers.length === 0) {
      await captureUnansweredQuestion({
        orgId,
        source: 'ticket',
        question,
        answer: assessment.answered_fully ? text : '',
        ticketId,
        confidence: assessment.confidence,
      })
    }
  } catch (err) {
    if (err instanceof NoAIProviderConfiguredError) {
      // No draft attempted — the ticket still exists (ingestion never
      // depended on this), it just needs a human, with a clear reason
      // instead of silently going stale.
      await updateTicketAIDraftStatus(ticketId, 'needs_human', undefined, err.skipReason)
      await createNotification(
        'ai_draft_ready',
        `AI answer skipped for ticket #${orgTicketNumber} — open the ticket to see why`,
        ticketId,
        orgId
      )
      logger.warn('no AI provider configured — skipped drafting, routed to human', { module: MOD, ticketId, orgId })
      return
    }
    logger.error('agent failed', { module: MOD, ticketId, error: err })
  }
}
