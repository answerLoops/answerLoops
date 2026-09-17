import type {
  AgentApiErrorBody,
  CreateTicketParams,
  GenerateAnswerParams,
  GenerateAnswerResponse,
  GetTicketsParams,
  GetTicketsResponse,
  KbSearchResponse,
  SearchKbParams,
  Ticket,
} from "./types.js";

export interface AgentClientOptions {
  /** API key from Settings -> API Keys, `al_live_...`. Shared with the MCP server. */
  apiKey: string;
  /**
   * Base URL of the answerLoops instance. Defaults to the hosted cloud
   * (`https://answerloops.com`). Point this at a self-hosted instance instead.
   */
  baseUrl?: string;
  /** Overrides the global `fetch` — mainly for tests. */
  fetch?: typeof fetch;
}

export class AgentApiError extends Error {
  readonly status: number;
  readonly body: AgentApiErrorBody | undefined;

  constructor(status: number, body: AgentApiErrorBody | undefined, message: string) {
    super(message);
    this.name = "AgentApiError";
    this.status = status;
    this.body = body;
  }
}

const DEFAULT_BASE_URL = "https://answerloops.com";

export class AgentClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AgentClientOptions) {
    if (!options.apiKey) {
      throw new Error("AgentClient requires an apiKey (Settings -> API Keys).");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? fetch;
  }

  /** GET /api/agent/kb/search — requires the `kb:read` scope. */
  searchKb(params: SearchKbParams): Promise<KbSearchResponse> {
    const query = new URLSearchParams({ query: params.query });
    if (params.limit !== undefined) query.set("limit", String(params.limit));
    return this.request("GET", `/api/agent/kb/search?${query}`);
  }

  /** GET /api/agent/faq — requires the `faq:read` scope. */
  getFaq(): Promise<unknown> {
    return this.request("GET", "/api/agent/faq");
  }

  /** GET /api/agent/tickets — requires the `tickets:read` scope. */
  getTickets(params: GetTicketsParams = {}): Promise<GetTicketsResponse> {
    const query = new URLSearchParams();
    if (params.status) query.set("status", params.status);
    if (params.priority) query.set("priority", params.priority);
    if (params.category) query.set("category", params.category);
    if (params.limit !== undefined) query.set("limit", String(params.limit));
    if (params.cursor !== undefined) query.set("cursor", params.cursor);
    const qs = query.toString();
    return this.request("GET", `/api/agent/tickets${qs ? `?${qs}` : ""}`);
  }

  /** POST /api/agent/tickets — requires the `tickets:write` scope. */
  createTicket(params: CreateTicketParams): Promise<Ticket> {
    return this.request("POST", "/api/agent/tickets", {
      content: params.content,
      authorName: params.authorName,
      idempotencyKey: params.idempotencyKey,
    });
  }

  /** POST /api/agent/answers — requires the `answers:write` scope. */
  generateAnswer(params: GenerateAnswerParams): Promise<GenerateAnswerResponse> {
    return this.request("POST", "/api/agent/answers", { question: params.question });
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;

    if (!res.ok) {
      throw new AgentApiError(
        res.status,
        data as AgentApiErrorBody | undefined,
        (data as AgentApiErrorBody | undefined)?.error ?? `Agent API request failed: ${res.status}`,
      );
    }

    return data as T;
  }
}
