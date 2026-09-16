import { join } from "node:path";
import { fileExists, log, run, fail } from "./util.js";

const REPO_URL = "https://github.com/answerLoops/answerLoops.git";
const MARKER = "docker-compose.ghcr.yml";

/**
 * Returns the directory to run docker compose from: the current directory
 * if it's already a checkout (has docker-compose.ghcr.yml), the given
 * targetDir if that's already a checkout, or a fresh `git clone` into
 * targetDir otherwise.
 */
export async function ensureRepo(targetDir: string): Promise<string> {
  if (fileExists(join(process.cwd(), MARKER))) {
    return process.cwd();
  }
  if (fileExists(join(targetDir, MARKER))) {
    log(`✓ using existing checkout at ${targetDir}`);
    return targetDir;
  }

  log(`Cloning ${REPO_URL} into ${targetDir}...`);
  const code = await run("git", ["clone", REPO_URL, targetDir]);
  if (code !== 0) fail(`git clone failed (exit ${code})`);
  return targetDir;
}
