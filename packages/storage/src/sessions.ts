import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import type { Session } from "@devness/useai-types";
import { DATA_DIR } from "./paths.js";
import { ensureDir, appendLine } from "./fs.js";

function dateFilePath(date: string): string {
  return join(DATA_DIR, `${date}.jsonl`);
}

function getLast(days: number): string[] {
  const dates: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

export async function appendSession(session: Session): Promise<void> {
  await ensureDir(DATA_DIR);
  const date = session.endedAt.slice(0, 10);
  await appendLine(dateFilePath(date), JSON.stringify(session));
}

export async function readSessionsForRange(days: number): Promise<Session[]> {
  const dates = getLast(Math.min(days, 30));
  const results = await Promise.all(
    dates.map(async (date) => {
      try {
        const raw = await readFile(dateFilePath(date), "utf-8");
        return raw
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Session);
      } catch {
        return [];
      }
    }),
  );
  return results
    .flat()
    .sort(
      (a, b) =>
        b.endedAt.localeCompare(a.endedAt) ||
        a.promptId.localeCompare(b.promptId),
    );
}

export async function writeSessionsForDate(date: string, sessions: Session[]): Promise<void> {
  await ensureDir(DATA_DIR);
  const lines = sessions.map((s) => JSON.stringify(s));
  await writeFile(
    dateFilePath(date),
    lines.join("\n") + (lines.length ? "\n" : ""),
    "utf-8",
  );
}

export async function deleteSession(promptId: string): Promise<void> {
  const dates = getLast(30);
  for (const date of dates) {
    const path = dateFilePath(date);
    try {
      const raw = await readFile(path, "utf-8");
      const lines = raw.trim().split("\n").filter(Boolean);
      const filtered = lines.filter((line) => {
        const s = JSON.parse(line) as Session;
        return s.promptId !== promptId;
      });
      if (filtered.length !== lines.length) {
        await writeFile(
          path,
          filtered.join("\n") + (filtered.length ? "\n" : ""),
          "utf-8",
        );
        return;
      }
    } catch {
      // file doesn't exist, skip
    }
  }
}
