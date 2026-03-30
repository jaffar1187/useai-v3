import { join } from "node:path";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
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

const SEALED_DIR = join(DATA_DIR, "sealed");

interface SealedChainData {
  session: Record<string, unknown>;
  milestones: Record<string, unknown>[];
}

/**
 * Parse a single sealed UUID.jsonl chain file.
 * Extracts the session seal and milestones.
 */
function parseSealedChain(file: string, raw: string): SealedChainData | null {
  const lines = raw.trim().split("\n").filter(Boolean);

  let sessionId: string | undefined;
  let startTimestamp: string | undefined;
  let client: string | undefined;
  let taskType: string | undefined;
  let seal: Record<string, unknown> | undefined;
  const milestones: Record<string, unknown>[] = [];

  for (const line of lines) {
    try {
      const record = JSON.parse(line) as {
        type: string;
        session_id?: string;
        timestamp?: string;
        data: Record<string, unknown>;
        hash?: string;
      };

      if (record.type === "session_start") {
        sessionId = record.session_id;
        startTimestamp = record.timestamp;
        client = (record.data["client"] as string) ?? undefined;
        taskType = (record.data["task_type"] as string) ?? undefined;
      } else if (record.type === "session_seal") {
        seal = record.data["seal"] as Record<string, unknown> | undefined;
      } else if (record.type === "milestone") {
        milestones.push(record.data);
      }
    } catch {
      // skip malformed lines
    }
  }

  if (!seal) return null;

  const chainHash = (seal["chain_end_hash"] as string) ?? "";
  const durationSeconds = (seal["duration_seconds"] as number) ?? 0;
  const languages = (seal["languages"] as string[]) ?? [];
  const sealClient = (seal["client"] as string) ?? client ?? "unknown";
  const id = sessionId ?? file.replace(".jsonl", "");

  const session: Record<string, unknown> = {
    session_id: id,
    client: sealClient,
    task_type: (seal["task_type"] as string) ?? taskType ?? "other",
    started_at: (seal["started_at"] as string) ?? startTimestamp ?? "",
    ended_at: (seal["ended_at"] as string) ?? "",
    duration_seconds: durationSeconds,
    languages,
    files_touched: (seal["files_touched"] as number) ?? 0,
    title: (seal["title"] as string) ?? undefined,
    private_title: (seal["private_title"] as string) ?? undefined,
    project: (seal["project"] as string) ?? undefined,
    model: (seal["model"] as string) ?? undefined,
    evaluation: seal["evaluation"] ?? undefined,
    heartbeat_count: (seal["heartbeat_count"] as number) ?? 0,
    record_count: (seal["record_count"] as number) ?? 0,
    chain_start_hash: (seal["chain_start_hash"] as string) ?? "",
    chain_end_hash: chainHash,
    seal_signature: (seal["seal_signature"] as string) ?? "",
  };

  const enrichedMilestones = milestones.map((m) => ({
    ...m,
    session_id: id,
    chain_hash: chainHash,
    client: sealClient,
    languages,
    duration_minutes: Math.round(durationSeconds / 60),
  }));

  return { session, milestones: enrichedMilestones };
}

/**
 * Read v1 sessions from sealed UUID.jsonl chain files.
 * Milestones are embedded in each session as `milestones` array
 * so the cloud /api/sync can extract them.
 */
export async function readV1Sessions(): Promise<Record<string, unknown>[]> {
  if (!existsSync(SEALED_DIR)) return [];
  try {
    const files = await readdir(SEALED_DIR);
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
    const sessions: Record<string, unknown>[] = [];

    for (const file of jsonlFiles) {
      const raw = await readFile(join(SEALED_DIR, file), "utf-8");
      const parsed = parseSealedChain(file, raw);
      if (parsed) {
        // Embed milestones in session so cloud can extract via _milestones
        parsed.session["milestones"] = parsed.milestones;
        sessions.push(parsed.session);
      }
    }

    return sessions;
  } catch {
    return [];
  }
}

/**
 * Read v1 milestones from sealed UUID.jsonl chain files.
 */
export async function readV1Milestones(): Promise<Record<string, unknown>[]> {
  if (!existsSync(SEALED_DIR)) return [];
  try {
    const files = await readdir(SEALED_DIR);
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
    const milestones: Record<string, unknown>[] = [];

    for (const file of jsonlFiles) {
      const raw = await readFile(join(SEALED_DIR, file), "utf-8");
      const parsed = parseSealedChain(file, raw);
      if (parsed) milestones.push(...parsed.milestones);
    }

    return milestones;
  } catch {
    return [];
  }
}

export const readV1SealedMilestones = readV1Milestones;

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
