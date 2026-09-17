export interface KbSearchResult {
  question: string;
  answer: string;
  score: number;
}

export interface KbSearchResponse {
  results: KbSearchResult[];
}

export type TicketStatus = "open" | "in_progress" | "resolved" | "closed";
export type TicketPriority = "critical" | "high" | "medium" | "low";
export type TicketCategory =
  | "bug"
  | "feature_request"
  | "documentation"
  | "how_to"
  | "general_question";

export interface Ticket {
  id: number;
  content: string;
  category: TicketCategory | null;
  priority: string;
  status: string;
  ai_summary: string | null;
  created_at: string;
}

export interface GetTicketsParams {
  status?: TicketStatus;
  priority?: TicketPriority;
  category?: TicketCategory;
  /** Max results per page, 1-20, defaults to 10 */
  limit?: number;
  /** Opaque value from a previous response's `next_cursor`. Omit for the first page. */
  cursor?: string;
}

export interface GetTicketsResponse {
  tickets: Ticket[];
  /** Pass as `cursor` on the next call to keep paging; null once there's nothing left. */
  next_cursor: string | null;
}

export interface CreateTicketParams {
  /** The user's question or issue, verbatim. Max 4000 characters. */
  content: string;
  /** Name/identifier of the end user this ticket is on behalf of. */
  authorName?: string;
  /** Retrying with the same key returns the original ticket instead of opening a duplicate. */
  idempotencyKey?: string;
}

export interface GenerateAnswerParams {
  /** Max 2000 characters. */
  question: string;
}

export interface GenerateAnswerResponse {
  answer: string;
  confidence: number;
  answered_fully: boolean;
  high_confidence: boolean;
}

export interface SearchKbParams {
  /** Max 2000 characters. */
  query: string;
  /** 1-20, defaults to 5 */
  limit?: number;
}

/**
 * `code` is only ever present on a 429 — it's how a caller tells apart the
 * three independent ceilings this API can hit (rate limit vs. either
 * monthly quota) without pattern-matching `message`. See the `Error` schema
 * in the OpenAPI spec (lib/agent/openapi-spec.ts) for the source of truth.
 */
export type AgentApiErrorCode = "rate_limited" | "deflection_limit_reached" | "call_limit_reached";

/** Shape of the `Error` schema returned on 400/401/403/429 responses. */
export interface AgentApiErrorBody {
  error: {
    message: string;
    code?: AgentApiErrorCode;
  };
}
