import type { Command } from "commander";
import { getSessions } from "../services/stats.service.js";
import { header, table, dim } from "../utils/display.js";
import pc from "picocolors";

export function registerMilestones(program: Command): void {
  program
    .command("milestones")
    .description("List recent milestones")
    .option("-d, --days <n>", "Number of days to look back", "7")
    .option("-n, --limit <n>", "Max milestones to show", "50")
    .action(async (opts: { days: string; limit: string }) => {
      const days  = Math.min(parseInt(opts.days, 10)  || 7,  30);
      const limit = parseInt(opts.limit, 10) || 50;

      const sessions = await getSessions(days);
      const milestones = sessions
        .flatMap((s) => s.milestones.map((m) => ({ ...m, endedAt: s.endedAt, client: s.client })))
        .slice(0, limit);

      header(`Milestones (last ${days} days)`);

      if (milestones.length === 0) {
        dim("No milestones found.");
        console.log();
        return;
      }

      const rows = milestones.map((m) => [
        new Date(m.endedAt).toLocaleDateString('en-CA'),
        pc.cyan(m.category),
        m.title,
      ]);
      table(["Date", "Category", "Title"], rows);
      console.log();
    });
}
