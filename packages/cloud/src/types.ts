import type { Session } from "@devness/useai-types";

/** Session with local-only fields stripped before sending to the cloud. */
export type SanitizedSession = Omit<Session, "prompt">;

export interface SyncPayload {
  sessions: SanitizedSession[];
  clientVersion: string;
}

export interface PublishPayload {
  sessionId: string;
  public: boolean;
}

export interface SyncResult {
  synced: number;
  skipped: number;
  errors: number;
}
