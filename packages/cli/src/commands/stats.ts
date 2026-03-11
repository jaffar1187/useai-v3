import type { Command } from "commander";
import { getStats } from "../services/stats.service.js";
import { header, label, formatDuration, formatScore, dim, table } from "../utils/display.js";

export function registerStats(program: Command): void {
  program
    .command("stats")
    .description("Show session statistics")
    .option("-d, --days <n>", "Number of days to look back", "30")
    .action(async (opts: { days: string }) => {
      const days = Math.min(parseInt(opts.days, 10) || 30, 30);
      const stats = await getStats(days);

      header(`Stats (last ${days} days)`);
      label("Sessions",       String(stats.totalSessions));
      label("Total time",     formatDuration(stats.totalDurationMs));
      label("Avg score",      formatScore(stats.averageScore));
      label("Current streak", `${stats.currentStreak} day${stats.currentStreak !== 1 ? "s" : ""}`);
      label("Longest streak", `${stats.longestStreak} day${stats.longestStreak !== 1 ? "s" : ""}`);

      if (Object.keys(stats.sessionsByClient).length > 0) {
        console.log();
        dim("By tool:");
        const rows = Object.entries(stats.sessionsByClient)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => [k, String(v)]);
        table(["Tool", "Sessions"], rows);
      }

      if (Object.keys(stats.sessionsByTaskType).length > 0) {
        console.log();
        dim("By task type:");
        const rows = Object.entries(stats.sessionsByTaskType)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([k, v]) => [k, String(v)]);
        table(["Type", "Sessions"], rows);
      }
      console.log();
    });
}
