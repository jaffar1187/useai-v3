import type { Command } from "commander";
import { writeFileSync } from "node:fs";
import { getSessions } from "../services/stats.service.js";
import { success, fail, header } from "../utils/display.js";
import type { Session } from "@devness/useai-types";

export function registerExport(program: Command): void {
  program
    .command("export")
    .description("Export sessions to a file")
    .option("-d, --days <n>",   "Number of days to export", "30")
    .option("-f, --format <fmt>", "Output format: json or csv", "json")
    .option("-o, --out <file>",   "Output file path")
    .action(async (opts: { days: string; format: string; out?: string }) => {
      const days    = Math.min(parseInt(opts.days, 10) || 30, 30);
      const format  = opts.format === "csv" ? "csv" : "json";
      const outFile = opts.out ?? `useai-export-${new Date().toISOString().slice(0, 10)}.${format}`;

      header("Export");

      const sessions = await getSessions(days);

      try {
        const content = format === "csv" ? toCsv(sessions) : JSON.stringify(sessions, null, 2);
        writeFileSync(outFile, content, "utf-8");
        success(`Exported ${sessions.length} sessions → ${outFile}`);
      } catch (err) {
        fail(`Export failed: ${err}`);
      }
      console.log();
    });
}

function toCsv(sessions: Session[]): string {
  const cols = ["promptId", "client", "taskType", "title", "startedAt", "endedAt", "durationMs", "score", "languages"];
  const header = cols.join(",");
  const rows = sessions.map((s) =>
    [
      s.promptId,
      s.client,
      s.taskType,
      `"${(s.title ?? "").replace(/"/g, '""')}"`,
      s.startedAt,
      s.endedAt,
      s.durationMs,
      s.score ? Math.round(s.score.overall * 100) : "",
      (s.languages ?? []).join("|"),
    ].join(","),
  );
  return [header, ...rows].join("\n");
}
