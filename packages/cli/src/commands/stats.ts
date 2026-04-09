import type { Command } from "commander";
import { getStats, getTimeWindow } from "../services/stats.service.js";
import pc from "picocolors";
import {
  header,
  label,
  formatDuration,
  dim,
  table,
  fail,
} from "../utils/display.js";

function formatSeconds(sec: number): string {
  if (sec > 0 && sec < 30) return "<1m";
  return formatDuration(sec * 1000);
}

function formatRating(score: number): string {
  const s = score.toFixed(1);
  if (score >= 4) return pc.green(`${s}/5`);
  if (score >= 3) return pc.yellow(`${s}/5`);
  return pc.red(`${s}/5`);
}

export function registerStats(program: Command): void {
  program
    .command("stats")
    .description("Show session statistics")
    .option(
      "-s, --scale <scale>",
      "Time scale: day, week, month, or rolling like 7d, 30d",
      "week",
    )
    .action(async (opts: { scale: string }) => {
      const { start, end, label: windowLabel } = getTimeWindow(opts.scale);

      let stats;
      try {
        stats = await getStats(start, end);
      } catch (err) {
        fail(`Failed to fetch stats: ${(err as Error).message}`);
        process.exit(1);
      }

      header(`Stats (${windowLabel})`);
      label("Clock time", formatDuration(stats.coveredHours * 3600000));
      label("AI time", formatDuration(stats.totalHours * 3600000));
      label("Multiplier", `${stats.aiMultiplier.toFixed(2)}x`);
      label("Milestones", String(stats.totalMilestones));
      label("Features", String(stats.featuresShipped));
      label("Bugs fixed", String(stats.bugsFixed));
      label(
        "Streak",
        `${stats.currentStreak} day${stats.currentStreak !== 1 ? "s" : ""}`,
      );
      console.log();
      dim("Details:");
      label("Prompts", String(stats.totalSessions));

      if (stats.evaluation) {
        console.log();
        dim("Evaluation averages:");
        label("Prompt quality", formatRating(stats.evaluation.promptQuality));
        label("Context", formatRating(stats.evaluation.contextProvided));
        label("Scope", formatRating(stats.evaluation.scopeQuality));
        label("Independence", formatRating(stats.evaluation.independenceLevel));
      }

      if (Object.keys(stats.byClient).length > 0) {
        console.log();
        dim("By tool:");
        const rows = Object.entries(stats.byClient)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => [k, formatSeconds(v), formatSeconds(stats.byClientAI[k] ?? 0)]);
        table(["Tool", "clock", "ai"], rows);
      }

      if (Object.keys(stats.byTaskType).length > 0) {
        console.log();
        dim("By task type:");
        const rows = Object.entries(stats.byTaskType)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => [k.replace(/_/g, "-"), formatSeconds(v), formatSeconds(stats.byTaskTypeAI[k] ?? 0)]);
        table(["Type", "clock", "ai"], rows);
      }
      console.log();
    });
}
