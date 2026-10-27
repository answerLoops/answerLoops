# Contributing to answerLoops

Thanks for considering a contribution. We welcome all skill levels and all kinds of
contributions — code, docs, and blog posts alike. If you can write a sentence, fix
a bug, or add a feature, there's a way to help.

- **Docs** — fix something unclear, add a missing integration page, improve a
  setup guide.
- **Blog** — write about how you're using answerLoops, a channel integration
  walkthrough, or something you learned self-hosting it.
- **Source code** — bug fixes, features, tests, performance, anything in the
  app, bot, or packages.

Open or link an issue first for anything beyond a small fix, so we can agree on
the behavior before you spend time building it. Use the
[issue forms](https://github.com/answerLoops/answerLoops/issues/new/choose) for
bugs, feature requests, new integrations, and docs fixes. Issues are labeled
`frontend` or `backend`, so you can filter for the part of the stack you want to
work on.

## Ground rules

- Scope every data-access path by organization and cover behavior changes with
  tests.
- Run `pnpm lint`, `pnpm test`, and `pnpm build` before pushing.
- Update the matching page under `content/docs/` when changing product
  behavior, architecture, setup, or an integration.
- Report security issues privately through [SECURITY.md](./SECURITY.md) —
  never in a public issue or PR.

## Run it locally

Prerequisites: Docker Engine with Compose, a Google OAuth client for sign-in,
and an API key for one supported AI provider (OpenAI, Anthropic, Google
Gemini, Groq, Mistral, or an OpenAI-compatible endpoint). You only need that
key to run the app against a real model. The test suites need none; see
[Testing AI behavior](#testing-ai-behavior).

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

Set at least these values in `.env`:

```dotenv
AUTH_URL=http://localhost:3000
AUTH_SECRET=<your-generated-auth-secret>
ENCRYPTION_KEY=<your-generated-32-byte-hex-key>
BOT_SECRET=<your-generated-bot-secret>

AUTH_GOOGLE_ID=<your-google-oauth-client-id>
AUTH_GOOGLE_SECRET=<your-google-oauth-client-secret>

OPENAI_API_KEY=<your-openai-api-key>
```

Use `http://localhost:3000/api/auth/callback/google` as the Google OAuth
redirect URI.

### 2. Start the stack

```bash
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000), sign in, and complete
onboarding. Verify the server independently:

```bash
curl http://localhost:3000/api/health
# {"ok":true}
```

> [!WARNING]
> `docker compose down` stops the stack and preserves your database. Adding
> `-v` deletes the named Postgres volume and its data.

### Or run natively

Use Node.js 22 (see [`.nvmrc`](./.nvmrc)) and pnpm. Run Postgres in Docker
while the app and bot run on the host:

```bash
docker compose up -d postgres
pnpm install
cp .env.example .env.local
```

Set `DATABASE_URL=<your-local-postgres-connection-string>` and the other
values above in `.env.local`. Then run both the app and listener together:

```bash
set -a
source .env.local
set +a
pnpm dev:all
```

Main commands:

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

Full setup detail, every env var, and deployment options are in the
[self-hosting documentation](https://answerloops.com/docs/quickstart-self-host).

### Repository map

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

Production is two processes, `app` and `bot`, built from one multi-stage image
with PostgreSQL behind them. [`ARCHITECTURE.md`](./ARCHITECTURE.md) goes through
the pipeline and the data model in detail.

### How the backend fits together

Every channel (Discord, Slack, GitHub, email, the website widget, MCP and REST)
feeds one pipeline, `processCommunityMessage` in `lib/ingest/pipeline.ts`. It
validates and dedupes the message, creates a ticket, triages it (category,
severity, priority) and sets SLA deadlines, embeds it and finds related tickets
and articles, drafts an answer grounded in that knowledge (`lib/ai/agent.ts`),
and has a second AI pass grade the draft (`lib/ai/assess.ts`).

If auto-reply is on, the grade is at or above the confidence threshold (0.8 by
default), and the question was fully answered, the answer posts automatically.
Otherwise it goes to the human review queue with the draft attached.

If an AI step fails, the ticket is still created and goes to the human queue.
A failed AI step must never drop a question or post an answer on its own. Data
lives in PostgreSQL through Drizzle (`lib/db/schema.ts`), and every query is
scoped by organization.

## Contributing to docs

Docs live under `content/docs/` and build with Fumadocs. Match the structure
in `content/docs/meta.json` and the existing page style — plain language, a
working example over a description of one. If you're documenting a new
integration or capability, add it to the right `meta.json` so it shows up in
navigation.

## Contributing to the blog

Posts live under `content/blog/` as `.mdx` files. Look at an existing post
(e.g. `content/blog/dual-agent-review.mdx`) for frontmatter shape and tone —
practical, specific, written for someone actually running the thing. Include
a cover image if you have one; ask in your PR if you need help generating one.

## Contributing code

- Keep changes scoped — a bug fix doesn't need a refactor riding along.
- Add or update tests under `tests/unit/` or `e2e/` for behavior you change.
- Follow the repository map in the [README](./README.md#for-developers) to
  find where a change belongs (`app/`, `bot/`, `lib/`, `components/`,
  `packages/agent-sdk/`).
- Changing something under `lib/ai/`? See
  [Testing AI behavior](#testing-ai-behavior) for how to fake the model.

## Testing AI behavior

None of the test suites call a real provider, so `pnpm test` and
`pnpm test:e2e` need no AI key. There are three ways to fake the AI. Pick the
cheapest one that exercises what you changed. The
[self-hosting FAQ](https://answerloops.com/docs/self-hosting/faq) has the short
version, including how to run the app itself without a key.

| Fake | Use it when | Example |
|---|---|---|
| Replace the function, e.g. `vi.mock('@/lib/ai/assess')` | You're testing the code around the AI: routing, thresholds, billing | `tests/unit/kb-answer-capture-core.test.ts` |
| Replace the agent library the app calls | You want the real `lib/ai/triage.ts` and `lib/ai/assess.ts` to run on a result you choose | `tests/unit/ai-empty-structured-output.test.ts`, `tests/unit/generate-answer-empty-assessment.test.ts` |
| [AIMock](https://github.com/CopilotKit/aimock) over HTTP | You need the real request, the wire, and the reply parsing and validation | `tests/unit/ai-provider-replies.aimock.test.ts` |

### AIMock in a test

AIMock is a dev dependency that behaves like an OpenAI-compatible server. Start
it inside the test, so there is nothing to run by hand:

```ts
import { LLMock } from '@copilotkit/aimock'

const h = vi.hoisted(() => ({ baseUrl: '' }))

// Point the workspace's AI config at the mock instead of a provider.
vi.mock('@/lib/db/queries/ai-config', () => ({
  getOrgAIConfig: async () => ({
    chat_provider: 'openai-compatible',
    chat_api_key: null,
    chat_base_url: h.baseUrl,
    chat_model: 'mock-model',
    embedding_provider: 'openai-compatible',
    embedding_api_key: null,
    embedding_base_url: h.baseUrl,
    embedding_model: 'mock-embedding',
  }),
}))

let mock: LLMock

beforeAll(async () => {
  // Local URLs are only reachable on self-hosted installs.
  vi.stubEnv('DEPLOYMENT_MODE', 'self-hosted')

  mock = new LLMock({ port: 0 }) // a free port, inside this process
  mock.on({ userMessage: 'CASE_OK' }, { content: '{"confidence":0.9,"answered_fully":true,"reasoning":"r"}' })
  mock.on({ userMessage: 'CASE_EMPTY' }, { content: '' })
  mock.on({ userMessage: 'CASE_MALFORMED' }, { content: '{}' }, { chaos: { malformedRate: 1 } })

  h.baseUrl = `${await mock.start()}/v1`
})

afterAll(async () => {
  await mock.stop()
  vi.unstubAllEnvs()
})
```

Put the tag in the text you pass to the function, for example
`assessAnswer('CASE_EMPTY how do I reset?', 'Open settings.', 1)`. AIMock
answers with the fixture whose `userMessage` appears in the prompt. Its
[docs](https://aimock.copilotkit.dev) list every fixture option.

Things to know:

- **Reply shape.** Triage must reply with JSON holding `category`,
  `severity_score`, `summary`, `suggested_priority` and `reasoning`. Grading
  must reply with `confidence` (0 to 1), `answered_fully` (a boolean) and
  `reasoning`. The schemas sit at the top of `lib/ai/triage.ts` and
  `lib/ai/assess.ts`.
- **Embeddings.** Knowledge-base vectors are 1536 numbers long (the column is
  `vector(1536)`), so a shorter fake vector fails on insert.
- **Outages are slow.** A 500, a 429 or a dropped connection is retried with
  backoff, which takes about 6 seconds per case. Keep those out of the default
  suite or accept the delay.

### End-to-end mock mode

`pnpm test:e2e` runs the production build with `MOCK_EXTERNALS=1` (set in
`playwright.config.ts`). That swaps the AI, Discord, email and web-crawl
services for deterministic in-process fakes (`lib/mock-mode.ts`,
`lib/ai/mock.ts`). In an e2e message, `[[needhuman]]` forces the
low-confidence, human-review path and `[[urgent]]` forces critical severity.
Mock mode is for test suites: a production process refuses to start with it
set.

## FAQ

<details>
<summary><strong>Do I need an AI API key to run the tests?</strong></summary>

No. `pnpm test` and `pnpm test:e2e` never call a real provider. The end-to-end
suite needs a local Postgres. The one from `docker compose up -d postgres`
works, and the `community_test` database is created for you.

</details>

<details>
<summary><strong>How do I test code that calls an AI provider without an API key?</strong></summary>

Fake the AI at the level you are testing, using the table in
[Testing AI behavior](#testing-ai-behavior). A rule of thumb: if the AI's
answer is an input to your code, replace the function. If the format of the
AI's reply is what you are testing, use AIMock.

</details>

<details>
<summary><strong>How do I make the fake AI return a specific result?</strong></summary>

- **Replace the function.** Mock every export the code under test imports from
  that module, as `tests/unit/kb-answer-capture-core.test.ts` does:

  ```ts
  vi.doMock('@/lib/ai/assess', () => ({
    assessAnswer: async () => ({ confidence: 0.9, answered_fully: true, reasoning: 'ok' }),
    shouldAutoDeflect: () => true,
  }))
  ```

- **Use AIMock.** Add a fixture whose `userMessage` appears in the prompt:

  ```ts
  mock.on({ userMessage: 'CASE_79' }, { content: '{"confidence":0.79,"answered_fully":true,"reasoning":"r"}' })
  ```

- **In an e2e test,** put `[[needhuman]]` or `[[urgent]]` in the message. Those
  are the only two steering markers.

</details>

<details>
<summary><strong>How do I test what happens when the AI fails?</strong></summary>

For a rejected call, make the fake throw, for example
`assessAnswer: async () => { throw new Error('boom') }`. For an empty,
malformed, or out-of-range reply, add an AIMock fixture. See
`tests/unit/ai-provider-replies.aimock.test.ts`.

The rule your test should hold to: a failed AI step never drops a question and
never posts an answer on its own. The ticket is still created and goes to the
human queue. Provider outages (a 500 or a 429) are retried with backoff, about 6
seconds per case, so keep them out of the fast suite.

</details>

<details>
<summary><strong>Can I run the app itself without an API key?</strong></summary>

Yes, with a local model that speaks the OpenAI API, such as Ollama or LM
Studio. Open **Settings → AI Model**, choose **OpenAI-compatible**, enter the
base URL (for example `http://localhost:11434/v1`), and leave the key blank. If
the app runs in Docker, `localhost` means the container, so on Docker Desktop
use `host.docker.internal` instead. The
[self-hosting FAQ](https://answerloops.com/docs/self-hosting/faq) has the
details. Do not set `MOCK_EXTERNALS` outside the test suites.

</details>

<details>
<summary><strong>Why are two different things called AIMock?</strong></summary>

`lib/ai/mock.ts` is the project's own set of in-process fake models. Its
comments call it "AIMock". `MOCK_EXTERNALS=1` switches it on, and the e2e suite
uses it. The `@copilotkit/aimock` package is a separate tool that serves an
OpenAI-compatible API over HTTP, and the unit tests use it. To keep them apart,
this guide calls the first one "mock mode" and the second one "AIMock".

</details>

## Submit a pull request

1. Fork the repository and create a branch off `main`:

   ```bash
   git checkout -b fix/short-description
   ```

2. Make your change, then verify it:

   ```bash
   pnpm lint
   pnpm test
   pnpm build
   ```

3. Commit with a clear subject and a body explaining why:

   ```bash
   git add <files>
   git commit -m "fix: short description of what changed

   Explain what was broken or missing and why this is the fix. Include
   root cause for bug fixes, or user value for features."
   ```

4. Push your branch and open the PR:

   ```bash
   git push -u origin fix/short-description
   gh pr create --fill
   ```

   Or push and open the PR from GitHub directly — either way, fill in the
   [PR template](./.github/PULL_REQUEST_TEMPLATE.md) in full: summary, root
   cause or motivation, test plan, and the checklist.

## Request a review

Once your PR is open:

```bash
gh pr ready            # if you opened it as a draft
gh pr edit --add-reviewer <maintainer-github-handle>
```

Or request a review directly from the PR page on GitHub (**Reviewers** panel,
top right). CI runs automatically on push — make sure it's green before
requesting review. A maintainer will take it from there; respond to review
comments on the same branch rather than opening a new PR.

## Code of conduct

Be respectful and assume good faith. Disagreements about implementation are
fine; personal attacks aren't. Report unacceptable behavior through
[SECURITY.md](./SECURITY.md) or by opening an issue.
