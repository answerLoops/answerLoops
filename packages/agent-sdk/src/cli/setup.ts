import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkPrereqs } from "./prereqs.js";
import { ensureRepo } from "./repo.js";
import { ensureEnv } from "./env.js";
import { waitForHealth } from "./health.js";
import { installSkills } from "./skills.js";
import { fail, log, run } from "./util.js";

export interface SetupOptions {
  targetDir: string;
  withSkills: boolean;
}

/** Bootstraps a self-hosted answerLoops instance via the published image. */
export async function runSetup(opts: SetupOptions): Promise<void> {
  await checkPrereqs();

  const repoDir = await ensureRepo(opts.targetDir);
  ensureEnv(repoDir);

  log("Starting the stack (docker compose -f docker-compose.ghcr.yml up -d)...");
  const code = await run("docker", ["compose", "-f", "docker-compose.ghcr.yml", "up", "-d"], {
    cwd: repoDir,
  });
  if (code !== 0) fail(`docker compose up failed (exit ${code})`);

  const authUrl = readAuthUrl(repoDir) ?? "http://localhost:3000";
  await waitForHealth(`${authUrl.replace(/\/+$/, "")}/api/health`);

  if (opts.withSkills) {
    await installSkills(["answerloops-setup", "answerloops-operate"]);
  }

  log(`\nYour instance is live at ${authUrl}. Sign in with Google and complete onboarding.`);
}

function readAuthUrl(repoDir: string): string | undefined {
  try {
    const text = readFileSync(join(repoDir, ".env"), "utf8");
    const line = text.split("\n").find((l) => l.trim().startsWith("AUTH_URL="));
    return line?.slice(line.indexOf("=") + 1).trim();
  } catch {
    return undefined;
  }
}
