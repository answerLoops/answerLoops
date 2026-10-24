# Docs demo workspace

Seeds a local database with a fictional workspace, "Northwind Robotics" (a
hobbyist-robotics SDK community), so documentation screenshots of the real app
never contain customer data or real credentials. Every person, product and
address is invented (`example.com` / `example.org`).

Files:

- `guard.ts`: refuses to run unless the database URL is local (`localhost`,
  `127.0.0.1`, `[::1]`, or the compose service name `postgres`).
- `seed.ts`: runs migrations, then wipes and rewrites only the workspace with
  slug `northwind-demo`. Safe to run repeatedly. Nothing is truncated.
- `session.ts`: mints a session cookie for the demo owner and writes a
  Playwright storage state to `scripts/docs-demo/.tmp/storage-state.json`
  (gitignored).

## 1. Start a throwaway database

```bash
docker run -d --name docs-demo-pg \
  -e POSTGRES_USER=community -e POSTGRES_PASSWORD=community -e POSTGRES_DB=community \
  -p 5545:5432 pgvector/pgvector:pg16
export DATABASE_URL=postgres://community:community@localhost:5545/community
```

## 2. Migrate and seed

```bash
pnpm docs:seed
```

Re-running it resets the demo workspace. The demo users keep their ids, so an
existing storage state stays valid.

## 3. Start the app

Use any local string for the auth secret; the same value is used in step 4.

```bash
export AUTH_SECRET=<any-local-string>
DATABASE_URL=$DATABASE_URL DIRECT_DATABASE_URL=$DATABASE_URL \
AUTH_SECRET=$AUTH_SECRET AUTH_URL=http://localhost:3112 \
DEPLOYMENT_MODE=cloud STRIPE_SECRET_KEY=<any-placeholder> \
PLATFORM_AI_TRIAL_CHAT_BUDGET_USD=5 PLATFORM_AI_TRIAL_EMBEDDING_BUDGET_USD=1 \
PLATFORM_AI_PLAN_CHAT_BUDGET_USD=40 PLATFORM_AI_PLAN_EMBEDDING_BUDGET_USD=8 \
MOCK_EXTERNALS=1 FEEDBACK_WIDGET_ENABLED=1 \
AUTH_GOOGLE_ID=<any-placeholder> AUTH_GOOGLE_SECRET=<any-placeholder> \
pnpm exec next dev --webpack -p 3112
```

What each setting is for:

- `DEPLOYMENT_MODE=cloud` makes the Billing page show the seeded Pro
  subscription and usage. The seeded `subscriptions` row is active, so no
  checkout redirect happens. With `DEPLOYMENT_MODE=self-hosted` (what
  `playwright.config.ts` uses) the access gate is bypassed instead, but the
  Billing page then only says "Self-hosted, no usage limit". Cloud mode needs a
  Stripe key to be set (any non-empty placeholder works because nothing calls
  Stripe) and the four `PLATFORM_AI_*` budgets, otherwise a red "reached this
  month's AI limit" banner appears on every page.
- `MOCK_EXTERNALS=1` swaps AI and chat-platform calls for in-process fakes.
  Under `next dev` it needs no extra flag. If you serve a production build,
  also set `MOCK_EXTERNALS_E2E=1`.
- `FEEDBACK_WIDGET_ENABLED=1` shows the feedback board widget.
- Do not set `ENCRYPTION_KEY`; the seed stores its generated credentials
  unencrypted in that case.

`next dev` may rewrite `AGENTS.md`; run `git checkout AGENTS.md` afterwards.

## 4. Sign in with the storage state

```bash
AUTH_SECRET=<same-value-as-the-app> pnpm docs:session
```

Then point Playwright at it:

```ts
const context = await browser.newContext({
  storageState: 'scripts/docs-demo/.tmp/storage-state.json',
  viewport: { width: 1440, height: 900 },
})
```

Run `pnpm docs:session` again if the owner row is ever removed. The cookie is
valid for seven days and is bound to `localhost`.

## Routes

`/dashboard`, `/tickets`, `/tickets/<number>`, `/kb` (Manage, Knowledge
coverage and Review tabs), `/knowledge-gaps`, `/analytics` (includes CSAT),
`/faq`, `/leads`, `/integrations?tab=<discord|slack|telegram|discourse|circle|email|github|notion>`,
`/settings?tab=<general|team|ai|widget|api-keys>`, `/billing`.

The product feedback board is a widget (bottom right of every page), not a route.

## Cleanup

```bash
docker rm -f docs-demo-pg
```
