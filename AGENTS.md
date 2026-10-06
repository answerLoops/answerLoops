<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# No shortcuts

Never cut corners. Implement everything fully and correctly.

- No placeholder implementations, stubs, or half-finished features
- No workarounds when the proper fix exists
- No bypassing safety checks, migration steps, or validation
- No suggesting a "quick fix" instead of the real solution
- If something is hard, do it right anyway

# Capability copy can lead the build

Public surfaces — the marketing site, the Fumadocs pages under `content/docs/`,
`public/llms.txt`, JSON-LD, and route metadata — may name a capability as
available before the code ships, when the product owner has decided to market it
ahead of the build. Discourse, Circle, and the Notion knowledge-base source are
currently in this state.

- Do **not** add "planned", "coming soon", "not yet available", or roadmap
  caveats to these surfaces on your own initiative. Write the capability in the
  present tense alongside the shipped ones. A docs page that walks through the
  setup for an owner-sanctioned pre-build capability is fine.
- The remaining build work stays tracked in the Notion "Market Expansion" plan,
  not in hedged website copy.
- This does not weaken `# No shortcuts`: it governs *copy*, not *implementation*.
  Code is still built fully — never stub the actual integration to match the
  copy.
- If you believe a capability genuinely should not be advertised yet, raise it
  with the owner instead of quietly qualifying the copy.

# Commit message rules

Every commit **must** have a subject line AND a body. No exceptions.

- **Subject line** (≤72 chars): `<type>: <what changed>` — e.g. `fix: await createArticle so articles persist`
- **Body**: explain WHY the change was made and WHAT problem it solves. At least 2–3 sentences. Include the root cause for bug fixes, the user value for features, and any non-obvious context a future reader needs.
- **Never** add `Co-Authored-By`, `Claude`, or any AI attribution trailer.

## Attribution and naming rule — HARD RULE

The agent name must never appear in repository-facing project metadata. Do not
include it in branch names, commit subjects or bodies, PR titles or bodies,
PR comments, issue titles or bodies, release notes, or generated signatures.
Commits and PRs must be authored and signed only as the configured human or
repository identity, with no assistant attribution.

Backend vendor names and implementation details must not appear in
customer-facing UI, public documentation, or pull-request descriptions unless
the customer must configure that vendor directly. Describe the capability and
the customer action instead of exposing the internal provider.

Example:
```
fix: await createArticle so KB URL imports persist

createArticle was called without await in saveChunks(), meaning the DB
write raced with the response. The success count was accurate but the
rows were never committed, causing articles to vanish on page reload.
```

PRs must also have a meaningful description — not "No description provided."

# PR description standard — HARD RULE

Every PR description must be written as if a human engineer who was **not in this conversation** will review it cold.

**Required sections:**

```
## What changed
One paragraph. Plain English. What is different after this PR merges?
No bullet dumps of commit messages. No "implemented the requested changes."

## Why
One paragraph. Root cause for fixes. User value for features. Business
reason for refactors. If the why is obvious (typo fix), one sentence is fine.

## How to test
Numbered steps a reviewer can actually follow. Include any env vars or
setup needed. At minimum: what to run, what to look for, what failure looks like.
```

**Banned phrases** — any PR containing these will be rejected:

- "No description provided"
- "Implemented the requested changes"
- "Updated the code as discussed"
- "See commit messages for details"
- "Various fixes and improvements"
- "As per the conversation"

**Tone:** write like a colleague, not a changelog. Contractions OK. "I fixed" OK. Bullet points OK inside sections. No corporate fluff.

# Fumadocs docs — architectural change rule

Any change to how the system works at a pipeline, infrastructure, or integration level **must** update the relevant Fumadocs `.mdx` page(s) in `content/docs/` in the same PR. This is not optional.

Architectural changes include (but are not limited to):
- New or replaced background jobs, polling loops, listeners, queues
- Changes to how config is loaded, cached, or hot-reloaded
- New DB tables, triggers, or migrations that affect system behavior
- New or changed API contracts between services (bot ↔ app, widget ↔ app)
- Changes to deployment topology (new service, new env var, new container)
- New or changed external service integrations (Discord, Slack, AI providers, etc.)

For each architectural change, identify the affected docs pages from the table above and update them before the PR is opened. If no existing page covers the change, create one.

# Infra-test skill — automated tests on every infrastructure change

On any PR that includes an infrastructure change, run `/project:infra-test` **before** opening the PR.

The skill deploys a subagent to:
1. Identify every changed infra file (DB migrations, bot, API routes, Docker, compose, schema)
2. Write vitest/Playwright tests covering the change — placed in `tests/unit/` or `e2e/`
3. Add a "Tests added" section to the PR body
4. Commit the test files to the branch

The orchestrator (main Claude) then:
- Runs `pnpm test` and verifies all new tests pass
- Reviews that tests would actually catch a regression
- Sends weak tests back to the subagent with specific instructions
- Signs off with an `INFRA-TEST SIGN-OFF` block before the PR is created

**Infrastructure changes** include: DB migrations/triggers, bot changes, new API routes, Docker/compose changes, new env vars, new external service integrations.

# Mobile-check skill — automated responsive audit on every UI change

On any PR that adds or changes UI (`app/**/*.tsx`, `components/**/*.tsx`, `app/globals.css`, or shared layout shells), run `/project:mobile-check` **before** opening the PR.

The skill deploys a subagent to:
1. Audit the diff's changed UI files for mobile-responsive breakage at a 375px viewport (fixed widths, non-wrapping flex rows, un-scrollable tables, nav items hidden with no drawer fallback)
2. If issues are found, deploy a second subagent that fixes them using Tailwind responsive prefixes only — no new dependencies

The orchestrator (main Claude) then:
- Reviews that each flagged issue was actually fixed
- Verifies the changed page in-browser at a 375px viewport (per the UI testing rule above)
- Runs `pnpm build` to confirm no regressions
- Signs off with a `MOBILE-CHECK SIGN-OFF` block before the PR is created

If the diff touches no UI files, skip the skill entirely.

# Component-test skill — automated test coverage on every component logic change

On any PR that adds or meaningfully changes a component with real logic (`useState`, `useEffect`, `useActionState`, event handlers, conditional rendering — not markup-only edits), run `/project:component-test` **before** opening the PR. This is separate from `/project:mobile-check`, which audits and fixes responsiveness but never writes tests, and from `/project:infra-test`, which is scoped to DB/bot/API/Docker changes only — none of the three overlap.

The skill deploys a subagent to:
1. Identify every changed component file that qualifies (has logic, not just styling)
2. Write `@testing-library/react` + `happy-dom` component tests covering that behavior, placed in `tests/unit/*.test.tsx`
3. Add a "Component tests added" section to the PR body
4. Commit the test files to the branch

The orchestrator (main Claude) then:
- Runs `pnpm test` and verifies all new tests pass
- Reviews that tests cover real behavior (state transitions, conditional rendering, event handling), not just static markup
- Sends weak tests back to the subagent with specific instructions
- Signs off with a `COMPONENT-TEST SIGN-OFF` block before the PR is created

If the diff touches no component files with real logic, skip the skill entirely.

Diff mode only ever sees the current PR's changed files, so it can't surface pre-existing gaps (components shipped before this skill existed). Run `/project:component-test --full` periodically — not on every PR — to scan all of `components/**/*.tsx` for logic-bearing files with no matching test and report gaps for triage before backfilling.

# Update-llms-txt skill — keep public/llms.txt in sync with the docs

On any PR that adds/removes a page under `content/docs/integrations/**`, adds/removes a top-level capability in `content/docs/introduction.mdx`'s capability table, or changes the public docs base URL / marketing URL / repo URL / MCP-Agent-API endpoint paths, run `/project:update-llms-txt` **before** opening the PR. `public/llms.txt` is hand-curated (not auto-generated from `content/docs/`), so it silently drifts stale otherwise — a dead link or wrong domain in a file whose whole purpose is being cited by LLM crawlers is worse than not having the file at all.

Skip for wording/typo fixes or troubleshooting-section additions that don't change what the product does or where things live.

# Release-notes skill — builder-facing notes on every release

Before cutting any release (a `v*` tag or a GitHub release), run `/project:release-notes` to draft the notes. Do not use bare auto-generated notes or write them by hand.

The skill reads every merged PR since the previous `v*` tag and writes notes for builders: breaking changes and upgrade steps first, then new features, improvements, fixes described by the symptom builders saw, Agent SDK changes, new env vars and migrations, and contributors. It keeps GitHub's own "New Contributors" and "Full Changelog" sections verbatim.

It follows the security-disclosure rule: a security fix is one sentence ("This release includes security fixes.") and nothing more. It shows the draft and publishes only after the user explicitly approves the release.

Skip for `agent-sdk-v*` tags unless the user asks; those releases are described in the SDK's own changelog entry.

# Subagent concurrency limit

**Maximum 4 subagents running at any given time.** No exceptions.

- If a task requires more than 4 subagents, queue the extras and launch them as slots free up
- Never spawn a 5th subagent while 4 are still running — concurrent conflicts corrupt shared state (git, DB)
- When queuing: finish and verify each batch of ≤4 before spawning the next
- This applies to both Agent tool calls and `/project:infra-test` subagent spawns

# Claude rules check on every PR

Before opening any PR, re-read this file (`AGENTS.md`) and verify all rules are satisfied:

1. Commit has subject + body (no AI attribution)
2. Fumadocs docs updated in `content/docs/` folder for any feature/architecture change
3. `pnpm test` + `pnpm build` both pass
4. PR description passes the "PR description standard" — has What changed / Why / How to test, no banned phrases
5. If infra changed: `/project:infra-test` ran and orchestrator signed off
6. If UI changed: `/project:mobile-check` ran and orchestrator signed off
7. If a component with real logic changed: `/project:component-test` ran and orchestrator signed off
8. If integration pages or top-level capabilities changed in `content/docs/`: `/project:update-llms-txt` ran
9. If cutting a release: `/project:release-notes` ran and the user approved the draft

# Placeholder format — HARD RULE

Never use a placeholder that looks like a real secret. This includes:
- Hex strings (`abcdef1234567890abcdef1234567890`)
- Random-looking alphanumeric strings (`xK9mP2qR7nL4...`)
- Repeated patterns (`sk-xxxxxxxxxxxxxxxxxxxxxxxx`)
- Real-format fakes (`sk-test-...`, `ghp_fakefakefake`)

Always use angle-bracket descriptors instead:
```
API_KEY=<your-api-key>
SLACK_CLIENT_SECRET=<your-client-secret>
DATABASE_URL=<your-postgres-connection-string>
STRIPE_SECRET_KEY=<sk_live_... from Stripe dashboard>
```

This applies to: docs, code comments, example env files, README, test fixtures, and any commit or PR body. If a scanner can't tell it's fake, it's the wrong format.

# Security information disclosure — HARD RULE

**Never publish security detail to any public surface.** This repository is
public. Naming a weakness publicly — especially an unfixed one — hands an
attacker both a starting point and confirmation that the weakness is real.

**Never put any of the following in a commit message, PR title or body, branch
name, GitHub issue or comment, code comment, changelog, docs site, or any other
publicly visible place:**

- Anything still unfixed, unpatched, mitigated-but-open, or accepted as a risk.
  **Never write a "What this does not fix", "Known issues", "Limitations", or
  "Remaining vulnerabilities" section.** This is the most damaging disclosure and
  the easiest to write by accident while being diligent.
- CVE or GHSA identifiers, advisory titles, or affected package names and versions
- How an issue was exploitable, what an attacker could do, or the attack mechanism
- Reachability or impact analysis, including reassuring analysis — "not reachable
  in our deployment" confirms the weakness exists and tells an attacker what to
  probe if the deployment changes
- Which guard mitigates which attack, or the reasoning behind a security decision

**What public surfaces may say:** that a security issue was fixed. Nothing more.
`fix: patch a security issue in dependency handling` is a complete and correct
commit message.

**Where the detail goes:** not here. Report security issues privately through
the process in `SECURITY.md` rather than in a public issue, PR, or commit.

This rule outranks the PR description standard below. If following the "What
changed / Why / How to test" format would require disclosing any of the above,
write less and say the detail is tracked internally.

**Applies retroactively.** If sensitive detail has already been published, treat
it as an incident: sanitize the public surface immediately, and tell the user
what was exposed and for how long.

# Secret violation protocol — HARD RULE

**Never surface credential values.** Do not print, quote, log, summarize, or
otherwise reproduce a detected secret in tool output, commentary, commits, PRs,
issues, or chat responses. Report only the secret type, affected file and line,
and the environment-variable name when that name can be established without
revealing the value. Redact command output at the source whenever a command
could otherwise emit credentials.

If Trivy's secret scanner (or Semgrep, or any other tool) detects a credential, API key, token, or secret in the codebase at any point:

1. **Stop immediately.** Do not continue the current task.
2. **Alert the user** with the exact file, line, and secret type found.
3. **Tell the user to cycle it now** — assume the credential is compromised regardless of whether it was pushed.
4. **Do not commit or push** until the secret is removed from the file AND git history.
5. **If already pushed**, tell the user to rotate the credential immediately before doing anything else, then use `git push --force-with-lease` after cleaning history.

This rule applies even if the secret looks like a placeholder or test value. Err on the side of caution — a rotated credential costs minutes; a leaked one can cost everything.
