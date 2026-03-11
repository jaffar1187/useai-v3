import type { Command } from "commander";
import { rmSync, existsSync } from "node:fs";
import { DATA_DIR } from "@devness/useai-storage/paths";
import { header, success, fail, dim } from "../utils/display.js";
import { createInterface } from "node:readline";

export function registerPurge(program: Command): void {
  program
    .command("purge")
    .description("Delete all local session data")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (opts: { yes?: boolean }) => {
      header("Purge");

      if (!opts.yes) {
        const answer = await prompt("  This will permanently delete all local session data. Continue? (y/N) ");
        if (answer.toLowerCase() !== "y") {
          dim("Cancelled.");
          console.log();
          return;
        }
        console.log();
      }

      try {
        if (existsSync(DATA_DIR)) {
          rmSync(DATA_DIR, { recursive: true, force: true });
          success("Session data deleted.");
        } else {
          dim("No session data found.");
        }
      } catch (err) {
        fail(`Purge failed: ${err}`);
      }
      console.log();
    });
}

function prompt(q: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (ans) => { rl.close(); resolve(ans.trim()); });
  });
}
