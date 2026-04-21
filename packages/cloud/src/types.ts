import type { Session } from "@devness/useai-types";

/** Session with local-only fields stripped before sending to the cloud. */
export type SanitizedSession = Omit<Session, "prompt">;

/** Per-date sync payload sent to the cloud. */
export interface SyncPayload {
  date: string;
  /** Wall-clock user time — union of active intervals, concurrent sessions deduped (seconds) */
  clockTimeSeconds: number;
  /** Total AI time — sum of all session durations, no dedup (seconds) */
  aiTimeSeconds: number;
  /** AI time / user time ratio. >= 1.0 when sessions overlap. */
  multiplier?: number;
  /** Number of prompts (sessions) for this day */
  promptCount?: number;
  /** Current consecutive-day streak as of this sync */
  streakDays?: number;
  clients: Record<string, number>;
  taskTypes: Record<string, number>;
  languages: Record<string, number>;
  sessions: SanitizedSession[];
  clientVersion: string;
  syncSignature: string;
}

export interface SyncResult {
  synced: number;
  skipped: number;
  errors: number;
}
