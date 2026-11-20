# Security-Fix — scan, fix, retest, sign off

Invoke with `/project:security-fix` any time a security vuln is found or suspected,
or after fixing a finding to confirm everything is clean.

Orchestrator (main Claude) runs all steps inline — no subagent needed unless fix
scope spans 3+ files.

---

## Step 1 — full scan (all severities)

Run Trivy. Write logs to a private scratch dir, not `/tmp` (scan output can
contain redacted-but-sensitive context):

```bash
SCAN_DIR=$(mktemp -d)

trivy fs \
  --scanners vuln,secret,misconfig \
  --severity CRITICAL,HIGH,MEDIUM,LOW \
  --skip-dirs .pnpm-store,node_modules/.cache \
  . 2>&1 | tee "$SCAN_DIR/trivy-full.txt"
```

Code-level analysis runs on every pull request through Cycode, not here.

---

## Step 2 — triage every finding

For each finding, classify before touching any code:

| Classification | Criteria | Action |
|---|---|---|
| **Real — fix now** | Attacker-controlled input reaches a sink, crypto weakness, secret in code, dep with known exploit | Fix in this session |
| **Real — track** | Low severity, no known exploit, no user-controlled path | Add to known-issues list, note in commit |
| **False positive** | Internal data only, test fixture, docs placeholder | Suppress with an ignore entry and a comment explaining why |

**Never suppress without a written reason.** The suppression comment must explain what makes it safe.

**Secret finding protocol:** if Trivy finds a secret (any severity):
1. Stop everything else.
2. Identify the file and line.
3. Alert the user: file, line, secret type, and the env-var name if it can be
   established. **Never print, quote, log, or paste the secret value** — not in
   chat, tool output, commits, or the sign-off block. Redact scan output that
   would carry it.
4. Instruct user to cycle (revoke + regenerate) the credential immediately — assume compromised.
5. Do not continue until the secret is removed from file AND git history.

---

## Step 3 — fix real findings

Fix each real finding. Rules:
- Fix the root cause, not the symptom. Don't suppress a real finding.
- One logical fix per commit (crypto fix separate from dep upgrade separate from misconfig).
- For dep upgrades: run `pnpm install` after updating `package.json`, verify lockfile changed.
- For code fixes: read the full function before editing — understand context.
- For Dockerfile misconfiguration: fix the Dockerfile directly, don't add ignore rules.

---

## Step 4 — retest after every fix

After **each fix** (not just at the end):

```bash
pnpm test
```

All tests must pass before moving to the next finding. If a fix breaks a test:
- Understand why before proceeding
- Fix the test if the test was wrong (e.g. was asserting the broken behavior)
- Fix the code if the test was right

---

## Step 5 — rescan to confirm clean

After all fixes are applied:

```bash
# Same flags as Step 1
trivy fs --scanners vuln,secret,misconfig --severity CRITICAL,HIGH,MEDIUM,LOW \
  --skip-dirs .pnpm-store,node_modules/.cache . 2>&1
```

Expected: zero findings (or only known-tracked / suppressed-with-reason items).

If new findings appear that weren't in Step 1 — stop, triage, fix before proceeding.

---

## Step 6 — commit

This repo is public. Per AGENTS.md "Security information disclosure — HARD RULE",
a commit message may say **only that a security issue was fixed** — nothing
about how it worked, what it touched, which advisory it maps to, or why a
suppression is safe.

```bash
git add <changed files>
git commit -m "fix: patch a security issue in <area>

<one or two neutral sentences naming the part of the code that changed, in
 plain terms. Keep it factual; say nothing about behaviour before the change.>"
```

Do not run `git commit` without explicit user approval (global rule). Stage,
show the diff, and ask.

The real detail — root cause per finding, why each fix works, every
suppression justification — goes to the **internal Security page**
(`$NOTION_SECURITY_ID`), never to the commit, PR, branch, or an issue. The
`commit-msg` / `pre-commit` disclosure hooks are a backstop that matches
vocabulary, not meaning — keep the message clean regardless.

---

## Step 7 — sign-off block

**Local console only.** Never paste this block into a PR description, PR comment,
issue, commit message, or any pushed file — it lists findings and their
handling, which the disclosure rule keeps off every public surface. It is for
the maintainer's terminal.

Output this block when all findings are resolved and scans are clean:

```
SECURITY-FIX SIGN-OFF
=====================
Branch: <branch>
Scan tool: Trivy <version>
Findings: <N total>
  Fixed:     <N> — <list with severity>
  Suppressed: <N> — <list with justification>
  Tracked:   <N> — <list with reason not fixed now>
pnpm test: PASS (<N> tests)
Trivy rescan: CLEAN
Secrets found: YES (cycled) / NO
Orchestrator verdict: APPROVED ✅ / NEEDS REVISION ❌
```

If NEEDS REVISION — loop back to Step 3 with specific gaps listed.

---

## When to spawn a subagent

Spawn a subagent only if the fix touches 3+ unrelated files across different layers
(e.g. a dep upgrade + a crypto fix + a Dockerfile change all at once). Otherwise
fix inline. Subagent concurrency limit: max 4 (per AGENTS.md).
