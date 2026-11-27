import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { log, fail } from "./util.js";

const BASE_REQUIRED_VARS = ["DATABASE_URL", "AUTH_URL"] as const;

const HOW_TO_GET: Record<string, string> = {
  DATABASE_URL:
    "a Postgres connection string you run and control, e.g. postgresql://user:pass@host:5432/db",
  AUTH_URL: "the public URL this instance will be reachable at, e.g. http://localhost:3000",
  AUTH_GOOGLE_ID:
    "a Google OAuth client ID — console.cloud.google.com, register callback {AUTH_URL}/api/auth/callback/google",
  AUTH_GOOGLE_SECRET: "the matching Google OAuth client secret from the same client",
  AUTH_GITHUB_ID:
    "a GitHub OAuth app client ID — github.com/settings/developers, register callback {AUTH_URL}/api/auth/callback/github",
  AUTH_GITHUB_SECRET: "the matching GitHub OAuth app client secret from the same app",
};

/** Minimal KEY=VALUE parser — no quoting/escaping support, matches what .env.example actually uses. */
function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

function genSecret(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Ensures repoDir/.env exists with AUTH_SECRET/ENCRYPTION_KEY set (generated
 * here if absent — these are pure-random, safe to generate, unlike anything
 * that identifies an external account). Never invents DATABASE_URL, AUTH_URL,
 * or the Google OAuth pair: those come from the user, checked against both
 * the existing .env and the calling process's own environment (so a value
 * already exported by whoever is driving this — a human or an agent that
 * collected it in conversation — is picked up without re-prompting).
 */
export function ensureEnv(repoDir: string): void {
  const envPath = join(repoDir, ".env");
  const existing = parseEnvFile(envPath);
  const toAppend: string[] = [];

  for (const secretVar of ["AUTH_SECRET", "ENCRYPTION_KEY"] as const) {
    if (!existing[secretVar] && !process.env[secretVar]) {
      const value = genSecret();
      toAppend.push(`${secretVar}=${value}`);
      log(`✓ generated ${secretVar}`);
    }
  }

  if (toAppend.length > 0) {
    appendFileSync(envPath, (existsSync(envPath) ? "\n" : "") + toAppend.join("\n") + "\n");
  } else if (!existsSync(envPath)) {
    writeFileSync(envPath, "");
  }

  const getVal = (key: string): string => {
    const fileVal = existing[key]?.trim();
    if (fileVal) return fileVal;
    const envVal = process.env[key]?.trim();
    if (envVal) return envVal;
    return "";
  };

  const missingBase = BASE_REQUIRED_VARS.filter((v) => !getVal(v));

  const hasGoogleId = !!getVal("AUTH_GOOGLE_ID");
  const hasGoogleSecret = !!getVal("AUTH_GOOGLE_SECRET");
  const hasGoogle = hasGoogleId && hasGoogleSecret;

  const hasGithubId = !!getVal("AUTH_GITHUB_ID");
  const hasGithubSecret = !!getVal("AUTH_GITHUB_SECRET");
  const hasGithub = hasGithubId && hasGithubSecret;

  const hasAtLeastOneProvider = hasGoogle || hasGithub;

  if (missingBase.length > 0 || !hasAtLeastOneProvider) {
    console.error(`Missing required configuration in ${envPath}:`);
    for (const v of missingBase) {
      console.error(`  ${v} — ${HOW_TO_GET[v]}`);
    }
    if (!hasAtLeastOneProvider) {
      console.error(
        `  At least one complete OAuth provider pair is required (Google or GitHub):`,
      );
      if (!hasGoogle) {
        if (!hasGoogleId) console.error(`    AUTH_GOOGLE_ID — ${HOW_TO_GET.AUTH_GOOGLE_ID}`);
        if (!hasGoogleSecret) console.error(`    AUTH_GOOGLE_SECRET — ${HOW_TO_GET.AUTH_GOOGLE_SECRET}`);
      }
      if (!hasGithub) {
        if (!hasGithubId) console.error(`    AUTH_GITHUB_ID — ${HOW_TO_GET.AUTH_GITHUB_ID}`);
        if (!hasGithubSecret) console.error(`    AUTH_GITHUB_SECRET — ${HOW_TO_GET.AUTH_GITHUB_SECRET}`);
      }
    }
    console.error(
      `\nAdd these to ${envPath} (or export them before running this command), then re-run.`,
    );
    fail("Required environment variables not set.");
  }

  log(`✓ ${envPath} has everything required`);
}
