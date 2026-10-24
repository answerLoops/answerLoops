# Update-LLMs-Txt — keep public/llms.txt in sync with the code and docs

Invoke with `/project:update-llms-txt` on any branch whose diff could change what `public/llms.txt` says. That file is a hand-curated, machine-readable summary for AI agents and LLM crawlers (the [llms.txt convention](https://llmstxt.org/) — unrelated to `robots.txt`, which controls crawler *access*). It is deliberately shorter and more opinionated than a docs dump, so it is edited, not generated wholesale. This skill reads the PR diff and makes the edits; the CI check (`pnpm llms:check`) proves they were made.

---

## What triggers this skill

Run it when the diff touches any of:

- `content/docs/**` — a new, removed or materially changed page
- `app/sitemap.ts` — public marketing routes
- `lib/billing/plans.ts` — prices, answer allowances, overage rate, trial length, annual discount
- `app/(marketing)/**` or other marketing copy that states what the product does or costs
- A channel, integration, MCP tool or Agent API endpoint being added, removed or renamed
- The public docs base URL, marketing URL, repo URL, or MCP/Agent API paths

Skip it for typo or wording fixes and troubleshooting additions that change neither what the product does nor where things live. If the check passes and the prose still reads true, say so and stop — no no-op commit.

---

## Orchestrator steps

### Step 1 — read the diff, then llms.txt

```bash
git diff main...HEAD --stat
git diff main...HEAD -- content/docs app/sitemap.ts lib/billing app/api
```

Then read `public/llms.txt` in full. For each changed fact in the diff, find every place `llms.txt` states it. One change often lands in several sections (a new channel appears in the intro, Core capabilities, all three FAQ answers and Integrations).

### Step 2 — regenerate the generated blocks

```bash
pnpm llms:sync
```

This rewrites the two blocks between the `BEGIN/END GENERATED` markers (public links from `app/sitemap.ts`, integrations from `content/docs/integrations/meta.json`). Never edit inside those markers by hand.

A new integration page has to be classified in `scripts/sync-llms-txt.mjs`: add it to `INTEGRATION_ORDER` and `INTEGRATION_LABELS` if it is a channel questions arrive from, or to `NON_CHANNEL_INTEGRATION_PAGES` if it is configuration (AI-provider keys, Stripe, the Notion knowledge source). Until it is classified the check fails on purpose.

### Step 3 — edit the hand-written sections

Make the smallest edit that makes each claim true again. Do not regenerate the narrative ("What it does", "Who it is for") unless the product's positioning actually changed.

- **Pricing** — must agree with `lib/billing/plans.ts`: monthly price, included answers, overage rate, annual total, monthly equivalent, trial length.
- **Core capabilities / Connected channels** — must name every channel in the "Ingest channels" table of `content/docs/introduction.mdx`.
- **Frequently asked** — the channel lists repeated in the answers.
- **Agent onboarding** — MCP tool names, endpoint paths, skill names.
- **Links** — only `https://answerloops.com/...`, never `docs.answerloops.com` (not provisioned, see PR #251) and never a stale repo owner/name.

Follow the capability-copy rule in `AGENTS.md`: an owner-sanctioned pre-build capability is written in the present tense, with no "coming soon" hedging.

### Step 4 — verify

```bash
pnpm llms:check
pnpm test
```

`llms:check` fails with one line per mismatch. It checks that the generated blocks are fresh, prices and allowances match `plans.ts`, every channel in the docs table is named, every integration page is classified, and every `https://answerloops.com/...` link resolves to a docs page, app route or public file. It cannot judge whether prose is still accurate, so re-read the sections you did not edit against the diff before moving on.

### Step 5 — show the diff and stop

Show `git diff public/llms.txt scripts/sync-llms-txt.mjs` and wait for approval before committing, per the global commit rule.

```bash
git add public/llms.txt scripts/sync-llms-txt.mjs
git commit -m "docs: sync llms.txt with <what changed>

<one sentence on what was stale and why it matters for crawlers citing this file as a source>"
```

---

## Why CI only checks

CI runs `pnpm llms:check` on every pull request as the "Check llms.txt freshness" job. It reports; it does not edit. Rewriting prose is a judgement call, and `main` is protected (pull request plus required checks, enforced on admins), so a bot cannot push a fix-up commit there. The fix always happens on the branch, here, before merge.
