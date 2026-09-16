#!/usr/bin/env node
import { parseArgs } from "node:util";
import { runSetup } from "./setup.js";
import { installSkills } from "./skills.js";

const USAGE = `Usage: answerloops <command> [options]

Commands:
  setup                Bootstrap a self-hosted answerLoops instance (Docker,
                        the published image). Requires Docker + git.
    --dir <path>          Directory to clone into if not already in a
                           checkout (default: ./answerLoops)
    --with-skills          Also install the Claude Code setup + operate
                           skills into ./.claude/skills/

  skills <name...>     Install one or more Claude Code skills into
                        ./.claude/skills/. Names: answerloops-setup,
                        answerloops-operate

  help                 Show this message
`;

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case "setup": {
      const { values } = parseArgs({
        args: rest,
        options: {
          dir: { type: "string", default: "answerLoops" },
          "with-skills": { type: "boolean", default: false },
        },
      });
      await runSetup({ targetDir: values.dir as string, withSkills: values["with-skills"] as boolean });
      break;
    }
    case "skills": {
      if (rest.length === 0) {
        console.error("Usage: answerloops skills <name...>");
        process.exit(1);
      }
      await installSkills(rest);
      break;
    }
    case "help":
    case undefined:
    case "--help":
    case "-h":
      console.log(USAGE);
      break;
    default:
      console.error(`Unknown command "${command}"\n`);
      console.log(USAGE);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
