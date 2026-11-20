#!/bin/sh
# Installs the repo's git hooks into .git/hooks.
#
# .git/hooks is not version-controlled, so a hook written there protects one
# machine and silently does nothing for anyone else — including after a fresh
# clone of this repo. Keeping the hook bodies here and copying them in makes the
# wiring reviewable and reproducible.
#
# Runs automatically via the `prepare` script on `pnpm install`. To run it by
# hand:  sh scripts/install-hooks.sh
#
# Two hooks, because git passes different things to each:
#
#   pre-commit  — staged additions, secret scan, tests. Receives no arguments.
#   commit-msg  — the commit message, which git passes as $1. This is the only
#                 hook that can see the message at all; a message check wired
#                 into pre-commit reads an empty "$1" and silently passes
#                 everything, which is exactly what happened here before.
#
# Everything between the managed markers is owned by this script and replaced
# wholesale on re-run. Anything outside them is left alone, so a pre-existing
# hook is preserved.

set -e

HOOK_DIR=".git/hooks"
BEGIN="# >>> answerloops managed >>>"
END="# <<< answerloops managed <<<"

# Runs from `prepare` on every install, including inside Docker builds and CI
# checkouts that carry no .git directory. Absence of one means "not a working
# clone", which is not an error — failing here would break those builds for a
# hook they cannot use anyway.
if [ ! -d "$HOOK_DIR" ]; then
  echo "No $HOOK_DIR — skipping hook installation (not a git working copy)."
  exit 0
fi

# install_block <hook-name> <block-file>
# Replaces the managed block if present, otherwise prepends it, preserving any
# existing hook body.
install_block() {
  hook_path="$HOOK_DIR/$1"
  block_file="$2"

  if [ -f "$hook_path" ] && grep -qF "$BEGIN" "$hook_path"; then
    tmp=$(mktemp)
    awk -v begin="$BEGIN" -v end="$END" -v blockfile="$block_file" '
      index($0, begin) { inblock = 1; while ((getline line < blockfile) > 0) print line; next }
      index($0, end)   { inblock = 0; next }
      !inblock         { print }
    ' "$hook_path" > "$tmp"
    mv "$tmp" "$hook_path"
    echo "Updated the managed block in $1."
  else
    tmp=$(mktemp)
    if [ -f "$hook_path" ]; then
      head -n 1 "$hook_path" > "$tmp"
      cat "$block_file" >> "$tmp"
      tail -n +2 "$hook_path" >> "$tmp"
    else
      printf '#!/bin/sh\n' > "$tmp"
      cat "$block_file" >> "$tmp"
    fi
    mv "$tmp" "$hook_path"
    echo "Installed the managed block into $1."
  fi

  chmod +x "$hook_path"
}

PRE_BLOCK=$(mktemp)
cat > "$PRE_BLOCK" <<'BLOCK'
# >>> answerloops managed >>>
# Managed by scripts/install-hooks.sh — edit there, not here.

# 1. Staged additions. Milliseconds, and a failure is a reword rather than a
#    debugging session, so it goes first.
echo "Checking for security-detail disclosure..."
node scripts/check-disclosure.mjs || exit 1
echo "No weakness narration in staged changes."

# 2. Secret scan. Fast, and the one finding that must not reach a push. The
#    reporter deliberately prints the type, file and line but never the value.
if command -v trivy >/dev/null 2>&1; then
  echo "Running Trivy secret scan..."
  trivy fs --scanners secret --skip-dirs .pnpm-store,node_modules/.cache --quiet -f json . 2>/dev/null \
    | node scripts/report-secrets.mjs || exit 1
  echo "Trivy: no secrets detected."
else
  echo "trivy not installed — secret scan skipped. Install it: brew install trivy"
fi

# 3. Tests.
echo "Running tests..."
pnpm test --run || { echo "Commit blocked: tests failed."; exit 1; }
echo "Tests passed."

# Trivy vuln/misconfig and Semgrep are not run here, on purpose. With them the
# hook took over ten minutes, and a hook that slow gets --no-verify'd — which
# does not skip one stage, it skips all of them, including the disclosure and
# secret checks above. Dependency and code scanning run on every pull request
# through Cycode instead, where the wait does not create an incentive to bypass.
# <<< answerloops managed <<<
BLOCK

MSG_BLOCK=$(mktemp)
cat > "$MSG_BLOCK" <<'BLOCK'
# >>> answerloops managed >>>
# Managed by scripts/install-hooks.sh — edit there, not here.

# The commit message is a permanent public surface and historically the one that
# leaked most. git passes its path as $1 here, and only here.
echo "Checking the commit message for security-detail disclosure..."
node scripts/check-disclosure.mjs "$1" || exit 1
echo "Commit message is clean."
# <<< answerloops managed <<<
BLOCK

install_block "pre-commit" "$PRE_BLOCK"
install_block "commit-msg" "$MSG_BLOCK"

rm -f "$PRE_BLOCK" "$MSG_BLOCK"

echo ""
echo "Hooks installed."
echo "  pre-commit  staged additions, secret scan, tests"
echo "  commit-msg  the commit message"
echo ""
echo "A line that genuinely needs flagged wording can carry the 'disclosure-ok'"
echo "marker. --no-verify skips every stage, so prefer the marker."
