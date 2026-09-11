<div align="center">

<img src="./.github/readme/hero.svg" alt="answerLoops — open-source AI support infrastructure for teams whose support lives in a community" width="100%" />

<br />

[![CI](https://img.shields.io/github/actions/workflow/status/answerLoops/answerLoops/ci.yml?branch=main&label=CI&logo=github&style=flat-square)](https://github.com/answerLoops/answerLoops/actions/workflows/ci.yml)
[![Security](https://img.shields.io/github/actions/workflow/status/answerLoops/answerLoops/security.yml?branch=main&label=security&logo=github&style=flat-square)](https://github.com/answerLoops/answerLoops/actions/workflows/security.yml)
[![License](https://img.shields.io/github/license/answerLoops/answerLoops?style=flat-square&label=license&color=2563eb)](./LICENSE)

[Website](https://answerloops.com) · [Documentation](https://answerloops.com/docs) · [Hosted app](https://app.answerloops.com) · [Quickstart](#run-it-locally) · [Architecture](#how-the-loop-works)

</div>

# answerLoops — AI support that lives in your community

**Scenario: Someone in your community Discord asks how to set up webhooks using YOUR software. That question has already been asked multiple times, but now it can be added to your knowledge source .**

That's the job answerLoops takes off your hands. It sits in the community channels where your users already ask for help — Discord, Slack, your forum, GitHub Issues, email, a chat widget — and answers the questions it's already seen the answer to. Not with a canned macro. The answerLoops agent reads your docs, your resolved tickets, whatever you've fed it, drafts a confident answer, and a second agent checks its own work before it posts. If it's not confident, it doesn't guess — it hands the question to a person with the draft already written, so the human is editing, not starting from a blank reply.

Every question the agent handles is one your team didn't have to. Every one it can't handle yet shows up in a knowledge-gaps list, so you know exactly what to document next to continue filling the documentation gap.

It's for teams whose support already happens in public — a dev tool with a Discord, an open-source project with recurring Issues, a course community, a game studio's player base. If your users type into a chat channel instead of filing a ticket, this is built for that. If you run a help desk, it's not.

Self-hostable — clone it, run `docker compose up`, keep every answer and every byte of data on your own infrastructure. No usage caps, nothing metered, nothing phoning home.

<div align="center">
  <img src="./.github/readme/dashboard.png" alt="answerLoops dashboard showing deflection rate, open tickets, AI drafts, SLA status, and recent support activity" width="100%" />
</div>

## What you get

| | | |
|---|---|---|
| **01** | **A confidence gate** | A second pass decides whether an answer posts or goes to a human. You set the threshold. Bug reports and feature requests always stay human-led. |
| **02** | **One pipeline for every channel** | Discord, Slack, Discourse and Circle forums, GitHub Issues and Discussions, Telegram, email, web chat, and Google Chat all land in the same ticket model, scoped to your org. |
| **03** | **Answers grounded in your content** | Search runs across crawled docs, uploaded files, published KB articles, resolved tickets, and connected GitHub repos. |
| **04** | **Your choice of model** | OpenAI, Anthropic, Google Gemini, Groq, Mistral, Ollama, or any OpenAI-compatible endpoint, on your own key. |
| **05** | **Access for agents** | The same knowledge and workflows are exposed over MCP JSON-RPC and a REST API with an OpenAPI schema. |
| **06** | **You run it** | The app, the listener, and Postgres are yours. Tenant data is scoped by organization and integration credentials are encrypted at rest. |

## How the loop works

<div align="center">
  <img src="./.github/readme/workflow.svg" alt="answerLoops workflow: community channels flow through one ticket model, grounded retrieval, confidence review, and automatic or human resolution before improving reusable knowledge" width="100%" />
</div>

The pipeline lives in [`lib/ingest/pipeline.ts`](./lib/ingest/pipeline.ts). Each channel adapter only handles its own auth, message parsing, and reply delivery. Everything after that — ticket creation, retrieval, drafting, review, analytics, escalation — is the same code regardless of where the question came from.

## What ships in the repository

### Channels and conversations

- Discord text channels, forum threads, reactions, slash commands, and multiple connected servers
- Slack Events API or polling mode, plus in-thread replies
- Discourse and Circle forum ingestion and replies
- Google Chat space pairing and replies
- GitHub Issues, issue comments, Discussions, discussion comments, and repository sync
- Telegram webhook ingestion and replies
- Provider-agnostic inbound email, threaded replies, and Gmail or Outlook send-only OAuth
- Embeddable website chat with lead capture and a published-KB-only retrieval boundary

### Knowledge and automation

- Website crawling, GitHub repository sync, Notion workspace sync, and PDF, DOCX, Markdown, text, or CSV uploads
- Semantic search over KB articles and resolved support history
- AI triage, priority, category, SLA deadlines, grounded drafting, and confidence review
- Configurable auto-deflection, human escalation, CSAT feedback, and simulation mode
- Knowledge-gap reporting and FAQ generation

### Product and platform

- Unified inbox, ticket detail timeline, live updates, analytics, ROI estimates, and CSV exports
- Organizations, roles, invitations, onboarding, per-org API keys, and tenant-isolated data access
- Browser push and email notifications
- Hosted billing support plus a complete self-hosted deployment path
- MCP tools and REST endpoints for KB search, FAQs, tickets, and answer generation

<details>
<summary><strong>See the unified inbox</strong></summary>
<br />
<img src="./.github/readme/tickets.png" alt="Unified answerLoops inbox with support tickets from multiple channels" width="100%" />
</details>

<details>
<summary><strong>See confidence review and escalation</strong></summary>
<br />
<img src="./.github/readme/ticket-detail.png" alt="answerLoops ticket detail with AI confidence review, evidence, and human escalation" width="100%" />
</details>

## Run it locally

Docker Compose is the quickest way to get everything up. It starts the Next.js app, the channel listener, and PostgreSQL, and runs the Drizzle migrations for you.

### Prerequisites

- Docker Engine with Docker Compose
- A Google OAuth client for dashboard sign-in
- An API key for one supported AI provider

### 1. Clone and configure

```bash
git clone https://github.com/answerLoops/answerLoops.git
cd answerLoops
cp .env.example .env
```

Generate independent secrets:

```bash
openssl rand -hex 32 # AUTH_SECRET
openssl rand -hex 32 # ENCRYPTION_KEY
openssl rand -hex 32 # BOT_SECRET
```

Then set at least these values in `.env`:

```dotenv
AUTH_URL=http://localhost:3000
AUTH_SECRET=<your-generated-auth-secret>
ENCRYPTION_KEY=<your-generated-32-byte-hex-key>
BOT_SECRET=<your-generated-bot-secret>

AUTH_GOOGLE_ID=<your-google-oauth-client-id>
AUTH_GOOGLE_SECRET=<your-google-oauth-client-secret>

OPENAI_API_KEY=<your-openai-api-key>
```

Use `http://localhost:3000/api/auth/callback/google` as the Google OAuth redirect URI. The development Compose file supplies the local `DATABASE_URL`; configure a real Postgres URL separately for production.

### 2. Start the stack

```bash
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000), sign in, and complete onboarding. To verify the server independently:

```bash
curl http://localhost:3000/api/health
# {"ok":true}
```

> [!WARNING]
> `docker compose down` stops the stack and preserves your database. Adding `-v` deletes the named Postgres volume and its data.

For deployment, provider-specific setup, and every environment variable, follow the [self-hosting documentation](https://answerloops.com/docs/quickstart-self-host).

## Native development

You'll need Node.js 20.9 or newer and pnpm. Running Postgres in Docker while the app processes run on the host works well:

```bash
docker compose up -d postgres
pnpm install
cp .env.example .env.local
```

Set `DATABASE_URL=postgresql://community:community@localhost:5432/community` and the required values above in `.env.local`. Next.js loads that file for the web app. To run both the web app and listener from the same shell, export it first:

```bash
set -a
source .env.local
set +a
pnpm dev:all
```

The main development commands are:

| Command | Purpose |
|---|---|
| `pnpm dev` | Start the Next.js development server |
| `pnpm bot` | Start the Discord/Slack listener in watch mode |
| `pnpm dev:all` | Run the app and listener together |
| `pnpm lint` | Run Oxlint |
| `pnpm test` | Run the Vitest unit and integration suite |
| `pnpm test:e2e` | Run Playwright end-to-end tests |
| `pnpm test:e2e:typecheck` | Type-check the Playwright suite |
| `pnpm build` | Create the production Next.js build |

## Repository map

```text
app/                 Next.js pages, server actions, webhooks, REST, and MCP
bot/                 Discord gateway and Slack polling listener
components/          Dashboard, onboarding, marketing, and widget UI
lib/ai/              Retrieval, agents, embeddings, triage, and review
lib/ingest/          Shared multi-channel support pipeline
lib/db/              Drizzle schema, migrations, and org-scoped queries
content/docs/        Fumadocs product, integration, and self-hosting docs
drizzle/             Ordered PostgreSQL migrations
tests/unit/          Vitest regression and component tests
e2e/                 Playwright end-to-end coverage
public/widget.js     Embeddable widget loader
```

Production is two processes — `app` and `bot` — built from one multi-stage image, with PostgreSQL behind them. [`ARCHITECTURE.md`](./ARCHITECTURE.md) goes through the pipeline and the data model in detail.

## Build with the APIs

Create an organization API key in **Settings → API Keys**, then use either surface:

| Surface | Endpoint | Best for |
|---|---|---|
| MCP | `POST /api/mcp` | Claude, Cursor, and other MCP-compatible agents |
| REST | `/api/agent/*` | Services, scripts, and custom integrations |
| OpenAPI | `GET /api/agent/openapi.json` | Typed clients and API exploration |

Both cover knowledge-base search, FAQ lookup, listing and creating tickets, and generating a grounded answer. See the [MCP guide](https://answerloops.com/docs/integrations/mcp) or the [Agent API reference](https://answerloops.com/docs/integrations/agent-api).

## Contributing

We're getting the project ready for a wider release. Contributions are welcome. A few things to know first:

1. Open or link an issue so we agree on the behavior before you build it.
2. Every data-access path has to scope by organization. Don't merge one that doesn't.
3. Behavior changes need test coverage.
4. Run `pnpm lint`, `pnpm test`, and `pnpm build` before you push.
5. If you change product behavior, architecture, setup, or an integration, update the matching page under `content/docs/`.

Found a security issue? Follow [`SECURITY.md`](./SECURITY.md). Don't open a public issue for it.

## License

[AGPL-3.0](./LICENSE). Read it, change it, run it yourself. If you run a modified version as a network service, the AGPL says you have to make your source available to its users.

<div align="center">

[Docs](https://answerloops.com/docs) · [Run it locally](#run-it-locally) · [Open an issue](https://github.com/answerLoops/answerLoops/issues)

</div>
