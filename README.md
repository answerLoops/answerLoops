<div align="center">

<img src="./.github/readme/hero.svg" alt="answerLoops — agent-native AI support: faster answers for your community, more time for your team" width="100%" />

<br />

[![CI](https://img.shields.io/github/actions/workflow/status/answerLoops/answerLoops/ci.yml?branch=main&label=CI&logo=github&style=flat-square)](https://github.com/answerLoops/answerLoops/actions/workflows/ci.yml)
[![Security](https://img.shields.io/github/actions/workflow/status/answerLoops/answerLoops/security.yml?branch=main&label=security&logo=github&style=flat-square)](https://github.com/answerLoops/answerLoops/actions/workflows/security.yml)
[![License](https://img.shields.io/github/license/answerLoops/answerLoops?style=flat-square&label=license&color=2563eb)](./LICENSE)
[![npm](https://img.shields.io/npm/v/%40answerloops%2Fagent-sdk?style=flat-square&label=agent-sdk&logo=npm)](https://www.npmjs.com/package/@answerloops/agent-sdk)

[Website](https://answerloops.com) · [Documentation](https://answerloops.com/docs) · [Hosted app](https://app.answerloops.com) · [Agent quickstart](#get-started-with-your-agent) · [Architecture](#how-the-loop-works)

[Agent skills](./skills) · [MCP server](https://answerloops.com/docs/integrations/mcp) · [TypeScript SDK](./packages/agent-sdk)

Using Claude Code? [Onboard your setup](./skills/setup) to self-host answerLoops, then [onboard your agent](./skills/operate) to use it.

</div>

# answerLoops — agent-native AI support for your community

**Help your users get answers faster. Give your team more time to build.**

answerLoops turns your documentation and resolved support questions into answers your community and AI agents can use. Resolve repeat questions in Discord, Slack, GitHub, forums, email, and web chat. Bring your team in when a question needs human judgment, then turn useful resolutions into knowledge for the next person who asks.

**Bring your own agent from day one.** Agent skills guide self-hosted setup and connect your agent to a running workspace. The built-in MCP server lets it search your knowledge base, generate grounded answers, review incoming tickets, and open a ticket when someone needs help. A REST API and TypeScript SDK bring the same capabilities to your own tools.

Built for developer tools, open-source projects, and teams supporting an active community. Use the [hosted app](https://app.answerloops.com), or self-host with Docker and choose your AI provider.

[**Get started with your agent →**](#get-started-with-your-agent) · [**Try the hosted app →**](https://app.answerloops.com) · [**Self-host →**](#run-it-locally)

## What answerLoops helps you do

| Outcome | How it works |
|---|---|
| **Spend less time answering repeat questions** | Ground answers in your docs, published knowledge, resolved tickets, and connected repositories. Enable automatic replies for eligible questions that pass confidence review. |
| **Give your agent useful work immediately** | Install the setup or operation skill, then connect it to your workspace through MCP. Ask it to find answers, summarize open tickets, or create a support ticket. |
| **Keep your team focused on questions that need them** | Review drafts and escalations in one inbox. Bug reports and feature requests stay human-led. |
| **Make each resolution useful again** | Promote resolved tickets into knowledge-base articles. Use knowledge gaps and FAQ digests to decide what to document next. |
| **Support users where they already are** | Bring community conversations into a shared support workflow across chat, forums, GitHub, and email. |
| **Choose how you run support** | Start with the hosted app or run your own stack. Use your preferred AI provider, including local models. |

<div align="center">
  <img src="./.github/readme/dashboard.png" alt="answerLoops dashboard showing answered questions, open tickets, AI drafts, and support activity" width="100%" />
</div>

## Get started with your agent

Choose the path that fits where you are today:

| Starting point | Next step |
|---|---|
| **I want to try answerLoops** | Open the [hosted app](https://app.answerloops.com), complete onboarding, and add your knowledge sources. Then connect your agent below. |
| **I want my agent to help me self-host** | Install `answerloops-setup`. It checks prerequisites, guides configuration, starts Docker Compose, and verifies the health endpoint. |
| **I already have a workspace** | Install `answerloops-operate` to connect your agent through MCP and start using your knowledge and tickets. |

### 1. Install the agent skills

The included skills are packaged for **Claude Code**. From a clone of this repository, copy the skill folders into the project's skills directory:

```bash
git clone https://github.com/answerLoops/answerLoops.git
cd answerLoops
mkdir -p .claude/skills/answerloops-setup .claude/skills/answerloops-operate
cp -R skills/setup/. .claude/skills/answerloops-setup/
cp -R skills/operate/. .claude/skills/answerloops-operate/
```

Already cloned the repository? Run the `mkdir` and `cp` commands from its root. See the [skill source](./skills) and [installation guide](https://answerloops.com/docs/integrations/agent-skills) for details. Other MCP-compatible clients can [connect directly](#connect-through-mcp).

### 2. Ask your agent to help you get running

For a new self-hosted instance:

> Use answerloops-setup to help me run answerLoops locally. Check prerequisites, walk me through the required configuration, start the stack, and verify that it is healthy.

You'll supply your sign-in configuration, database connection, and AI provider settings. The agent helps with the setup steps; you complete account creation and workspace onboarding.

For an existing hosted or self-hosted workspace:

> Use answerloops-operate to help me connect to my answerLoops workspace. Walk me through creating an API key with the permissions I need, configure MCP for my client, and verify the connection with a knowledge-base search.

### 3. Give your agent its first support task

After connecting an AI provider and adding published knowledge, try:

> Search our knowledge base for webhook setup instructions, then generate an answer and report its confidence. If the knowledge doesn't cover the question, tell me what's missing.

Or, for an agent with ticket access:

> Summarize our open, high-priority tickets and group them by category so I can decide what to handle first.

A successful first run returns relevant knowledge or ticket results from your workspace. If a search has no matches, add or publish content that covers the question and try again.

### Connect through MCP

In **Settings → API Keys**, a workspace owner or admin can create a key and choose its permissions. Use the generated configuration in your MCP client. The endpoint is your answerLoops instance URL followed by `/api/mcp`.

| Ask your agent to… | MCP tool | Permission |
|---|---|---|
| Find an existing answer | `search_kb` | `kb:read` |
| Read the latest FAQ digest | `get_faq` | `faq:read` |
| Summarize tickets by status, priority, or category | `get_tickets` | `tickets:read` |
| Open a support ticket | `create_ticket` | `tickets:write` |
| Generate an answer with a confidence score | `generate_answer` | `answers:write` |

`generate_answer` returns an answer without opening a ticket. `create_ticket` sends a question into the shared triage and drafting workflow for your team to review in the dashboard.

[**MCP setup guide →**](https://answerloops.com/docs/integrations/mcp)

## How the loop works

<div align="center">
  <img src="./.github/readme/workflow.svg" alt="Community conversations enter triage and confidence review. Agents use MCP or REST to search knowledge, generate answers, and create tickets. Teams promote useful resolutions into published knowledge for future answers." width="100%" />
</div>

1. **Bring in your knowledge.** Connect documentation, files, and repositories; publish the content you want available for answers.
2. **Answer where the question starts.** Community questions enter triage and drafting. Agents can search knowledge and generate answers directly, or create a ticket when support needs to take over.
3. **Choose when to automate.** Eligible channel replies can post automatically when enabled and when they pass confidence review. Other questions go to your team for review or follow-up.
4. **Build on what you solve.** Promote useful resolved tickets into published articles. Review knowledge gaps and FAQ digests to improve future answers.

For the implementation, see the [shared ingestion pipeline](./lib/ingest/pipeline.ts), [agent operations](./lib/agent/core.ts), and [architecture guide](./ARCHITECTURE.md).

## Support channels and knowledge sources

| Capability | Connect or use |
|---|---|
| **Community support** | Discord, Slack, Discourse, Circle, GitHub Issues and Discussions, Telegram, Google Chat, email, and embeddable web chat |
| **Knowledge sources** | Website documentation, GitHub repositories, Notion, PDF, DOCX, Markdown, text, CSV, and resolved support tickets |
| **Support operations** | Unified inbox, AI drafts, priority and category triage, SLA tracking, human escalation, CSAT, analytics, and knowledge-gap reporting |
| **AI providers** | OpenAI, Anthropic, Google Gemini, Groq, Mistral, Ollama, and OpenAI-compatible endpoints |
| **Agent access** | Setup and operation skills, MCP tools, REST API, OpenAPI schema, and TypeScript SDK |

[Explore the documentation →](https://answerloops.com/docs)

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

### Run the published image

The published image runs the app and channel listener without a local build. First download the Compose file:

```bash
curl -fsSLO https://raw.githubusercontent.com/answerLoops/answerLoops/main/docker-compose.ghcr.yml
```

Create a `.env` alongside it using the [self-hosting configuration guide](https://answerloops.com/docs/quickstart-self-host). Configure your PostgreSQL connection, app URL, generated secrets, Google OAuth sign-in, and AI provider. Then start the services:

```bash
docker compose -f docker-compose.ghcr.yml up -d
```

Images support `amd64` and `arm64`.

`latest` tracks the most recent tagged release. To pin an exact version instead:

```bash
ANSWERLOOPS_IMAGE='ghcr.io/answerloops/answerloops:<release-tag>' \
  docker compose -f docker-compose.ghcr.yml up -d
```

Building from source instead is the path below, and the one to take if you intend to modify the code.

### Build from source

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

Use Node.js 22 (see [`.nvmrc`](./.nvmrc)) and pnpm. Running Postgres in Docker while the app processes run on the host works well:

```bash
docker compose up -d postgres
pnpm install
cp .env.example .env.local
```

Set `DATABASE_URL=<your-local-postgres-connection-string>` and the required values above in `.env.local`. Next.js loads that file for the web app. To run both the web app and listener from the same shell, export it first:

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
lib/agent/           Shared operations behind MCP and REST
lib/mcp/             MCP tool definitions and protocol
packages/agent-sdk/  Typed client for the Agent API
content/docs/        Fumadocs product, integration, and self-hosting docs
skills/              Installable Claude Code skills (self-host setup, agent operation)
drizzle/             Ordered PostgreSQL migrations
tests/unit/          Vitest regression and component tests
e2e/                 Playwright end-to-end coverage
public/widget.js     Embeddable widget loader
```

Production is two processes — `app` and `bot` — built from one multi-stage image, with PostgreSQL behind them. [`ARCHITECTURE.md`](./ARCHITECTURE.md) goes through the pipeline and the data model in detail.

## Build with the APIs

Bring answerLoops knowledge and support into your own application, agent, or automation. Create a workspace API key in **Settings → API Keys**, then choose your interface:

| Interface | Endpoint or package | Best for |
|---|---|---|
| MCP | `POST /api/mcp` | MCP-compatible agents and IDEs |
| REST | `/api/agent/*` | Scripts, services, and custom integrations |
| OpenAPI | `GET /api/agent/openapi.json` | API exploration and client generation |
| TypeScript SDK | `@answerloops/agent-sdk` | Typed Node.js and browser integrations |

MCP and REST expose the same five operations: knowledge search, FAQ lookup, ticket listing, ticket creation, and answer generation. The SDK wraps the REST API.

[Agent API reference](https://answerloops.com/docs/integrations/agent-api) · [SDK installation and usage](./packages/agent-sdk/README.md)

Using Claude Code? [`skills/`](./skills) has an installable skill for self-hosting (`skills/setup`) and one for operating a running workspace over MCP (`skills/operate`) — see the [agent skills guide](https://answerloops.com/docs/integrations/agent-skills).

## Contributing

Help improve community support and agent workflows. Contributions are welcome:

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
