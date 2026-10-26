import {
  pgTable,
  serial,
  integer,
  bigint,
  smallint,
  text,
  doublePrecision,
  primaryKey,
  uniqueIndex,
  index,
  jsonb,
  boolean,
  timestamp,
  date,
  vector,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

const now = sql`now()`

export const orgs = pgTable('orgs', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').unique(),
  onboardedAt: text('onboarded_at'),
  widgetToken: text('widget_token').unique(),
  widgetTokenExpiresAt: text('widget_token_expires_at'),
  // Newline-separated hostnames the widget may be embedded on. NULL or empty
  // means unrestricted, which is the pre-existing behaviour and stays the
  // default so adding this column cannot break a live embed.
  widgetAllowedOrigins: text('widget_allowed_origins'),
  roiMinutesPerTicket: integer('roi_minutes_per_ticket'),
  roiStaffHourlyRate: integer('roi_staff_hourly_rate'),
  // Set the moment an owner confirms account deletion. NULL means active.
  // Access is revoked immediately (see requireOrgAccess), but the row and
  // all its dependent data survive until a background sweep hard-purges it
  // ORG_PURGE_GRACE_DAYS after this timestamp — long enough for an owner to
  // restore an accidental deletion, short enough to actually honor the
  // deletion rather than leaving it soft-deleted forever.
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  // Per-org ticket numbering counter. tickets.id is a global serial shared
  // across every org (correct for FKs, wrong to show a customer — org 12's
  // 3rd-ever ticket showing as "#847" leaks how many tickets every other
  // org on the platform has created). Assigning via
  // `UPDATE orgs SET next_ticket_number = next_ticket_number + 1 ... RETURNING`
  // is race-safe on its own — Postgres row-level locking serializes
  // concurrent updates to the same org row — so no separate advisory lock
  // is needed the way billing's deflection counters require. See
  // getNextOrgTicketNumber in lib/db/queries/tickets.ts.
  nextTicketNumber: integer('next_ticket_number').notNull().default(1),
  // Included platform AI usage spent during the trial, in micro-dollars, for
  // the whole trial. Incremented atomically per call by recordSpend in
  // lib/billing/platform-ai-budget.ts. Paid-plan spend lives in
  // platformAiUsage, per month.
  trialChatSpendMicros: bigint('trial_chat_spend_micros', { mode: 'number' }).notNull().default(0),
  trialEmbeddingSpendMicros: bigint('trial_embedding_spend_micros', { mode: 'number' }).notNull().default(0),
  // The embedding model this workspace's stored vectors belong to. Queries
  // and writes use it until the re-embed job moves everything to the target
  // model and switches it; see lib/ai/embedding-pin.ts. Null until the first
  // vector is written.
  embeddingModelInUse: text('embedding_model_in_use'),
  // Re-embed job bookkeeping (lib/kb/embedding-migration.ts): a lease held
  // while a pass runs, when it last ran, and how many passes in a row failed
  // (failing workspaces back off exponentially).
  embeddingMigrationLeaseUntil: timestamp('embedding_migration_lease_until', { withTimezone: true }),
  embeddingMigrationAttemptedAt: timestamp('embedding_migration_attempted_at', { withTimezone: true }),
  embeddingMigrationFailures: integer('embedding_migration_failures').notNull().default(0),
  createdAt: text('created_at').notNull().default(now),
})

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').unique(),
  name: text('name'),
  image: text('image'),
  provider: text('provider'),
  createdAt: text('created_at').notNull().default(now),
})

export const memberships = pgTable('memberships', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  orgId: integer('org_id').notNull().references(() => orgs.id),
  role: text('role').notNull().default('owner'),
  createdAt: text('created_at').notNull().default(now),
})

// org_id NULL rows are the global defaults; a row with an org_id is that
// workspace's own target for the priority and takes precedence.
export const slaConfigs = pgTable(
  'sla_configs',
  {
    id: serial('id').primaryKey(),
    orgId: integer('org_id').references(() => orgs.id, { onDelete: 'cascade' }),
    priority: text('priority').notNull(),
    responseHours: integer('response_hours').notNull(),
    resolveHours: integer('resolve_hours').notNull(),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('sla_configs_org_priority_unique').on(t.orgId, t.priority).where(sql`org_id IS NOT NULL`),
    uniqueIndex('sla_configs_default_priority_unique').on(t.priority).where(sql`org_id IS NULL`),
  ]
)

export const tickets = pgTable(
  'tickets',
  {
    id: serial('id').primaryKey(),
    orgId: integer('org_id').notNull().default(1).references(() => orgs.id),
    // The number actually shown to users ("#3"), unique per org — id above
    // is a global serial shared by every org and must never be displayed.
    // Assigned atomically from orgs.nextTicketNumber at creation time; see
    // getNextOrgTicketNumber / createTicket in lib/db/queries/tickets.ts.
    orgTicketNumber: integer('org_ticket_number').notNull(),
    // source_* columns are generic across every ingest platform (Discord,
    // Slack, Telegram, Email, GitHub) — named discord_* until August 2026
    // from when Discord was the only channel; a Slack thread_ts, a Telegram
    // reply-to id, etc. all live in source_thread_id the same way a Discord
    // one does. discord_guild_id and discord_deleted_at are genuinely
    // Discord-specific (guilds are a Discord concept; the deleted-at
    // tracking has no equivalent on other platforms) and stay as-is.
    sourceMessageId: text('source_message_id'),
    discordGuildId: text('discord_guild_id'),
    sourceChannelId: text('source_channel_id'),
    sourceThreadId: text('source_thread_id'),
    sourceAuthorId: text('source_author_id'),
    sourceAuthorName: text('source_author_name'),
    discordDeletedAt: text('discord_deleted_at'),
    // Precomputed deep link back to the original message, for platforms
    // where a working URL can't be derived from stored IDs alone at render
    // time (Slack needs the workspace's chat.getPermalink API response,
    // resolved once at ingest time while the bot token is in hand — unlike
    // Discord/Telegram/GitHub, which construct their link from
    // discordGuildId/sourceChannelId/sourceMessageId directly).
    sourceUrl: text('source_url'),
    sourcePlatform: text('source_platform').notNull().default('discord'),
    content: text('content').notNull(),
    category: text('category'),
    severityScore: doublePrecision('severity_score'),
    aiSummary: text('ai_summary'),
    aiSuggestedPriority: text('ai_suggested_priority'),
    aiDraft: text('ai_draft'),
    aiDraftStatus: text('ai_draft_status').notNull().default('pending'),
    // Why a ticket was routed to a person with no draft (see AIDraftSkipReason
    // in types/index.ts). Null on tickets that have a draft, on tickets that
    // predate the column, and whenever the status moves off needs_human.
    aiDraftSkipReason: text('ai_draft_skip_reason'),
    aiDraftPostedAt: text('ai_draft_posted_at'),
    priority: text('priority').notNull().default('medium'),
    status: text('status').notNull().default('open'),
    resolutionNotes: text('resolution_notes'),
    slaResponseDeadline: text('sla_response_deadline'),
    slaResolveDeadline: text('sla_resolve_deadline'),
    slaResponseMet: integer('sla_response_met'),
    slaResolveMet: integer('sla_resolve_met'),
    firstResponseAt: text('first_response_at'),
    resolvedAt: text('resolved_at'),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [
    index('idx_tickets_status').on(t.status),
    index('idx_tickets_priority').on(t.priority),
    index('idx_tickets_category').on(t.category),
    index('idx_tickets_ai_draft').on(t.aiDraftStatus),
    index('idx_tickets_org').on(t.orgId),
    uniqueIndex('tickets_org_ticket_number_unique').on(t.orgId, t.orgTicketNumber),
    // Message ids are unique within one org's tickets, not across the platform:
    // two workspaces can legitimately see the same platform-issued id.
    uniqueIndex('tickets_org_source_message_unique').on(t.orgId, t.sourceMessageId),
  ]
)

export const ticketReplies = pgTable('ticket_replies', {
  id: serial('id').primaryKey(),
  ticketId: integer('ticket_id').notNull().references(() => tickets.id),
  staffName: text('staff_name').notNull(),
  content: text('content').notNull(),
  discordMsgId: text('discord_msg_id'),
  createdAt: text('created_at').notNull().default(now),
})

export const ticketEvents = pgTable('ticket_events', {
  id: serial('id').primaryKey(),
  ticketId: integer('ticket_id').notNull().references(() => tickets.id),
  eventType: text('event_type').notNull(),
  oldValue: text('old_value'),
  newValue: text('new_value'),
  actor: text('actor'),
  createdAt: text('created_at').notNull().default(now),
})

export const githubRepos = pgTable('github_repos', {
  id: serial('id').primaryKey(),
  orgId: integer('org_id').notNull().default(1).references(() => orgs.id),
  installationId: integer('installation_id').notNull(),
  owner: text('owner').notNull(),
  repo: text('repo').notNull(),
  isPrivate: integer('is_private').notNull().default(0),
  monitoredEvents: text('monitored_events').notNull().default('both'),
  kbEnabled: integer('kb_enabled').notNull().default(0),
  kbLastSynced: text('kb_last_synced'),
  kbChunkCount: integer('kb_chunk_count').notNull().default(0),
  // Automatic Deflections for this repo — same meaning/default as
  // integrations.autoDeflectEnabled, but GitHub has no integrations row
  // (repos are connected per-repo, not one row per platform), so it lives
  // here instead. See lib/db/schema.ts's integrations table for the doc.
  autoDeflectEnabled: integer('auto_deflect_enabled').notNull().default(0),
  addedAt: text('added_at').notNull().default(now),
}, (t) => ({
  ownerRepoUnique: uniqueIndex('github_repos_owner_repo_unique').on(t.owner, t.repo),
}))

// One row per Discord server an org has connected via the OAuth "Add to
// Discord" flow. A guild can only belong to one org (unique on guildId) —
// mirrors githubRepos: a child table keyed by orgId, not unique-per-org,
// since an org can connect any number of servers.
export const discordGuilds = pgTable('discord_guilds', {
  id: serial('id').primaryKey(),
  orgId: integer('org_id').notNull().references(() => orgs.id),
  guildId: text('guild_id').notNull(),
  guildName: text('guild_name'),
  channelIds: text('channel_ids'),
  escalationRoleId: text('escalation_role_id'),
  enabled: integer('enabled').notNull().default(1),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
}, (t) => [
  uniqueIndex('discord_guilds_guild_unique').on(t.guildId),
  index('idx_discord_guilds_org').on(t.orgId),
])

export const faqSnapshots = pgTable('faq_snapshots', {
  id: serial('id').primaryKey(),
  orgId: integer('org_id').notNull().default(1).references(() => orgs.id),
  weekStart: text('week_start').notNull(),
  weekEnd: text('week_end').notNull(),
  content: text('content').notNull(),
  ticketCount: integer('ticket_count').notNull(),
  generatedAt: text('generated_at').notNull().default(now),
})

export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  orgId: integer('org_id').notNull().default(1).references(() => orgs.id),
  ticketId: integer('ticket_id').references(() => tickets.id),
  type: text('type').notNull(),
  message: text('message').notNull(),
  read: integer('read').notNull().default(0),
  createdAt: text('created_at').notNull().default(now),
})

export const pushSubscriptions = pgTable('push_subscriptions', {
  id: serial('id').primaryKey(),
  orgId: integer('org_id').notNull().default(1).references(() => orgs.id),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: text('created_at').notNull().default(now),
})

export const ticketEmbeddings = pgTable('ticket_embeddings', {
  ticketId: integer('ticket_id').primaryKey().references(() => tickets.id),
  vector: text('vector').notNull(),
  model: text('model').notNull(),
  // Written only by the re-embed job (lib/kb/embedding-migration.ts) while a
  // workspace moves to a new embedding model; null otherwise.
  vectorNext: text('vector_next'),
  modelNext: text('model_next'),
  createdAt: text('created_at').notNull().default(now),
})

export const ticketLinks = pgTable(
  'ticket_links',
  {
    ticketId: integer('ticket_id').notNull().references(() => tickets.id),
    relatedId: integer('related_id').notNull().references(() => tickets.id),
    score: doublePrecision('score').notNull(),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [
    primaryKey({ columns: [t.ticketId, t.relatedId] }),
    index('idx_ticket_links_ticket').on(t.ticketId),
  ]
)

export const ticketFeedback = pgTable(
  'ticket_feedback',
  {
    id: serial('id').primaryKey(),
    ticketId: integer('ticket_id').notNull().references(() => tickets.id),
    source: text('source').notNull(),
    vote: text('vote').notNull(),
    actor: text('actor').notNull(),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('ticket_feedback_unique').on(t.ticketId, t.source, t.actor),
    index('idx_ticket_feedback_ticket').on(t.ticketId),
  ]
)

export const answerMessages = pgTable('answer_messages', {
  discordMessageId: text('discord_message_id').primaryKey(),
  ticketId: integer('ticket_id').notNull().references(() => tickets.id),
  createdAt: text('created_at').notNull().default(now),
})

export const aiAssessments = pgTable('ai_assessments', {
  ticketId: integer('ticket_id').primaryKey().references(() => tickets.id),
  confidence: doublePrecision('confidence').notNull(),
  answeredFully: integer('answered_fully').notNull(),
  autoDeflected: integer('auto_deflected').notNull().default(0),
  reasoning: text('reasoning'),
  model: text('model'),
  createdAt: text('created_at').notNull().default(now),
})

export const kbSources = pgTable(
  'kb_sources',
  {
    id: serial('id').primaryKey(),
    orgId: integer('org_id').notNull().references(() => orgs.id),
    filename: text('filename').notNull(),
    fileType: text('file_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    chunkCount: integer('chunk_count').notNull().default(0),
    // Whether this source's chunks are searchable + served to the website
    // widget. Defaults to 1 (every source before this column, and every
    // importer except Notion). The Notion sync writes 0 — its content stays
    // out of retrieval until the customer publishes it. Kept in lockstep with
    // kb_articles.published by setKBSourcePublished().
    published: integer('published').notNull().default(1),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [
    index('idx_kb_sources_org').on(t.orgId),
    index('idx_kb_sources_published').on(t.published),
  ]
)

// Background queue for KB syncs (Notion workspace, GitHub repo). The enqueue
// points ("Sync now", GitHub push webhook) insert a row and return; the bot
// process sweeps `queued` rows and drives each via POST /api/kb/sync-jobs/run.
// The partial unique index in drizzle/0039_kb_sync_jobs.sql debounces repeat
// enqueues for the same source while one is still active.
export const kbSyncJobs = pgTable(
  'kb_sync_jobs',
  {
    id: serial('id').primaryKey(),
    orgId: integer('org_id').notNull().references(() => orgs.id),
    kind: text('kind').notNull(), // 'notion' | 'github_repo'
    repoId: integer('repo_id'), // github_repos.id when kind = 'github_repo'
    status: text('status').notNull().default('queued'), // queued | running | succeeded | failed
    detail: text('detail'),
    syncedCount: integer('synced_count').notNull().default(0),
    progress: integer('progress').notNull().default(0),
    total: integer('total').notNull().default(0),
    currentItem: text('current_item'), // title of the doc/page currently being embedded, if known
    attempts: integer('attempts').notNull().default(0),
    createdAt: text('created_at').notNull().default(now),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
    // Bumped by the worker while it runs; the sweep reclaims a running job only
    // once this goes stale (drizzle/0056_kb_sync_job_lease.sql).
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true, mode: 'string' }),
    // A queued job is not claimed before this time (cooldown between runs).
    notBefore: timestamp('not_before', { withTimezone: true, mode: 'string' }),
    // Another trigger arrived while this job was running; finishing it queues
    // exactly one follow-up run.
    rerunRequested: boolean('rerun_requested').notNull().default(false),
  },
  (t) => [
    index('idx_kb_sync_jobs_status').on(t.status, t.createdAt),
    uniqueIndex('kb_sync_jobs_one_active')
      .on(t.orgId, t.kind, sql`COALESCE(${t.repoId}, 0)`)
      .where(sql`status IN ('queued', 'running')`),
  ]
)

// A connected Notion workspace, one row per org. The pasted internal
// integration token is encrypted at rest (lib/crypto/tokens.ts). Notion has no
// app-private-key path like GitHub, so the token must be persisted. Not read by
// the bot process, so no config_changed trigger.
export const notionConnections = pgTable('notion_connections', {
  id: serial('id').primaryKey(),
  orgId: integer('org_id').notNull().unique().references(() => orgs.id),
  accessToken: text('access_token').notNull(),
  workspaceName: text('workspace_name'),
  kbSourceId: integer('kb_source_id'),
  kbLastSynced: text('kb_last_synced'),
  kbChunkCount: integer('kb_chunk_count').notNull().default(0),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
})

export const kbArticles = pgTable(
  'kb_articles',
  {
    id: serial('id').primaryKey(),
    orgId: integer('org_id').notNull().default(1).references(() => orgs.id),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    embedding: text('embedding').notNull(),
    // pgvector mirror of `embedding` (same values, [n,n,...] text vs. a real
    // vector), used for ANN search — see lib/db/queries/kb.ts's
    // searchArticles(). Dimension is fixed platform-wide (see
    // lib/ai/embed.ts's KB_EMBEDDING_DIMENSIONS) rather than per-org, so a
    // single index can cover every org — a new write with a mismatched
    // dimension (an org on a custom, non-1536 embedding_model) fails loudly
    // at insert instead of silently going unindexed. NULL only occurs for
    // rows written before this column existed; searchArticles() excludes
    // NULL rows from vector search.
    embeddingVec: vector('embedding_vec', { dimensions: 1536 }),
    model: text('model').notNull(),
    // Written only by the re-embed job (lib/kb/embedding-migration.ts) while a
    // workspace moves to a new embedding model; null otherwise.
    embeddingNext: text('embedding_next'),
    embeddingVecNext: vector('embedding_vec_next', { dimensions: 1536 }),
    modelNext: text('model_next'),
    sourceTicketId: integer('source_ticket_id').references(() => tickets.id),
    sourceId: integer('source_id'),
    sourcePage: integer('source_page'),
    published: integer('published').notNull().default(1),
    // The team member who added the article by hand, promoted a ticket or
    // approved a review item. Null means unknown or automated: articles made
    // before this column existed, and imports and syncs (those carry source_id).
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    // Explicit verification: a person checked the answer is still correct. The
    // hash is of the question and answer they checked (lib/kb/revision.ts); the
    // article reads as verified only while its content still matches it. Only
    // the verify action writes these; imports and syncs never do. Null means
    // never verified.
    verifiedAt: text('verified_at'),
    verifiedBy: integer('verified_by').references(() => users.id, { onDelete: 'set null' }),
    verifiedContentHash: text('verified_content_hash'),
    verificationNote: text('verification_note'),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [
    index('idx_kb_articles_published').on(t.published),
    index('idx_kb_articles_org_published').on(t.orgId, t.published),
    index('idx_kb_articles_source').on(t.sourceTicketId),
    index('idx_kb_articles_source_id').on(t.sourceId),
    index('idx_kb_articles_embedding_vec').using('hnsw', t.embeddingVec.op('vector_cosine_ops')),
  ]
)

// How many answers each article was supplied to as context, one row per
// article per UTC day (see lib/db/queries/kb-usage.ts). A count only: nothing
// about the question, the visitor or the ticket is stored here.
export const kbArticleUsage = pgTable(
  'kb_article_usage',
  {
    articleId: integer('article_id').notNull().references(() => kbArticles.id, { onDelete: 'cascade' }),
    orgId: integer('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    day: date('day', { mode: 'string' }).notNull(),
    answers: integer('answers').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.articleId, t.day] }),
    index('idx_kb_article_usage_org_day').on(t.orgId, t.day),
  ]
)

// Questions the assistant answered without any knowledge-base coverage,
// captured so a person can review, fine-tune and approve the answer before it
// becomes a published article. Nothing here is searchable or served to anyone
// until approval creates a kb_articles row (see lib/db/queries/kb-review.ts).
// A repeat of the same unseen question bumps `occurrences` on the existing
// pending (or rejected) row instead of adding a new one.
export const kbReviewItems = pgTable(
  'kb_review_items',
  {
    id: serial('id').primaryKey(),
    orgId: integer('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    // 'ticket' (community channels, MCP, API) or 'widget'.
    source: text('source').notNull(),
    ticketId: integer('ticket_id').references(() => tickets.id, { onDelete: 'set null' }),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    // Same fixed platform-wide dimension as kb_articles.embedding_vec; used
    // only to fold near-duplicate questions together.
    embeddingVec: vector('embedding_vec', { dimensions: 1536 }),
    // The embedding model that made embeddingVec (the workspace's pin at
    // capture time); duplicates are only folded within one model.
    model: text('model'),
    confidence: doublePrecision('confidence'),
    occurrences: integer('occurrences').notNull().default(1),
    // Per-day cap bookkeeping for repeat-question merges.
    mergeDay: date('merge_day'),
    mergeDayCount: integer('merge_day_count').notNull().default(0),
    // 'pending' | 'approved' | 'rejected' (CHECK constraint in the migration).
    status: text('status').notNull().default('pending'),
    articleId: integer('article_id').references(() => kbArticles.id, { onDelete: 'set null' }),
    reviewedBy: integer('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: text('reviewed_at'),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [
    index('idx_kb_review_items_org_status').on(t.orgId, t.status, t.createdAt),
  ]
)

// Append-only history of what happened to knowledge-base articles: who made
// them, who changed them, and each review decision. Rows are never updated.
// `content_hash` is a fingerprint of the question and answer at that moment
// (lib/kb/revision.ts), never a copy of the text, so history survives the review
// text retention purge and does not duplicate article content. Review
// rejections and reopenings happen before any article exists, so `article_id`
// is null for them and `review_item_id` links them to the article once an
// approval creates it. `type` and `origin` are CHECK-constrained in the
// migration. Deleting an article deletes its history, the same as
// kb_article_usage.
export const kbArticleEvents = pgTable(
  'kb_article_events',
  {
    id: serial('id').primaryKey(),
    orgId: integer('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    articleId: integer('article_id').references(() => kbArticles.id, { onDelete: 'cascade' }),
    // 'created' | 'promoted' | 'edited' | 'review_approved' | 'review_rejected' | 'review_reopened' | 'verified'
    type: text('type').notNull(),
    // Null for automated events (imports and syncs) and for users since deleted.
    actorUserId: integer('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    // 'manual' | 'ticket_promotion' | 'review_queue' | 'import' | 'sync'
    origin: text('origin').notNull(),
    sourceTicketId: integer('source_ticket_id').references(() => tickets.id, { onDelete: 'set null' }),
    reviewItemId: integer('review_item_id').references(() => kbReviewItems.id, { onDelete: 'set null' }),
    contentHash: text('content_hash'),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [
    index('idx_kb_article_events_article').on(t.articleId, t.createdAt),
    index('idx_kb_article_events_review_item').on(t.reviewItemId),
    index('idx_kb_article_events_org').on(t.orgId),
  ]
)

export const integrations = pgTable(
  'integrations',
  {
    id: serial('id').primaryKey(),
    orgId: integer('org_id').notNull().references(() => orgs.id),
    platform: text('platform').notNull(),
    botToken: text('bot_token'),
    // Legacy plaintext column. New writes leave it NULL; rows written before
    // bot_secret_hash existed are hashed by the migration and re-encrypted
    // into bot_secret_enc the first time they are read (see
    // lib/db/queries/integrations.ts).
    botSecret: text('bot_secret').unique(),
    // SHA-256 (hex) of the per-integration shared secret. Inbound requests are
    // resolved by hashing the presented value and matching this column.
    botSecretHash: text('bot_secret_hash'),
    // The same secret, encrypted at rest, for the platforms that must read it
    // back (Telegram setWebhook secret_token, Discourse/Circle webhook
    // configuration, the bot process's outbound bearer).
    botSecretEnc: text('bot_secret_enc'),
    // Google Chat only: the one-time /connect code, kept apart from
    // bot_secret. The hash is matched on /connect, the encrypted copy lets the
    // settings page show a pending code, and both are cleared when pairing
    // completes.
    pairingCodeHash: text('pairing_code_hash'),
    pairingCodeEnc: text('pairing_code_enc'),
    pairingCodeExpiresAt: text('pairing_code_expires_at'),
    // Discourse only: the forum account the bot posts replies as, sent as the
    // `Api-Username` header on every write. Distinct from escalationRoleId,
    // which is the human tagged on low-confidence answers.
    botUsername: text('bot_username'),
    channelIds: text('channel_ids'),
    guildChannelMap: text('guild_channel_map'),
    teamId: text('team_id'),
    webhookSecret: text('webhook_secret'),
    // Telegram only: set when setWebhook last succeeded, so the Integrations
    // UI can distinguish "never registered" / "registered" instead of always
    // showing the same CTA. Cleared implicitly whenever the token changes
    // (see saveTelegramIntegrationAction), since a new token needs a fresh
    // setWebhook call before Telegram will deliver to it.
    webhookRegisteredAt: text('webhook_registered_at'),
    escalationRoleId: text('escalation_role_id'),
    connectedGuildId: text('connected_guild_id'),
    confidenceThreshold: doublePrecision('confidence_threshold').default(0.8),
    enabled: integer('enabled').notNull().default(1),
    // Automatic Deflections — default OFF. When 0, a high-confidence answer
    // is never auto-posted to the customer channel; it's held as a draft for
    // staff Approve/Edit/Dismiss and nothing is posted to the channel (Google
    // Chat alone gets a neutral receipt; see postNeedsHumanReview in
    // lib/ai/agent.ts). When 1, a
    // high-confidence answer auto-posts as before. Distinct from `enabled`
    // above, which gates whether the integration is connected at all.
    autoDeflectEnabled: integer('auto_deflect_enabled').notNull().default(0),
    // Discriminates how outbound email replies choose their From address.
    // 'platform' (default) = platform-hosted RESEND_FROM address. 'oauth' =
    // send through the org's connected Gmail or Outlook mailbox (see
    // emailOauthConnections below and lib/email/reply.ts). 'domain' = use the
    // verified row in emailDomains for this org as the From address.
    emailSendMethod: text('email_send_method').notNull().default('platform'),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('integrations_org_platform').on(t.orgId, t.platform),
    index('idx_integrations_bot_secret').on(t.botSecret),
    uniqueIndex('integrations_bot_secret_hash_unique').on(t.botSecretHash),
    uniqueIndex('integrations_pairing_code_hash_unique').on(t.pairingCodeHash),
    index('idx_integrations_org').on(t.orgId),
    // One enabled connection per external workspace/site/space. Slack team
    // ids, Discourse site URLs and Google Chat space names are stored in
    // team_id; inbound events resolve an org from that value alone.
    uniqueIndex('integrations_platform_team_enabled_unique')
      .on(t.platform, t.teamId)
      .where(sql`enabled = 1 AND team_id IS NOT NULL AND platform IN ('slack', 'discourse', 'google_chat')`),
  ]
)

// Verified custom-domain sending and receiving for the email channel. An org
// registers a domain, we hand back Resend's DKIM, return-path (SPF), and
// receiving MX records to paste at their DNS host, then poll status until
// Resend confirms ownership. Once verified, replies use this domain and
// Resend's email.received events route customer mail into the org's tickets.
export const emailDomains = pgTable(
  'email_domains',
  {
    id: serial('id').primaryKey(),
    orgId: integer('org_id').notNull().unique().references(() => orgs.id), // one custom domain per org for v1
    domain: text('domain').notNull(),
    provider: text('provider').notNull().default('resend'),
    providerDomainId: text('provider_domain_id'), // Resend's domain id; needed for get/verify/remove
    dkimRecordName: text('dkim_record_name'),
    dkimRecordValue: text('dkim_record_value'),
    returnPathRecordName: text('return_path_record_name'),
    returnPathRecordValue: text('return_path_record_value'),
    receivingRecordName: text('receiving_record_name'),
    receivingRecordValue: text('receiving_record_value'),
    receivingRecordPriority: integer('receiving_record_priority'),
    dmarcSuggestion: text('dmarc_suggestion'), // informational copy only, not enforced/polled
    // 'pending' | 'verified' | 'failed' — mirrors Resend's DomainStatus,
    // collapsed (not_started/partially_* fold into 'pending')
    status: text('status').notNull().default('pending'),
    lastCheckedAt: text('last_checked_at'),
    verifiedAt: text('verified_at'),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [index('idx_email_domains_org').on(t.orgId)]
)

// Send-only Gmail/Outlook OAuth connections (Phase 2/3 of the email
// integration redesign). An org connects its own mailbox; replies send
// through it directly, inheriting its sender reputation. Detection of a
// dead refresh token is unavoidably reactive (Google/Microsoft return a
// generic invalid_grant with no separate "revoked" signal) — see
// lib/email/gmail.ts's send path for the disconnect-on-failure handling.
export const emailOauthConnections = pgTable(
  'email_oauth_connections',
  {
    id: serial('id').primaryKey(),
    orgId: integer('org_id').notNull().unique().references(() => orgs.id), // one connection per org for v1
    provider: text('provider').notNull(), // 'gmail' | 'outlook' — both implemented, see lib/email/gmail.ts and lib/email/outlook.ts
    mailboxAddress: text('mailbox_address').notNull(), // shown in UI, from the token response
    accessToken: text('access_token'), // encrypted, short-lived cache — refreshed on demand
    accessTokenExpiresAt: text('access_token_expires_at'),
    refreshToken: text('refresh_token').notNull(), // encrypted
    grantedScope: text('granted_scope').notNull(),
    // 'connected' | 'disconnected' — flips to disconnected on a dead
    // refresh token, detected reactively on the next send attempt
    status: text('status').notNull().default('connected'),
    disconnectedAt: text('disconnected_at'),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [index('idx_email_oauth_connections_org').on(t.orgId)]
)

// Raw-inbound persistence + idempotency + conversation-threading spine for the
// email channel. rfc_message_id is the RFC 5322 Message-ID header — NOT the
// provider's API id — because that's what a customer's reply carries in its
// In-Reply-To/References headers; storing both directions here is what lets a
// reply to an AI answer land on the same ticket instead of spawning a new one.
export const emailMessages = pgTable(
  'email_messages',
  {
    id: serial('id').primaryKey(),
    orgId: integer('org_id').notNull().references(() => orgs.id),
    direction: text('direction').notNull(), // 'in' | 'out'
    rfcMessageId: text('rfc_message_id').notNull(),
    // Resend's own internal id for outbound sends — delivery-status webhooks
    // (bounced/complained/delivery_delayed) reference this, not our RFC id.
    providerMessageId: text('provider_message_id').unique(),
    inReplyTo: text('in_reply_to'),
    references: text('references'),
    ticketId: integer('ticket_id').references(() => tickets.id, { onDelete: 'set null' }),
    fromAddr: text('from_addr'),
    toAddr: text('to_addr'),
    subject: text('subject'),
    spamVerdict: text('spam_verdict'),
    // 'received' | 'processed' | 'rejected_spam' | 'rejected_loop' |
    // 'rejected_filter' | 'sent' | 'bounced' | 'delivery_failed'
    status: text('status').notNull().default('received'),
    rawPayload: jsonb('raw_payload'),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('email_messages_org_rfc_message_unique').on(t.orgId, t.rfcMessageId),
    index('idx_email_messages_org').on(t.orgId),
    index('idx_email_messages_ticket').on(t.ticketId),
    index('idx_email_messages_in_reply_to').on(t.inReplyTo),
  ]
)

export const invitations = pgTable(
  'invitations',
  {
    id: serial('id').primaryKey(),
    orgId: integer('org_id').notNull().references(() => orgs.id),
    email: text('email').notNull(),
    role: text('role').notNull().default('member'),
    token: text('token').notNull().unique(),
    invitedBy: integer('invited_by').references(() => users.id),
    expiresAt: text('expires_at').notNull(),
    acceptedAt: text('accepted_at'),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [
    index('idx_invitations_token').on(t.token),
    index('idx_invitations_org').on(t.orgId),
  ]
)

export const aiConfigs = pgTable('ai_configs', {
  id: serial('id').primaryKey(),
  orgId: integer('org_id').notNull().unique().references(() => orgs.id),
  chatProvider: text('chat_provider').notNull().default('openai'),
  chatModel: text('chat_model').notNull().default('gpt-4o'),
  chatApiKey: text('chat_api_key'),
  chatBaseUrl: text('chat_base_url'),
  embeddingProvider: text('embedding_provider').notNull().default('openai'),
  embeddingModel: text('embedding_model').notNull().default('text-embedding-3-small'),
  embeddingApiKey: text('embedding_api_key'),
  embeddingBaseUrl: text('embedding_base_url'),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
})

export const subscriptions = pgTable('subscriptions', {
  id: serial('id').primaryKey(),
  orgId: integer('org_id').notNull().unique().references(() => orgs.id),
  planId: text('plan_id').notNull(),
  status: text('status').notNull().default('active'),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id').unique(),
  stripePriceId: text('stripe_price_id'),
  currentPeriodStart: text('current_period_start'),
  currentPeriodEnd: text('current_period_end'),
  cancelAtPeriodEnd: integer('cancel_at_period_end').notNull().default(0),
  trialEndsAt: text('trial_ends_at'),
  // Stripe event.created (unix seconds) of the last webhook event applied to
  // this row — lets the webhook handler reject an out-of-order delivery
  // (e.g. a stale 'active' update arriving after a newer cancellation)
  // instead of blindly overwriting newer state with older state.
  lastEventCreated: integer('last_event_created'),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
})

// Included platform AI usage on a paid plan, per workspace per UTC calendar
// month ('YYYY-MM'), in micro-dollars. One upsert per metered call; see
// recordSpend in lib/billing/platform-ai-budget.ts.
export const platformAiUsage = pgTable(
  'platform_ai_usage',
  {
    orgId: integer('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    period: text('period').notNull(),
    chatSpendMicros: bigint('chat_spend_micros', { mode: 'number' }).notNull().default(0),
    embeddingSpendMicros: bigint('embedding_spend_micros', { mode: 'number' }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.period] })],
)

// Dedup table for Stripe webhook deliveries — Stripe does not guarantee
// exactly-once delivery (retries on any non-2xx, or on timeout even after
// we've already applied the event). Our upserts are individually idempotent,
// but this avoids redundant processing and noisy logs on legitimate retries.
export const webhookEvents = pgTable('webhook_events', {
  eventId: text('event_id').primaryKey(),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().default(now),
})

export const widgetLeads = pgTable(
  'widget_leads',
  {
    id: serial('id').primaryKey(),
    orgId: integer('org_id').notNull().references(() => orgs.id),
    widgetToken: text('widget_token').notNull(),
    email: text('email').notNull(),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [
    index('idx_widget_leads_org').on(t.orgId),
    index('idx_widget_leads_email').on(t.email),
    // saveWidgetLead relies on onConflictDoNothing to dedupe. Without a unique
    // constraint there was nothing for it to conflict on — the only unique
    // column was the serial PK, which never collides — so the dedupe silently
    // did nothing and the same address could be inserted without limit from a
    // public endpoint. Scoped per org, since the same person may legitimately
    // be a lead for two different customers.
    uniqueIndex('widget_leads_org_email').on(t.orgId, t.email),
  ]
)

export const csatMessages = pgTable('csat_messages', {
  messageId: text('message_id').primaryKey(),
  ticketId: integer('ticket_id').notNull().references(() => tickets.id),
  createdAt: text('created_at').notNull().default(now),
})

export const csatRatings = pgTable(
  'csat_ratings',
  {
    id: serial('id').primaryKey(),
    ticketId: integer('ticket_id').notNull().references(() => tickets.id),
    orgId: integer('org_id').notNull().references(() => orgs.id),
    rating: smallint('rating').notNull(),
    platform: text('platform').notNull(),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [
    index('idx_csat_ratings_org').on(t.orgId),
    index('idx_csat_ratings_ticket').on(t.ticketId),
  ]
)

// Blog newsletter signups. The product previously also had a `waitlist` table
// for pre-launch signups (removed along with the early-access gate once the
// product shipped) — kept distinct on purpose while both existed, since a
// waitlist signup meant "let me into the product" and a newsletter signup
// means "email me new posts."
export const newsletterSubscribers = pgTable(
  'newsletter_subscribers',
  {
    id: serial('id').primaryKey(),
    email: text('email').notNull().unique(),
    unsubscribeToken: text('unsubscribe_token').notNull().unique(),
    unsubscribedAt: text('unsubscribed_at'),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [index('idx_newsletter_subscribers_token').on(t.unsubscribeToken)]
)

// In-app product feedback board, shown to every signed-in user in every org by
// the dashboard feedback widget. Moderated: other users only see a row once an
// operator approves it (see migration 0046). org_id is the author's workspace,
// kept for display and audit — never a read filter, the board is shared.
export const productFeedback = pgTable(
  'product_feedback',
  {
    id: serial('id').primaryKey(),
    // NULL org/user only for seeded example rows, which have no real author.
    orgId: integer('org_id').references(() => orgs.id, { onDelete: 'cascade' }),
    userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
    authorLabel: text('author_label'),
    body: text('body').notNull(),
    anonymous: integer('anonymous').notNull().default(0),
    status: text('status').notNull().default('pending'), // 'pending' | 'approved' | 'rejected'
    approvedAt: text('approved_at'),
    replyBody: text('reply_body'),
    replyTag: text('reply_tag'),
    repliedAt: text('replied_at'),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [
    index('idx_product_feedback_status').on(t.status, t.createdAt),
    index('idx_product_feedback_user').on(t.userId),
  ]
)

// Operator-authored "what's new" feed, the widget's Updates tab.
export const productUpdates = pgTable(
  'product_updates',
  {
    id: serial('id').primaryKey(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    publishedAt: text('published_at').notNull().default(now),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [index('idx_product_updates_published').on(t.publishedAt)]
)

// Agent/MCP API keys. Only the SHA-256 hash is stored — the plaintext key is
// shown once at creation time and is not recoverable, same UX precedent as
// the email integration's one-time webhook secret display.
export const apiKeys = pgTable(
  'api_keys',
  {
    id: serial('id').primaryKey(),
    orgId: integer('org_id').notNull().references(() => orgs.id),
    keyHash: text('key_hash').notNull().unique(),
    keyPrefix: text('key_prefix').notNull(),
    name: text('name').notNull(),
    // Least-privilege scopes this key was granted — see lib/agent/scopes.ts.
    // Defaults to the full set so a key created without an explicit choice,
    // and every key predating this column (migration 0038), behaves exactly
    // as before. Validated in application code (normalizeScopes), not by a
    // CHECK constraint.
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`ARRAY['kb:read','faq:read','tickets:read','tickets:write','answers:write']::text[]`),
    createdAt: text('created_at').notNull().default(now),
    lastUsedAt: text('last_used_at'),
    expiresAt: text('expires_at'),
    revokedAt: text('revoked_at'),
  },
  (t) => [
    index('idx_api_keys_org').on(t.orgId),
  ]
)

// One row per generate_answer MCP call. Unlike every other channel, this call
// never creates a ticket/ai_assessments row — without a table of its own,
// the org's monthly deflection usage would never reflect API-originated LLM
// spend. highConfidence mirrors ai_assessments.autoDeflected semantics: only
// high-confidence generations count against the plan's deflection limit,
// same as an auto-answered ticket.
export const apiGenerations = pgTable(
  'api_generations',
  {
    id: serial('id').primaryKey(),
    orgId: integer('org_id').notNull().references(() => orgs.id),
    // Which credential drove the call. Nullable: rows written before per-key
    // attribution existed have no key, and a key can be deleted from under a
    // historical row without losing the usage record.
    keyId: integer('key_id').references(() => apiKeys.id),
    highConfidence: integer('high_confidence').notNull().default(0),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [
    index('idx_api_generations_org').on(t.orgId),
    index('idx_api_generations_key').on(t.keyId),
  ]
)

// Generic per-org flag store — written only by an internal process outside
// this app, read by the main app/bot.
// Exists for manual, per-contract overrides that don't belong in Settings
// (e.g. an enterprise Slack admin requiring outbound-only polling instead of
// the webhook default) — not a general-purpose experiment/rollout system.
// One row per (org, key); value is a plain string so callers decide their
// own encoding ('1'/'0', a plan name, whatever) rather than this table
// enforcing a type.
export const orgFeatureFlags = pgTable(
  'org_feature_flags',
  {
    id: serial('id').primaryKey(),
    orgId: integer('org_id').notNull().references(() => orgs.id),
    key: text('key').notNull(),
    value: text('value').notNull(),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('org_feature_flags_org_key').on(t.orgId, t.key),
    index('idx_org_feature_flags_org').on(t.orgId),
  ]
)

// Shared, cross-instance rate-limit counter (#169). lib/ratelimit.ts's
// original in-process Map only sees the traffic hitting one instance, so
// this table backs a Postgres-atomic-upsert limiter that every instance
// shares — see rateLimitShared in lib/ratelimit.ts.
export const rateLimitBuckets = pgTable('rate_limit_buckets', {
  key: text('key').primaryKey(),
  count: integer('count').notNull().default(1),
  resetAt: timestamp('reset_at', { withTimezone: true }).notNull(),
})

/** The default workspace that owns all data until real auth assigns memberships. */
export const DEFAULT_ORG_ID = 1
