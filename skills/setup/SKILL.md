---
name: answerloops-setup
description: Sets up a self-hosted answerLoops instance with Docker Compose — checks prerequisites, walks .env configuration, starts the published image, and confirms it's healthy. Use when the user wants to self-host answerLoops, run it locally with Docker, or asks to deploy their own instance.
license: See the answerLoops repository LICENSE (AGPL-3.0).
---

# answerLoops self-host setup

Gets a self-hosted answerLoops instance running via the published Docker
image (`docker-compose.ghcr.yml`) — no build step. Full reference docs live
at `content/docs/quickstart-self-host.mdx` and `content/docs/self-hosting/`
in the [answerLoops repo](https://github.com/answerLoops/answerLoops); this
skill automates the mechanical parts and defers to those docs for anything
this file doesn't cover.

## What this skill does and doesn't do

Does: prerequisite checks, cloning, `.env` scaffolding, running Docker
Compose, and confirming the app is actually healthy before declaring success.

Does not: create OAuth apps, generate AI provider keys, or invent any secret
value. Every credential in `.env` either comes from a command you ran
(`openssl rand -hex 32`) or from the user pasting a real value they obtained
from an external provider's dashboard. Never write a placeholder that looks
like a real key (no `sk-xxxx...`, no fake-looking hex) — leave the line as
`<paste from provider dashboard>` and tell the user exactly what to go get.

## Steps

### 1. Check prerequisites

Run `skills/setup/scripts/check-prereqs.sh` (or invoke the same checks
inline if the script isn't available in this environment: Node.js 22+,
Docker with Compose v2, pnpm 11+, git, openssl). Stop and report clearly if
anything is missing — don't attempt to install system packages on the user's
machine without asking first.

### 2. Get the repo

If not already in a clone of the answerLoops repo:

```bash
git clone https://github.com/answerLoops/answerLoops.git
cd answerLoops
```

### 3. Scaffold `.env`

Copy `.env.example` to `.env` if `.env` doesn't already exist. Then walk the
user through the **Core (required)** and **OAuth (required)** sections of
`content/docs/self-hosting/environment-variables.mdx`:

- `DATABASE_URL` — ask whether they're bringing their own Postgres (required
  for `docker-compose.ghcr.yml`) or want the bundled dev Postgres
  (`docker-compose.yml` instead, which builds from source — slower first run
  but nothing extra to provision). Confirm the connection string works
  before moving on.
- `AUTH_URL` — the public URL they'll reach the instance at
  (`http://localhost:3000` for local, or their real domain).
- `AUTH_SECRET` and `ENCRYPTION_KEY` — generate each with
  `openssl rand -hex 32`. Run it twice; never reuse one value for both. Warn
  that changing `ENCRYPTION_KEY` after setup makes every stored API key
  unreadable.
- `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` — login is Google OAuth only. Tell
  the user to create an OAuth client in Google Cloud Console and register
  the callback URL `{AUTH_URL}/api/auth/callback/google`. Wait for them to
  paste the real client ID and secret — do not proceed with a placeholder.

Everything else (Discord, Slack, GitHub App, Telegram, email, etc.) is
optional — mention it exists, point at the matching doc page under
`content/docs/self-hosting/`, and let the user decide whether to configure
it now or later. Don't block on optional channels.

### 4. Start the stack

For the published-image path (recommended — no build):

```bash
docker compose -f docker-compose.ghcr.yml up -d
```

For building from source instead (`docker-compose.prod.yml`) or local dev
with a bundled Postgres (`docker-compose.yml`), use that compose file in the
same command instead.

### 5. Confirm it's healthy

Run `skills/setup/scripts/wait-for-health.sh <AUTH_URL>/api/health` (defaults
to `http://localhost:3000/api/health` if no URL is given). This polls until
the app responds or a 120s timeout elapses — migrations run automatically on
first boot, so this can take a little longer than the container start.

If it times out, don't guess — pull logs and show the user the actual
failure:

```bash
docker compose -f docker-compose.ghcr.yml logs app -f
```

Common causes are a bad `DATABASE_URL`, a missing required env var, or a port
already in use on 3000.

### 6. Hand off

Once healthy, tell the user their instance is live at `{AUTH_URL}`, sign in
with Google, and complete the in-app onboarding. Point them at
`skills/operate` if they also want their agent to use the running instance
via MCP.

## Safety notes

- Never run `docker compose down -v` — the `-v` flag deletes the named
  Postgres volume and every article, ticket, and org setting with it. If the
  user asks to "reset" or "start over," confirm they specifically mean
  deleting all data before running anything with `-v`.
- Never commit `.env` — it's already gitignored in this repo; don't override
  that.
- If a secret scanner or manual read turns up a real-looking credential
  already sitting in a tracked file, stop and flag it — don't silently
  overwrite or ignore it.
