# Release-Notes — builder-facing release notes for every release

Invoke with `/project:release-notes [vX.Y.Z]` when cutting a release. With no argument, it prepares notes for the next release: everything merged to `main` since the latest `v*` tag.

Release notes are a **public surface**. Every rule in `AGENTS.md` about public surfaces applies — the security-disclosure rule above all.

The audience is **builders**: people self-hosting answerLoops, writing against the Agent API / MCP server / agent SDK, or building integrations. They want to know what changed, whether it breaks them, and what they must do. They do not want a changelog of commit subjects.

---

## Hard rules

1. **Security: say a fix shipped, nothing more.** One line: "This release includes security fixes." No CVE/GHSA ids, package names or versions, attack descriptions, impact or reachability analysis, and no "not yet fixed" items. Dependency bumps that exist only for security go under that line, not in Fixes. If a PR title or body contains security detail, do not copy it.
2. **No internal workspace names.** Never mention the internal planning/ops workspace, its pages, ids, or "Known Issue N" numbering. Reference GitHub PRs/issues by number only.
3. **No AI attribution** anywhere in the notes.
4. **No backend vendor names** unless the builder must configure that vendor directly (e.g. an AI provider key setting). Describe the capability and the action instead.
5. **Brand spelling:** `answerLoops` in prose; leave code identifiers and the GitHub org as they are.
6. **Capability copy follows `AGENTS.md`:** pre-sold capabilities (Discourse, Circle, Notion KB, Enterprise features) are written in present tense per the project rule — don't add "coming soon" caveats, and don't invent availability for anything else.
7. **No secret-looking placeholders** in examples. Use `<your-api-key>` style descriptors.
8. **Never publish without the user's explicit go-ahead.** Show the draft, then stop and ask.

---

## Orchestrator steps

### Step 1 — find the range

```bash
git fetch --tags
PREV=$(git tag --list 'v*' --sort=-v:refname | head -1)   # skip agent-sdk-v* tags
git log "$PREV"..origin/main --format='%h %s'
gh pr list --state merged --base main --search "merged:>=$(git log -1 --format=%cs "$PREV")" \
  --json number,title,author,labels,body,mergedAt --limit 200
```

If the user passed a version, use it as the title; otherwise propose the next semver (breaking → minor while `0.x`, features → minor, fixes only → patch) and say why.

### Step 2 — read the changes, not just the titles

For every merged PR in range, read the body and, where the title is vague, the diff stat (`gh pr diff <n> --name-only`). Classify what a *builder* would notice:

- **Breaking changes / migrations** — schema migrations, renamed or removed env vars, changed Agent API / MCP / SDK contracts, changed Docker/compose topology. These go first and say exactly what the builder must do.
- **New** — features and integrations, with where to configure them and the docs page.
- **Improved** — behavior or performance changes visible to users or operators.
- **Fixed** — bugs, described by the symptom a builder would have seen ("articles imported from a URL vanished on reload"), then the one-line cause if it helps. Not the commit subject.
- **Agent SDK** — any change under the SDK package, with its `agent-sdk-v*` version if it shipped one.
- **Docs** — only new pages builders should know about.
- **Security** — the single sentence from rule 1.

Drop pure internal noise: test-only, CI tweaks, refactors with no behavior change, dependabot bumps with no security relevance (collapse to one "Dependency updates" line if desired).

### Step 3 — new env vars and migrations

Grep the range for builder-action items and list each explicitly:

```bash
git diff "$PREV"..origin/main -- .env.example docker-compose*.yml 'drizzle/**' 'migrations/**' 2>/dev/null
```

Each new/changed env var: name, purpose, whether required, default. Each migration: that it runs automatically (or what to run). Never print real values.

### Step 4 — contributors

Build the list from PR authors, excluding bots. Identify **new contributors** — authors with no merged PR before `$PREV`:

```bash
gh api "repos/answerLoops/answerLoops/releases/generate-notes" -f tag_name=<next-tag> -f previous_tag_name="$PREV" --jq .body
```

Copy GitHub's own `## New Contributors` and `**Full Changelog**` sections from that output so the format stays what GitHub renders and links. **Remove every bot** from the copied text — any handle ending in `[bot]` or `app/…` (dependabot, github-actions, etc.). Bots never appear in Contributors, New Contributors, or thank-you lines. If no human new contributors remain, omit the section.

### Step 4b — thank people

Credit each PR with `by @handle (#number)`. Thank new contributors by handle in the New Contributors section.

### Step 5 — write the draft

Use this layout. Omit any section that is empty. Keep each bullet to one or two plain sentences.

```markdown
## vX.Y.Z

<One or two sentences: the headline of this release for builders.>

### ⚠️ Breaking changes & upgrade steps
- <what changed> — <what to do>. (#123)

### New
- **<Feature>** — <what it does, where to configure it>. [Docs](https://answerloops.com/docs/...) (#123)

### Improved
- <change and the benefit>. (#123)

### Fixed
- <symptom builders saw>, now <behavior>. (#123)

### Agent SDK
- <change>. Published as `agent-sdk-vX.Y.Z`. (#123)

### Configuration changes
| Variable | Required | Purpose |
|---|---|---|
| `NAME` | yes/no | what it does |

### Security
This release includes security fixes.

### Contributors
Thanks to @a, @b.

## New Contributors
<verbatim from GitHub>

**Full Changelog**: <verbatim from GitHub>
```

Docs links must use `https://answerloops.com/docs/...` and point at pages that actually exist under `content/docs/`. Verify each one.

### Step 6 — self-check, then show the user

Before showing the draft, re-read it against the Hard rules and grep it:

```bash
grep -niE 'CVE-|GHSA-|vulnerab|exploit|attack|notion|roadmap|known issue|claude|co-authored' <draft-file>
```

Any hit means rewrite that line. Then run the disclosure gate if available: `node scripts/check-disclosure.mjs <draft-file>`.

Save the draft to the scratchpad directory (not the repo), print it, and **stop and ask** whether to publish.

### Step 7 — publish (only after explicit approval)

```bash
gh release create vX.Y.Z --target main --title "vX.Y.Z" --notes-file <draft-file>   # new release
gh release edit   vX.Y.Z --notes-file <draft-file>                                   # existing tag
```

Publishing a release triggers the image publish workflow, so confirm the version and target commit with the user in the same approval. Report the release URL afterwards.

---

## When this applies

Every release. If a release is being cut by pushing a tag or clicking "Create release" in the UI without this skill, run it with the tag name first and paste the result into the release body.
