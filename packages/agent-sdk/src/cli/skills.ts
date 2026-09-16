import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { log, fail } from "./util.js";

const RAW_BASE = "https://raw.githubusercontent.com/answerLoops/answerLoops/main";

const SKILLS: Record<string, string[]> = {
  "answerloops-setup": ["skills/setup/SKILL.md"],
  "answerloops-operate": ["skills/operate/SKILL.md"],
};

/** Downloads the given Claude Code skills into ./.claude/skills/<name>/. */
export async function installSkills(names: string[]): Promise<void> {
  for (const name of names) {
    const files = SKILLS[name];
    if (!files) fail(`Unknown skill "${name}". Known: ${Object.keys(SKILLS).join(", ")}`);

    const destDir = join(".claude", "skills", name);
    mkdirSync(destDir, { recursive: true });

    for (const relPath of files) {
      const url = `${RAW_BASE}/${relPath}`;
      const res = await fetch(url);
      if (!res.ok) fail(`Could not fetch ${url} (${res.status})`);
      const body = await res.text();
      const destPath = join(destDir, relPath.split("/").pop()!);
      writeFileSync(destPath, body);
    }
    log(`✓ installed ${name} -> ${destDir}`);
  }
}
