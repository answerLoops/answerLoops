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
| MCP / Agent API | AI agents (Claude, Cursor, custom bots) call the platform as a tool via `POST /api/mcp` (JSON-RPC) or `/api/v1/agent/*` (REST) |

---

## 4. Data model (Postgres, via Drizzle ORM)

Schema: `lib/db/schema.ts`. Migrations: hand-authored SQL in `drizzle/`, applied idempotently on every boot (`lib/db/migrate.ts`).

| Table | Purpose |
|-------|---------|
| `orgs`, `users`, `memberships` | multi-tenant org/user/role structure |
| `tickets`, `ticket_replies`, `ticket_events` | one row per community question; the conversation after it (staff replies, customer follow-ups, replies answerLoops posted via `recordAnswerLoopsReply` — the agent's channel posts in `lib/ai/agent.ts` and approved/edited drafts in `lib/actions/tickets.ts` — and maintainer context, each tagged with its author role `staff`/`customer`/`context`/`ai` and the channel's message id; an `ai` row's id also lets a reply to the bot's message find the ticket); audit log |
| `ticket_embeddings`, `ticket_links` | semantic vector per ticket + nearest-neighbour graph |
| `ai_assessments` | confidence grade per drafted answer |
| `kb_articles`, `kb_sources` | knowledge base Q&A articles + their source documents/URLs. An "exact duplicate" is the same `contentHash` (`lib/kb/revision.ts`: question and answer, line endings and whitespace collapsed). File uploads and URL imports (`createArticleFromSourceWithinCap`, checked again under the per-org lock) and hand-added articles (`createArticle(..., rejectExactDuplicate)`) refuse one via `findExactDuplicate` (`lib/db/queries/kb-duplicates.ts`: SQL narrows by the whitespace-collapsed question, the hash decides); synced sources are not checked. `searchArticles` over-fetches 3x and `dropExactDuplicates` (`lib/kb/duplicates.ts`) keeps the best-ranked copy, so every retrieval path (widget, tickets, Discord, Agent API) is given each exact article once; the ticket Sources panel folds copies the same way (`collapseExactSources`) |
| `kb_article_events` | append-only article history: created, promoted, edited, verified, review decisions (hash of content, never the text) |
| `kb_answers` | one row per generated answer: id (made once per generation, so a repeated callback records once), channel, outcome, time, and for the ticket surface an opaque `ticket_id` (migration 0063, cleared if the ticket is deleted; checked to belong to the workspace) so the ticket page can show the sources; no question or answer text, no visitor; 90-day retention swept by the bot. Written best-effort by `recordAnswerSources` (`lib/kb/usage.ts`), beside `countArticleUsage`, from the widget reply (`app/api/widget/chat/route.ts`, on finish and on a failed stream), Discord `/ask` (`app/api/slash/ask/route.ts`), `generate_answer` for the Agent API and MCP (`lib/agent/core.ts`) and ticket drafts (`lib/ai/agent.ts`); bug and feature-request tickets, searches and simulations record nothing. Read by owners and admins only: the ticket page's Sources panel (`getAnswerSourcesForTicket`, loaded server-side only for owner/admin viewers; each source is current, changed since, unpublished or deleted, judged from the stored content hash) and `GET /api/kb/articles/[id]/answers` (`getArticleAnswerView`; 403 for members) |
| *(no table yet)* source support, `lib/kb/support/` | The deterministic layer of source support (#437): it assesses nothing and stores nothing yet. `segmentAnswer` and `segmentArticle` split text into numbered claims and passages (rule-based, no locale data, so ids and offsets never change for the same text); `buildSnapshot` freezes the question, claims and each supplied article's passages and `contentHash`; `validateJudgeOutput` accepts only ids and the labels `supports`/`partial`/`contradicts`/`none` (any extra field, unknown id or duplicate rejects the whole output) and copies every quote from the snapshot by id; `deriveArticleSupport` and `deriveAnswerSupport` turn that into one state each (`supporting`, `no_support`, `inconclusive`, `not_assessed`) with failures only moving downward; `transition` is the execution-state table; `reconcilePairs` and `reconcileAnswers` count a population and throw unless the buckets sum to the supplied total. `assessSupport` (`lib/kb/support/assess.ts`) runs one assessment from a snapshot with an injected judge and embedding function: `buildJudgePrompt` (`prompt.ts`) shows the judge only the snapshot between data markers it cannot break out of; one judge call covers every supplied article; the result is validated, then each `supports` must also clear a cosine-similarity floor between the claim and the cited passage (`similarity.ts`; a support is lowered to `inconclusive` below the floor, and all support is lowered if embeddings are unavailable); it never throws and ends as `completed`, `failed` (`timeout`/`provider_error`/`no_result`) or `skipped`. `SUPPORT_METHOD` (`method.ts`) versions the whole method, and a test pins the prompt and schema so a change forces a bump; the floor is provisional (`floorCalibrated: false`) until `pnpm support:eval` has been run on the real models. The live model and embedding calls are in `lib/ai/support-judge.ts` (the judge is the fast model with no tools or memory, via `chatModel`, so on included usage it is metered like any other call) and `embedTexts` in `lib/ai/embed.ts`. `evaluateDataset` (`eval.ts`) measures the method against `tests/fixtures/source-support/dataset.json`, a hand-written, human-labeled dataset (marked unreviewed until a person checks it). Nothing outside the module and `scripts/support-eval.ts` imports it yet. |
| `kb_answer_references` | the articles supplied to each answer: rank, retrieval score, and a content hash of the article at that moment; `article_id` is nulled when the article is deleted and the hash stays |
| `integrations` | per-org, per-platform connection config (Discord/Slack/Telegram/Email) |
| `discord_guilds` | one row per Discord server an org has connected — an org can connect more than one |
| `github_repos` | connected repos for source-code search + KB sync |
| `api_keys` | org-scoped Bearer tokens for MCP/Agent API |
| `subscriptions` | Stripe billing state |
| `product_feedback`, `product_updates` | in-app feedback board and "what's new" feed behind the dashboard widget; global (not tenant-scoped for reads); only used where `FEEDBACK_WIDGET_ENABLED=true`; moderation, replies and updates are handled by operator tooling outside this app |

Every tenant-data query requires an explicit `org_id` — there is no silent default-org fallback. Bot tokens and AI provider keys are encrypted at rest (AES-256-GCM).

---

## 5. Web app surface

- **Auth** — Auth.js v5, Google OAuth. `auth.ts`'s `PUBLIC_PATHS` allowlist gates which routes skip session auth (self-authenticating webhooks, public marketing pages); everything else requires a session and is scoped to the caller's org. A URL that matches no website, platform, API, widget or public route gets a real 404 from the same gate rather than the sign-in redirect (`lib/marketing/known-routes.ts`); every route folder under `app/` must be classified, and `tests/unit/route-classification.test.ts` enforces it.
- **Dashboard** — live overview, tickets (list + detail with AI draft/confidence/related questions/SLA), knowledge base, analytics, FAQ auto-generation, simulation/dry-run mode, team management, billing, settings (channel integrations, AI model config, widget embed).
- **Feedback widget** — `components/feedback/feedback-widget.tsx`, mounted in the dashboard layout so it appears in every org, but only where `FEEDBACK_WIDGET_ENABLED=true` (the answerLoops-operated deployment; off by default, so a self-hosted deployment never renders it or serves its routes). A collapsed pill (logo + live approved-feedback count, plus a dot when there is an unseen update) expands into a Feedback tab (moderated board + composer) and an Updates tab. Members can only submit (`lib/actions/product-feedback.ts`: org membership required, rate-limited); the app has no moderation or posting surface. Per-viewer snapshot from `GET /api/product-feedback` (approved rows for everyone, plus the caller's own pending rows; never author identity). Live: triggers on `product_feedback`/`product_updates` fire `pg_notify('product_feedback_changed')`, `/api/events/stream` LISTENs and forwards a payload-less `feedback_changed` to *every* stream (unlike the org-filtered `data_changed`), and the widget refetches via the shared `lib/live-events` connection — so a row written by out-of-app operator tooling reaches open dashboards with no call back into the app. The widget collects no usage data: the only thing it sends is feedback a member chooses to submit, and the only thing it keeps about a visit is the last update id seen, in that browser's local storage. First-visit seed quote is inserted at boot only when enabled.
- **Marketing site** — landing page, `/pricing`, comparison pages, docs links — all pre-auth, public.
- **Docs site** — Fumadocs under `app/docs`, reachable on every deployment (it is deliberately not behind the marketing gate). The layout renders per request (`export const dynamic = 'force-dynamic'`) because the Changelog link at the foot of the sidebar (`components/docs/docs-sidebar-footer.tsx`, also shown in the mobile drawer) follows `DEPLOYMENT_MODE`, which is only known at request time; its address comes from `resolveChangelogUrl()` in `lib/marketing/changelog-link.ts`, which the dashboard sidebar's "What's new" also uses, and is left out on a self-hosted install, which serves no `/changelog`. The `Cache-Control` rule for `/docs/:path*` in `next.config.ts` still applies to these responses, so the shared cache serves most hits. `tests/unit/docs-layout-changelog.test.tsx` pins the per-request behavior.
- **Blog** — `content/blog/**/*.mdx`, a second Fumadocs collection alongside the docs one (`source.config.ts`'s `blog` export, loaded via `lib/blog/source.ts`/`lib/blog/posts.ts`). Flat under `/blog/<slug>` regardless of topic (thought leadership, an integration writeup, a comparison) — `category` in frontmatter groups posts on the index page instead of the URL. Rendered through the marketing site's own layout (`MarketingPage`/`PageHero`), not the docs sidebar shell. A post's cover image is either supplied in frontmatter or generated on request from its title+category by `app/blog/[slug]/opengraph-image.tsx`, so publishing a new SEO post never blocks on producing an image. A post can also set `canonicalUrl` in frontmatter to point its `<link rel="canonical">` at another URL — syndicated content, or a near-duplicate of one of our own posts — instead of the self-canonical every other page gets by default (`lib/marketing/metadata.ts`'s `publicPageMetadata`). Listed in `app/sitemap.ts` dynamically (new posts need no code change) and intentionally left out of `public/llms.txt`'s curated links (only `/blog` itself is listed there; individual posts are unbounded).

---

## 6. External dependencies

| Service | Used for | Required? |
|---|---|---|
| AI provider (per org) | triage, answer drafting, confidence grading, widget chat | at least one, env fallback or per-org key |
| Postgres (managed, with pgvector) | all persistent state | yes |
| Discord / Slack / GitHub / Telegram / Resend (email) | ingest channels | each optional, configured per org |
| Stripe | billing, subscription management | for hosted plans |
| Firecrawl | crawl a public docs URL into the KB | optional |

---

## 7. Deployment

- Multi-stage `Dockerfile` (deps → build → runner, no build toolchain in the final image), non-root user.
- Two services: **app** (dashboard + API, `pnpm start`) and **bot** (Discord gateway listener + background sweeps, `pnpm bot:start`). The bot also runs the maintenance sweeps — org purge, stuck-ticket recovery, and the **KB sync worker**, which claims rows from `kb_sync_jobs` and drives each one by calling `POST /api/kb/sync-jobs/run` on the app with `BOT_SECRET`. Notion/GitHub KB syncs are enqueued (by "Sync now" and the GitHub push webhook) rather than run inline in those requests. The worker is NOTIFY-driven, not polling: a `kb_sync_jobs` trigger fires `pg_notify('kb_sync_job_queued', id)` on every enqueue and requeue, delivered over the bot's existing single-connection LISTEN socket (the same one used for `config_changed`/`member_joined`/`data_changed`); a coarse 5-minute sweep remains only as a safety net for a missed notification or a stuck `running` row. An unconditional short-interval poll here previously kept the database compute from ever autosuspending.
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
