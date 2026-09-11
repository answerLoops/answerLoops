# answerLoops — Architecture

> How every piece connects: from a community message to a deflected answer and a self-improving knowledge base.

---

## 1. One-paragraph thesis

A community member asks a question in Discord, Slack, GitHub Issues/Discussions, Telegram, email, the embeddable website widget, or via an AI agent over MCP/REST. The platform ingests it, triages it with AI, embeds it to find prior similar questions, drafts an answer grounded in the team's past answers and (optionally) the project's source code, grades that answer's confidence, and either **auto-answers** the community (high confidence) or **routes it to a human** (low confidence) with the AI's draft attached. Resolved answers feed back into the knowledge base so repeat questions get cheaper and faster over time. Staff manage everything from a multi-tenant, OAuth-gated web dashboard. Every AI call uses the org's own configured provider — OpenAI, Anthropic, Google, Groq, Mistral, or any OpenAI-compatible endpoint (including local models) — the platform has no hardcoded model dependency.

---

## 2. Ingest pipeline (the core flow)

Every channel funnels into the same pipeline (`lib/ingest/pipeline.ts`, `processCommunityMessage`), regardless of source:

| # | Step | Output |
|---|------|--------|
| 1 | **Validate + dedup** | reject already-processed messages |
| 2 | **Triage** | category, severity, priority (fast/cheap model pass) |
| 3 | **SLA deadlines** | response + resolve deadlines set by priority |
| 4 | **Create ticket** | row in `tickets`, notifies staff (in-app + optional email/push) |
| 5 | **Embed** | vector stored for semantic search |
| 6 | **Find related** | prior similar tickets/KB articles surfaced |
| 7 | **Agent answer** | draft grounded in KB + prior answers, optionally + connected GitHub repo source |
| 8 | **Confidence review** | a separate AI pass grades the draft's confidence |
| 9 | **Deflect or route** | confidence above threshold → auto-post; otherwise → human review queue with the draft attached |

If any AI step fails, the ticket still gets created and defaults to the human queue — a pipeline failure never silently drops a question, and never auto-deflects on error.

Each org can bring its own AI provider key (Settings → AI Model); the platform falls back to a shared key if none is configured.

---

## 3. Multi-channel ingest

| Channel | Notes |
|---|---|
| Discord | 1-click OAuth or manual bot token; an org can connect any number of Discord servers |
| Slack | 1-click OAuth or polling mode (no webhook required) |
| GitHub | Issues + Discussions ingested as tickets; answered Discussions also sync into the KB directly |
| Telegram | Webhook-based |
| Email | Zero-setup platform-hosted inbound address by default, or bring-your-own provider |
| Website widget | Embeddable `<script>` chat widget |
| MCP / Agent API | AI agents (Claude, Cursor, custom bots) call the platform as a tool via `POST /api/mcp` (JSON-RPC) or `/api/agent/*` (REST) |

---

## 4. Data model (Postgres, via Drizzle ORM)

Schema: `lib/db/schema.ts`. Migrations: hand-authored SQL in `drizzle/`, applied idempotently on every boot (`lib/db/migrate.ts`).

| Table | Purpose |
|-------|---------|
| `orgs`, `users`, `memberships` | multi-tenant org/user/role structure |
| `tickets`, `ticket_replies`, `ticket_events` | one row per community question, staff replies, audit log |
| `ticket_embeddings`, `ticket_links` | semantic vector per ticket + nearest-neighbour graph |
| `ai_assessments` | confidence grade per drafted answer |
| `kb_articles`, `kb_sources` | knowledge base Q&A articles + their source documents/URLs |
| `integrations` | per-org, per-platform connection config (Discord/Slack/Telegram/Email) |
| `discord_guilds` | one row per Discord server an org has connected — an org can connect more than one |
| `github_repos` | connected repos for source-code search + KB sync |
| `api_keys` | org-scoped Bearer tokens for MCP/Agent API |
| `subscriptions` | Stripe billing state |

Every tenant-data query requires an explicit `org_id` — there is no silent default-org fallback. Bot tokens and AI provider keys are encrypted at rest (AES-256-GCM).

---

## 5. Web app surface

- **Auth** — Auth.js v5, Google OAuth. `auth.ts`'s `PUBLIC_PATHS` allowlist gates which routes skip session auth (self-authenticating webhooks, public marketing pages); everything else requires a session and is scoped to the caller's org.
- **Dashboard** — live overview, tickets (list + detail with AI draft/confidence/related questions/SLA), knowledge base, analytics, FAQ auto-generation, simulation/dry-run mode, team management, billing, settings (channel integrations, AI model config, widget embed).
- **Marketing site** — landing page, `/pricing`, comparison pages, docs links — all pre-auth, public.

---

## 6. External dependencies

| Service | Used for | Required? |
|---|---|---|
| AI provider (per org) | triage, answer drafting, confidence grading, widget chat | at least one, env fallback or per-org key |
| Postgres (Neon in production) | all persistent state | yes |
| Discord / Slack / GitHub / Telegram / Resend (email) | ingest channels | each optional, configured per org |
| Stripe | billing, subscription management | for hosted plans |
| Firecrawl | crawl a public docs URL into the KB | optional |

---

## 7. Deployment

- Multi-stage `Dockerfile` (deps → build → runner, no build toolchain in the final image), non-root user.
- Two services: **app** (dashboard + API, `pnpm start`) and **bot** (Discord gateway listener + background sweeps, `pnpm bot:start`). The bot also runs the maintenance sweeps — org purge, stuck-ticket recovery, and the **KB sync worker**, which claims rows from `kb_sync_jobs` and drives each one by calling `POST /api/kb/sync-jobs/run` on the app with `BOT_SECRET`. Notion/GitHub KB syncs are enqueued (by "Sync now" and the GitHub push webhook) rather than run inline in those requests.
- `docker-compose.prod.yml` (self-hosted, both services from the one image) for production; `docker compose up` (dev target) for local development with a local Postgres.
- Migrations run automatically on startup — no manual migration step.
- The `Dockerfile` / compose files above are the self-hosted path. A PaaS deploy builds from the repo instead — Railway reads `railway.toml` / `railway.bot.toml` and builds each service with Nixpacks. See `docs/self-hosting/` for the full self-host guide.

---

## 8. Security posture

- Every commit is scanned before merge: Trivy (secrets/deps/misconfig), Semgrep (SAST), Zizmor (GitHub Actions workflow audit for script injection/unpinned actions/over-broad permissions).
- Per-org data isolation is enforced at the query layer, with regression tests (`tenant-isolation*.test.ts`, `no-default-org.test.ts`) that fail if an org filter regresses.
- Secrets (bot tokens, AI provider keys) encrypted at rest.

---

For the full self-hosting setup, see `docs/self-hosting/`. For product/integration docs, see `docs/`.
