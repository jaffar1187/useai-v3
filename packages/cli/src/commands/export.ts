import type { Command } from "commander";
import { writeFileSync } from "node:fs";
import { getTimeWindow } from "../services/stats.service.js";
import { success, fail, header } from "../utils/display.js";
import { DAEMON_URL } from "@devness/useai-storage/paths";
import type { Session } from "@devness/useai-types";

async function fetchAllSessions(start: string, end: string): Promise<Session[]> {
  const all: Session[] = [];
  let offset = 0;
  const limit = 50;

  while (true) {
    const params = new URLSearchParams({ start, end, offset: String(offset), limit: String(limit) });
    const res = await fetch(`${DAEMON_URL}/api/local/prompts?${params}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Daemon returned ${res.status}`);
    const json = await res.json() as {
      conversations: Array<{ sessions: Array<{ session: Session }> }>;
      has_more: boolean;
    };
    for (const conv of json.conversations) {
      for (const sg of conv.sessions) {
        all.push(sg.session);
      }
    }
    if (!json.has_more) break;
    offset += limit;
  }

  return all;
}

export function registerExport(program: Command): void {
  program
    .command("export")
    .description("Export sessions to a file")
    .option("-s, --scale <scale>", "Time scale: day, week, month, year, or rolling like 7d, 30d", "month")
    .option("-f, --format <fmt>", "Output format: json or csv", "json")
    .option("-o, --out <file>",   "Output file path")
    .action(async (opts: { scale: string; format: string; out?: string }) => {
      const { start, end, label: windowLabel } = getTimeWindow(opts.scale);
      const format  = opts.format === "csv" ? "csv" : "json";
      const outFile = opts.out ?? `useai-export-${new Date().toISOString().slice(0, 10)}.${format}`;

      header(`Export (${windowLabel})`);

      let sessions: Session[];
      try {
        sessions = await fetchAllSessions(start, end);
      } catch (err) {
        fail(`Failed to fetch sessions: ${(err as Error).message}`);
        process.exit(1);
      }

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
