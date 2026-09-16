import { commandExists, fail, log } from "./util.js";

/**
 * Checks the tools the published-image self-host path actually needs: git
 * (to clone) and Docker with Compose v2 (to run it). Node is a given — this
 * is already running under it. pnpm/openssl aren't required here: the ghcr
 * path pulls a built image rather than building from source, and secrets are
 * generated in-process (see env.ts) rather than shelled out to openssl.
 */
export async function checkPrereqs(): Promise<void> {
  const missing: string[] = [];

  if (!(await commandExists("git", ["--version"]))) {
    missing.push("git — https://git-scm.com/downloads");
  }
  if (!(await commandExists("docker", ["--version"]))) {
    missing.push("Docker — https://docs.docker.com/get-docker/");
  } else if (!(await commandExists("docker", ["compose", "version"]))) {
    missing.push("Docker Compose v2 — update Docker Desktop or install the compose plugin");
  }

  if (missing.length > 0) {
    for (const m of missing) console.error(`✗ ${m}`);
    fail("Missing prerequisites. Install the above, then re-run.");
  }

  log("✓ git and Docker (with Compose v2) found");
}
