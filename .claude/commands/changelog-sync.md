# Changelog-Sync — keep the /changelog page matching GitHub releases

Invoke with `/project:changelog-sync` right after a release is published (the last step of `/project:release-notes`), and any time a published release's notes are edited or a release is deleted or turned into a draft.

`/changelog` on the marketing site mirrors the GitHub releases page. It renders one markdown file per published release from `content/changelog/`. Those files are **generated** by `scripts/sync-changelog.mjs` from the GitHub API — never hand-edit them. To change what the page says, edit the release on GitHub (`gh release edit vX.Y.Z --notes-file <file>`) and run this skill again.

Changelog entries are a **public surface**. Every rule in `AGENTS.md` about public surfaces applies, the security-disclosure rule above all. The release notes were already written under `/project:release-notes`' hard rules; this skill republishes them and must not add detail.

---

## Orchestrator steps

### Step 1 — confirm the release exists on GitHub

The sync reads published releases, so the new one must already be public. A draft is skipped on purpose.

```bash
gh release view vX.Y.Z --json tagName,isDraft,publishedAt,url
```

If it is missing or still a draft, stop and say so — do not work around it.

### Step 2 — start from a fresh branch off `main`

`main` is protected, so the update ships as a PR. If you are not already on a branch cut from current `origin/main` for this purpose:

```bash
git fetch origin
git switch -c chore/changelog-vX.Y.Z origin/main
```

Branch name must not contain any assistant name.

### Step 3 — sync

```bash
GITHUB_TOKEN=$(gh auth token) pnpm changelog:sync
git status --short content/changelog
```

The script prints what it added, updated or removed, then exits. Expect exactly one added file (`content/changelog/vX.Y.Z.md`) for a normal release. Anything else — an unrelated updated or removed file — means an older release was edited or deleted on GitHub since the last sync; confirm that was intended before keeping it.

Then prove it is idempotent and in sync:

```bash
GITHUB_TOKEN=$(gh auth token) pnpm changelog:check
```

### Step 4 — disclosure gate

```bash
node scripts/check-disclosure.mjs content/changelog/vX.Y.Z.md
grep -niE 'CVE-|GHSA-|vulnerab|exploit|attack|notion|roadmap|known issue|claude|co-authored' content/changelog/vX.Y.Z.md
```

Any hit means the release body on GitHub needs rewriting — fix it there with `gh release edit`, re-run Step 3. Do not patch the generated file.

### Step 5 — verify the page

```bash
pnpm test tests/unit/changelog-sync.test.ts tests/unit/auth-public-paths.test.ts
pnpm build
```

Confirm the new entry appears first on `/changelog` (run the app with `DEPLOYMENT_MODE=cloud`, signed out) and carries the **Latest** badge.

### Step 6 — commit and PR (stop and ask first)

Show `git diff --stat` and the new file, then **stop and ask the user to approve the commit**. Commit message needs a subject and a body, for example:

```
chore: add vX.Y.Z to the changelog page

The changelog page mirrors GitHub releases from generated files under
content/changelog. vX.Y.Z was just published, so this adds its entry.
```

Open the PR with the `What changed / Why / How to test` sections from `AGENTS.md`. How to test: open `/changelog` signed out and check the vX.Y.Z entry is first and matches the GitHub release.

---

## When this applies

Every release. It is Step 8 of `/project:release-notes`. If a release was published without it, run this skill with the tag afterwards — the sync is idempotent and picks up any release that is missing.
