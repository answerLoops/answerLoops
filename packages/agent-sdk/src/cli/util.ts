import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

export function log(msg: string): void {
  console.log(msg);
}

export function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

/** Runs a command, streaming its output, resolving with the exit code. */
export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

/** Runs a command silently, returning true only on a clean (0) exit. */
export function commandExists(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

export function fileExists(path: string): boolean {
  return existsSync(path);
}
