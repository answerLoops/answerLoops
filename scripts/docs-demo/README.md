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

## Screenshots

`pnpm docs:shots` drives the real app (steps 1 to 4 above must be done and the
app running) and writes one image per entry in `shots.manifest.ts`, plus a
machine-readable list of annotated regions for the docs components.

```bash
pnpm docs:shots                          # every shot
pnpm docs:shots dashboard billing        # only these ids
pnpm docs:shots --preview                # also write pin overlays to scripts/docs-demo/.tmp/pins/
```

Set `DOCS_BASE_URL=<app-url>` if the app is not on `http://localhost:3112`.

What it does: opens Chrome (`channel: 'chrome'`, falling back to the default
chromium if Chrome is not installed) with the saved storage state, light colour
scheme, reduced motion and a 2x device scale factor; hides the Next.js dev
indicator, toasts and the floating feedback button; waits for network idle and
each `waitFor` selector; then screenshots. It fails loudly on a redirect to
`/login`, a 404 or other HTTP error, console errors, loading skeletons still on
screen, a pin selector that matches nothing visible, and any unsafe content
(see the masking rule). A shot is retried once, because the dev server compiles
a route on first visit.

Outputs, both meant to be committed:

- `public/docs/shots/<id>.webp`, at most 1600px wide, quality stepped down until
  it is under about 250 KB. Encoding uses `sharp`, which ships with Next.js and is
  resolved from there; it is not a direct dependency.
- `lib/docs/shots.generated.json`, keys sorted by id:

```json
{
  "<id>": {
    "src": "/docs/shots/<id>.webp",
    "width": 1600,
    "height": 1000,
    "alt": "<alt text>",
    "pins": [
      { "id": "<pin-id>", "label": "<pin label>", "x": 21.6, "y": 29.7, "w": 75.5, "h": 8 }
    ]
  }
}
```

`x`, `y`, `w`, `h` are percentages (one decimal) of the image width and height;
`x` and `y` are the top-left corner. Pins are the bounding boxes of each pin's
selector, relative to the captured area and clamped to it. Running a single id
updates only that entry.

### Adding a shot

Append an object to `SHOTS` in `shots.manifest.ts`:

- `id` (kebab-case, becomes the file name), `route`, `alt`.
- `viewport` (default 1440x900). The app scrolls inside `<main>`, so full-page
  capture does not apply: raise the viewport height to include more of a long
  page, or use `capture: { type: 'element' | 'clip', ... }` to crop.
- `waitFor`: selectors that must be visible before capture.
- `actions` (keep these minimal): `click`, `fill`, `scrollTo`, `waitFor`.
- `pins`: the 3 to 6 most important regions, each `{ id, selector, label }`.
  Selectors are Playwright selectors (CSS, `text=`, `:has-text()`,
  `>> xpath=ancestor::div[2]`). Run with `--preview` and look at the overlay
  image to confirm each box covers the region you meant.
- `mask` / `textMask` if anything on screen needs hiding (below).

Then run `pnpm docs:shots <id> --preview` and open the output image. Check for
empty states, error banners, loading skeletons, cut-off text and odd dates
before committing.

### Masking rule

Seeded integration credentials are random, so their last four characters, the
Circle setup value, the widget embed token and API key prefixes must never reach
an image. `DEFAULT_TEXT_MASKS` rewrites those patterns on every shot, whether or
not they are on screen. Per shot, `mask` replaces or blurs elements by selector
and `textMask` rewrites extra text. After masking, the script scans the page and
refuses to capture if it still finds a masked-token tail, a long hex value, an
API key prefix, a token-shaped string or any email address that is not on
`example.com` or `example.org`. Crop shots so they do not include the legacy
manual-setup block on the Integrations page.

`scripts/docs-demo/.tmp/` holds the session cookie and the pin previews. It is
gitignored; never commit it.

## Routes

`/dashboard`, `/tickets`, `/tickets/<number>`, `/kb` (Manage, Knowledge
coverage and Review tabs), `/knowledge-gaps`, `/analytics` (includes CSAT),
`/faq`, `/leads`, `/integrations?tab=<discord|slack|telegram|discourse|circle|email|github|notion>`,
`/settings?tab=<general|team|ai|widget|api-keys>`, `/billing`, `/simulation`.

The product feedback board is a widget (bottom right of every page), not a route.

## Cleanup

```bash
docker rm -f docs-demo-pg
```
