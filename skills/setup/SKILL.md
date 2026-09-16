---
name: answerloops-setup
description: Sets up a self-hosted answerLoops instance with Docker Compose — checks prerequisites, walks .env configuration, starts the published image, and confirms it's healthy. Use when the user wants to self-host answerLoops, run it locally with Docker, or asks to deploy their own instance.
license: See the answerLoops repository LICENSE (AGPL-3.0).
---

# answerLoops self-host setup

Gets a self-hosted answerLoops instance running via the published Docker
image — no build step. The mechanical work (prereq checks, cloning,
`.env` scaffolding, starting the stack, health polling) is done by the
`answerloops` CLI, shipped as the bin of the
[`@answerloops/agent-sdk`](https://www.npmjs.com/package/@answerloops/agent-sdk)
npm package — this skill drives it and handles the parts a CLI can't:
collecting real credentials from you and deciding what's worth setting up
now versus later. Full reference docs live at
`content/docs/quickstart-self-host.mdx` and `content/docs/self-hosting/` in
the [answerLoops repo](https://github.com/answerLoops/answerLoops).

## What this skill does and doesn't do

Does: run `npx @answerloops/agent-sdk setup` (prereq checks, cloning,
`.env` scaffolding, starting Docker Compose, confirming health), walking you
through anything it reports missing.

Does not: create OAuth apps, generate AI provider keys, or invent any secret
value. `AUTH_SECRET` and `ENCRYPTION_KEY` are safe to generate — the CLI does
this itself with real randomness. Everything else in `.env`
(`DATABASE_URL`, `AUTH_URL`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`) comes
from you, a real value obtained from an external provider's dashboard.
Never write a placeholder that looks like a real key (no `sk-xxxx...`, no
fake-looking hex) — if the CLI reports one of these missing, collect the
real value from the user and add it to `.env` yourself, then re-run.

## Steps

### 1. Run the setup command

```bash
npx @answerloops/agent-sdk setup
```

This clones the repo (if not already in a checkout), checks Docker + git
are present, generates `AUTH_SECRET`/`ENCRYPTION_KEY` if absent, and either:

- starts the stack and polls until `/api/health` responds — success, or
- exits with a clear list of missing required config (`DATABASE_URL`,
  `AUTH_URL`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`) and exactly what each
  one is.

### 2. Fill in whatever it reports missing

For each variable the CLI names:

- `DATABASE_URL` — ask whether the user is bringing their own Postgres
  (required for this path) or wants a bundled dev Postgres instead (that's
  `docker-compose.yml`, which builds from source rather than using this
  CLI's published-image path — point them at
  `content/docs/self-hosting/docker.mdx` if they want that instead).
  Confirm the connection string actually works.
- `AUTH_URL` — the public URL they'll reach the instance at
  (`http://localhost:3000` for local, or their real domain).
- `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` — login is Google OAuth only. Tell
  the user to create an OAuth client in Google Cloud Console and register
  the callback URL `{AUTH_URL}/api/auth/callback/google`. Wait for them to
  paste the real client ID and secret — do not proceed with a placeholder.

Add each real value to the `.env` the CLI created (in the cloned repo
directory), then re-run `npx @answerloops/agent-sdk setup` from that
directory — it picks up what's already there and only asks about what's
still missing.

Everything else (Discord, Slack, GitHub App, Telegram, email, etc.) is
optional — mention it exists, point at the matching doc page under
`content/docs/self-hosting/`, and let the user decide whether to configure
it now or later. Don't block on optional channels.

### 3. If it times out waiting for health

Don't guess — pull logs and show the user the actual failure:

```bash
docker compose -f docker-compose.ghcr.yml logs app -f
```

Common causes are a bad `DATABASE_URL`, a missing required env var, or a
port already in use on 3000.

### 4. Hand off

Once healthy, tell the user their instance is live at `{AUTH_URL}`, sign in
with Google, and complete the in-app onboarding. If they also want their
agent to use the running instance via MCP, either run
`npx @answerloops/agent-sdk skills answerloops-operate` or point them at
`skills/operate`.

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
