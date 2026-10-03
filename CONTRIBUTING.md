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
the behavior before you spend time building it.

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
Gemini, Groq, Mistral, or an OpenAI-compatible endpoint).

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
| `pnpm build` | Create the production Next.js build |

Full setup detail, every env var, and deployment options are in the
[self-hosting documentation](https://answerloops.com/docs/quickstart-self-host).

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
