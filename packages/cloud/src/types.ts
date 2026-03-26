import type { Session } from "@devness/useai-types";

/** Session with local-only fields stripped before sending to the cloud. */
export type SanitizedSession = Omit<Session, "prompt">;

/** Per-date sync payload sent to the cloud. */
export interface SyncPayload {
  date: string;
  total_seconds: number;
  clients: Record<string, number>;
  task_types: Record<string, number>;
  languages: Record<string, number>;
  sessions: SanitizedSession[];
  clientVersion: string;
  sync_signature: string;
}

export interface MilestonePublishPayload {
  milestones: Array<{
    id: string;
    session_id: string;
    title: string;
    private_title?: string;
    category: string;
    complexity: string;
    duration_minutes: number;
    languages: string[];
    client: string;
    chain_hash: string;
  }>;
}

export interface SyncResult {
  synced: number;
  skipped: number;
  errors: number;
}
