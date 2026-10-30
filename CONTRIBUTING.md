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
- Write the product name as `answerLoops` in prose. The rule does not cover
  code identifiers, file and package names, URLs and domains, the GitHub
  organization and repo paths, environment variable names, or the
  `X-AnswerLoops-Token` header, which follow their own conventions.
- Report security issues privately through [SECURITY.md](./SECURITY.md) —
  never in a public issue or PR.

## Run it locally in 3 steps

This gets the dashboard and the bot running on your machine, with a local
database. When you finish, the app is at <http://localhost:3000>.

### Prerequisites

- **Git**, to clone the repository.
- **Docker with Compose**, to run Postgres.
- **Node.js 22 and pnpm 11 or newer**, to run the app and the tests. If you use
  nvm, `nvm use` picks the right Node version from [`.nvmrc`](./.nvmrc). You can
  skip these only if you run everything in Docker (see Step 3).
- **A Google OAuth client**, because Google is the only way to sign in.
  [This guide](https://answerloops.com/docs/self-hosting/oauth) shows how to
  create one.
- **An OpenAI API key**, optional. You only need it to see AI answers. The app
  starts and the tests run without one. To use another provider or a local
  model, see the [self-hosting FAQ](https://answerloops.com/docs/self-hosting/faq).

### Step 1. Clone the app

```bash
git clone https://github.com/answerLoops/answerLoops.git
cd answerLoops
cp .env.example .env
```

The last command copies the example file to `.env`. You fill it in next, and the
app reads it when it starts.

### Step 2. Values

Open `.env` and set these seven values. Each line is `NAME=value`.

| Variable | Value |
|---|---|
| `AUTH_URL` | `http://localhost:3000` |
| `AUTH_SECRET` | A random value. Generate one with `openssl rand -hex 32` |
| `ENCRYPTION_KEY` | A second random value from the same command |
| `BOT_SECRET` | A third random value from the same command |
| `AUTH_GOOGLE_ID` | The client ID from your Google OAuth client |
| `AUTH_GOOGLE_SECRET` | The client secret from the same client |
| `OPENAI_API_KEY` | Your OpenAI key, or leave it empty for now |

Run `openssl rand -hex 32` three times and use a different result each time.
In your Google OAuth client, the redirect URI must be exactly
`http://localhost:3000/api/auth/callback/google`.

### Step 3. Run it

There are two ways to run it. Choose one.

| | Option A: the app on your machine (recommended) | Option B: everything in Docker |
|---|---|---|
| What runs in Docker | Postgres only | Postgres, the app, and the bot |
| What you install | Node.js 22 and pnpm | Nothing beyond Docker |
| Pick it if | You are changing code, docs, or blog posts and running tests | You would rather not install Node.js and pnpm |
| Edits reload | Yes | Yes, the source folder is mounted |

Most contributors should pick **Option A**. The `pnpm test`, `pnpm lint`, and
`pnpm build` commands in this guide run on your machine, and Docker runs
`pnpm install` every time it starts.

Both options start Postgres on port 5432. If Docker says `port is already
allocated`, another Postgres is already running on your machine. Stop it and run
the command again.

### Step 3, Option A: the app on your machine, Postgres in Docker (recommended)

1. Start only the database, in the background:

   ```bash
   docker compose up -d postgres
   ```

2. Add one more line to your `.env`. These are the credentials the compose file
   gives Postgres:

   ```dotenv
   DATABASE_URL=postgres://community:community@localhost:5432/community
   ```

3. Install the packages (the first time, and whenever dependencies change):

   ```bash
   pnpm install
   ```

4. Load `.env` into your terminal, then start the app and the bot together.
   Run both commands in the same terminal:

   ```bash
   set -a; source .env; set +a
   pnpm dev:all
   ```

   `pnpm dev:all` runs `pnpm dev` (the app) and `pnpm bot` (the Discord and Slack
   listener) at the same time. Next.js reads `.env` by itself, but the bot does
   not, which is why you load the file first. If you are only working on the
   dashboard, `pnpm dev` alone is enough.

5. Open <http://localhost:3000>.

To stop, press Ctrl+C. Postgres keeps running until you run `docker compose down`.
Your data is kept.

### Step 3, Option B: everything in Docker

```bash
docker compose up --build
```

This starts Postgres, the app, and the bot, and sets the database address for
you, so you do not set `DATABASE_URL`. The first start takes a while because it
installs packages inside the containers. When it is up, open
<http://localhost:3000>.

To stop everything, press Ctrl+C and run `docker compose down`. That keeps your
data. `docker compose down -v` also deletes the database.

### Step 3, then check that it works

```bash
curl http://localhost:3000/api/health
# {"ok":true}
```

Then open <http://localhost:3000/login> and click the Google button. It says
"Sign up with Google" the first time and "Sign in with Google" after that.
Finish the onboarding. If the page says "Sign-in is not set up on this
deployment", `AUTH_GOOGLE_ID` or `AUTH_GOOGLE_SECRET` is missing from `.env`.
Add them and restart. For anything else, see
[Troubleshooting](https://answerloops.com/docs/self-hosting/troubleshooting).

### Expected behavior

**The bot logs an error and exits.** Without a Discord token, the bot prints
`No Discord token found` and stops. This is expected until you connect Discord
under Settings → Integrations, and it does not affect the app. On the first start
with an empty database, the bot may also log
`relation "integrations" does not exist`. It starts before the app has created
the tables during boot. No action is needed.

### Main commands

| Command | What it does |
|---|---|
| `pnpm dev` | Starts the app (Next.js development server) |
| `pnpm bot` | Starts the Discord and Slack listener in watch mode |
| `pnpm dev:all` | Starts the app and the listener together |
| `pnpm lint` | Runs Oxlint |
| `pnpm test` | Runs the Vitest unit and integration tests |
| `pnpm test:e2e` | Runs the Playwright end-to-end tests |
| `pnpm test:e2e:typecheck` | Type-checks the Playwright tests |
| `pnpm build` | Creates the production Next.js build |

Every environment variable and the deployment options are in the
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

The ticket is created before any AI step runs, so a failed AI step never drops
a question and never posts an answer on its own. A failed assessment routes the
draft to human review. A failed triage stops the rest of that run (no
notification, embedding or draft) and leaves the ticket open and pending. The
bot's background sweep retries it every 5 minutes for up to 24 hours. Data
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
  [Testing AI behavior](#testing-ai-behavior) for how to mock the model.

## Testing AI behavior

None of the test suites call a real provider, so `pnpm test` and
`pnpm test:e2e` need no AI key. There are three ways to mock the AI. Pick the
cheapest one that exercises what you changed. The
[self-hosting FAQ](https://answerloops.com/docs/self-hosting/faq) has the short
version, including how to run the app itself without a key.

| Mock | Use it when | Example |
|---|---|---|
| Replace the function, e.g. `vi.mock('@/lib/ai/assess')` | You're testing the code around the AI: routing, thresholds, billing | `tests/unit/kb-answer-capture-core.test.ts` |
| Replace the agent library the app calls | You want the real `lib/ai/triage.ts` and `lib/ai/assess.ts` to run on a result you choose | `tests/unit/ai-empty-structured-output.test.ts`, `tests/unit/generate-answer-empty-assessment.test.ts` |
| [AIMock](https://github.com/CopilotKit/aimock) over HTTP | You need the real request, the wire, and the reply parsing and validation | `tests/unit/ai-provider-replies.aimock.test.ts` |

A rule of thumb: if the AI's answer is an input to your code, replace the
function. If the format of the AI's reply is what you are testing, use AIMock.

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

### End-to-end mock mode

`pnpm test:e2e` runs the production build with `MOCK_EXTERNALS=1` (set in
`playwright.config.ts`). That swaps the AI, Discord, email and web-crawl
services for deterministic in-process mocks (`lib/mock-mode.ts`,
`lib/ai/mock.ts`). In an e2e message, `[[needhuman]]` forces the
low-confidence, human-review path and `[[urgent]]` forces critical severity.
Mock mode is for test suites: a production process refuses to start with it
set. The suite needs a local Postgres. The one from
`docker compose up -d postgres` works, and the `community_test` database is
created for you.

## FAQ

<details>
<summary><strong>What does the mock have to reply with?</strong></summary>

Triage must reply with JSON holding `category`, `severity_score`, `summary`,
`suggested_priority` and `reasoning`. Grading must reply with `confidence` (0 to
1), `answered_fully` (a boolean) and `reasoning`. The schemas sit at the top of
`lib/ai/triage.ts` and `lib/ai/assess.ts`, and a reply that does not match makes
the step fail.

Embeddings must be 1536 numbers long, because the knowledge-base column is
`vector(1536)`. A shorter mock vector fails on insert.

</details>

<details>
<summary><strong>How do I mock the result of a single AI call?</strong></summary>

Replace the function, and mock every export the code under test imports from
that module, as `tests/unit/kb-answer-capture-core.test.ts` does:

```ts
vi.doMock('@/lib/ai/assess', () => ({
  assessAnswer: async () => ({ confidence: 0.9, answered_fully: true, reasoning: 'ok' }),
  shouldAutoDeflect: () => true,
}))
```

To mock a reply at the HTTP level instead, add another fixture to the AIMock
example above.

</details>

<details>
<summary><strong>What should a test of an AI failure check?</strong></summary>

That a failed AI step never drops a question and never posts an answer on its
own. [How the backend fits together](#how-the-backend-fits-together) describes
what happens to the ticket for each step.

To simulate a failure, make the mock throw, for example
`assessAnswer: async () => { throw new Error('boom') }`. For an empty,
malformed, or out-of-range reply, add an AIMock fixture. See
`tests/unit/ai-provider-replies.aimock.test.ts`.

</details>

<details>
<summary><strong>Why is my test for a provider outage slow?</strong></summary>

A 500, a 429 or a dropped connection is retried with backoff, which takes about
6 seconds per case. Keep those out of the default suite, or accept the delay.

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
