#!/usr/bin/env bash
# Checks the tools answerLoops self-hosting needs are present and meet the
# minimum version documented in content/docs/self-hosting/prerequisites.mdx.
# Exits non-zero on the first missing/too-old tool so the calling skill can
# stop and tell the user what to install, rather than failing deep inside a
# docker compose run with a confusing error.
set -euo pipefail

fail=0

check_node() {
  if ! command -v node >/dev/null 2>&1; then
    echo "✗ node not found — install Node.js 22+ (https://nodejs.org)"
    fail=1
    return
  fi
  local major
  major=$(node -p 'process.versions.node.split(".")[0]')
  if [ "$major" -lt 22 ]; then
    echo "✗ node $(node -v) found — answerLoops requires Node.js 22+"
    fail=1
  else
    echo "✓ node $(node -v)"
  fi
}

check_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "✗ docker not found — install Docker (https://docs.docker.com/get-docker/)"
    fail=1
    return
  fi
  if ! docker compose version >/dev/null 2>&1; then
    echo "✗ docker compose v2 not found — update Docker Desktop or install the compose plugin"
    fail=1
    return
  fi
  echo "✓ docker $(docker --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1), $(docker compose version --short 2>/dev/null || docker compose version | head -1)"
}

check_pnpm() {
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "✗ pnpm not found — install pnpm 11+ (https://pnpm.io/installation)"
    fail=1
    return
  fi
  local major
  major=$(pnpm --version | cut -d. -f1)
  if [ "$major" -lt 11 ]; then
    echo "✗ pnpm $(pnpm --version) found — answerLoops requires pnpm 11+"
    fail=1
  else
    echo "✓ pnpm $(pnpm --version)"
  fi
}

check_git() {
  if ! command -v git >/dev/null 2>&1; then
    echo "✗ git not found — required to clone the repo"
    fail=1
    return
  fi
  echo "✓ git $(git --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
}

check_openssl() {
  if ! command -v openssl >/dev/null 2>&1; then
    echo "✗ openssl not found — needed to generate AUTH_SECRET / ENCRYPTION_KEY"
    fail=1
    return
  fi
  echo "✓ openssl available"
}

check_node
check_docker
check_pnpm
check_git
check_openssl

if [ "$fail" -ne 0 ]; then
  echo
  echo "One or more prerequisites are missing. Install them, then re-run this check."
  exit 1
fi

echo
echo "All prerequisites satisfied."
