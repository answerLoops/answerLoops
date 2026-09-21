export type Priority = 'critical' | 'high' | 'medium' | 'low'
export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed' | 'duplicate'
export type TicketCategory = 'bug' | 'feature_request' | 'documentation' | 'how_to' | 'general_question'
// 'needs_human' is written by lib/ai/agent.ts whenever a draft is held for
// staff approval instead of auto-posted — either because Automatic
// Deflections is off, confidence was below the bar, or no AI provider is
// configured (in which case ai_draft is null). It is by far the most common
// non-deflected outcome, so every consumer of this type must handle it.
export type AIDraftStatus = 'pending' | 'needs_human' | 'posted' | 'approved' | 'overridden'

export type SourcePlatform = 'discord' | 'slack' | 'telegram' | 'email' | 'github' | 'mcp' | 'google_chat' | 'discourse' | 'circle'

export interface Ticket {
  id: number
  org_ticket_number: number
  source_message_id: string | null
  discord_guild_id: string | null
  source_channel_id: string | null
  source_thread_id: string | null
  source_author_id: string | null
  source_author_name: string | null
  discord_deleted_at: string | null
  // Precomputed deep link back to the original message. Set at ingest time
  // for platforms (Slack, Discourse, Circle) where a working URL can't be
  // derived from stored IDs alone at render time — null on platforms whose
  // link is constructed directly (Discord/Telegram/GitHub) or none (email).
  source_url: string | null
  source_platform: SourcePlatform
  content: string
  // AI triage
  category: TicketCategory | null
  severity_score: number | null
  ai_summary: string | null
  ai_suggested_priority: Priority | null
  // AI agent draft
  ai_draft: string | null
  ai_draft_status: AIDraftStatus
  ai_draft_posted_at: string | null
  // Lifecycle
  priority: Priority
  status: TicketStatus
  resolution_notes: string | null
  // SLA
  sla_response_deadline: string | null
  sla_resolve_deadline: string | null
  sla_response_met: 0 | 1 | null
  sla_resolve_met: 0 | 1 | null
  first_response_at: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
}

export interface TicketReply {
  id: number
  ticket_id: number
  staff_name: string
  content: string
  discord_msg_id: string | null
  created_at: string
}

export interface TicketEvent {
  id: number
  ticket_id: number
  event_type: string
  old_value: string | null
  new_value: string | null
  actor: string | null
  created_at: string
}

export interface SLAConfig {
  id: number
  priority: Priority
  response_hours: number
  resolve_hours: number
  updated_at: string
}

export interface FAQSnapshot {
  id: number
  week_start: string
  week_end: string
  content: string
  ticket_count: number
  generated_at: string
}

export interface GitHubRepo {
  id: number
  org_id: number
  installation_id: number
  owner: string
  repo: string
  is_private: 0 | 1
  monitored_events: string
  kb_enabled: 0 | 1
  kb_last_synced: string | null
  kb_chunk_count: number
  auto_deflect_enabled: 0 | 1
  added_at: string
}

export interface Notification {
  id: number
  ticket_id: number | null
  type: 'new_question' | 'sla_breach' | 'ai_draft_ready'
  message: string
  read: 0 | 1
  created_at: string
}

export interface TriageResult {
  category: TicketCategory
  severity_score: number
  summary: string
  suggested_priority: Priority
  reasoning: string
}

export interface AIAssessment {
  ticket_id: number
  confidence: number
  answered_fully: 0 | 1
  auto_deflected: 0 | 1
  reasoning: string | null
  model: string | null
  created_at: string
}

export interface RelatedTicket {
  id: number
  org_ticket_number: number
  summary: string
  category: TicketCategory | null
  status: TicketStatus
  score: number
  created_at: string
}

export interface PriorAnswer {
  summary: string
  answer: string
}

export interface KBArticle {
  id: number
  question: string
  answer: string
  source_ticket_id: number | null
  source_ticket_number: number | null
  source_id: number | null
  source_page: number | null
  published: 0 | 1
  created_at: string
  updated_at: string
}

export interface KBSource {
  id: number
  org_id: number
  filename: string
  file_type: string
  size_bytes: number
  chunk_count: number
  published: 0 | 1
  created_at: string
  updated_at: string
}

/** A connected Notion workspace. Never carries the access token. */
export interface NotionConnection {
  id: number
  org_id: number
  workspace_name: string | null
  kb_source_id: number | null
  kb_last_synced: string | null
  kb_chunk_count: number
  created_at: string
  updated_at: string
}

export interface KBSearchResult extends KBArticle {
  score: number
}

export type FeedbackVote = 'up' | 'down'
export type FeedbackSource = 'discord' | 'slack' | 'staff'

export interface FeedbackSummary {
  up: number
  down: number
  staffVote: FeedbackVote | null
}

export interface TicketFilters {
  status?: TicketStatus
  priority?: Priority
  category?: TicketCategory
}

export interface CreateTicketInput {
  source_message_id?: string
  discord_guild_id?: string
  source_channel_id?: string
  source_thread_id?: string
  source_author_id?: string
  source_author_name?: string
  source_url?: string
  source_platform?: SourcePlatform
  content: string
  category?: TicketCategory
  severity_score?: number
  ai_summary?: string
  ai_suggested_priority?: Priority
  priority: Priority
  sla_response_deadline?: string
  sla_resolve_deadline?: string
}
