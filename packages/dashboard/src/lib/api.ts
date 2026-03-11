import type { Session, UseaiConfig, User, UpdateInfo, StatsResponse, AuthResponse } from "@devness/useai-types";

const BASE = "/api/local";

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, opts);
  const body = (await res.json()) as { ok: boolean; data?: T; error?: string };
  if (!body.ok) throw new Error(body.error ?? `API error ${res.status}`);
  return body.data as T;
}

function jsonPost(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export function fetchSessions(days = 30): Promise<{ sessions: Session[]; total: number }> {
  return apiFetch(`/sessions?days=${days}`);
}

export interface MilestoneRow {
  id: string;
  promptId: string;
  title: string;
  privateTitle?: string;
  project?: string;
  category: string;
  complexity: string;
  durationMinutes: number;
  languages: string[];
  client: string;
  createdAt: string;
  chainHash?: string;
}

export function fetchMilestones(days = 30): Promise<{ milestones: MilestoneRow[] }> {
  return apiFetch(`/sessions/milestones?days=${days}`);
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export function fetchStats(): Promise<StatsResponse> {
  return apiFetch("/stats");
}

// ── Config ────────────────────────────────────────────────────────────────────

export function fetchConfig(): Promise<{ config: UseaiConfig }> {
  return apiFetch("/config");
}

export function patchConfig(patch: Partial<UseaiConfig>): Promise<{ config: UseaiConfig }> {
  return apiFetch("/config", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export function postSendOtp(email: string): Promise<void> {
  return apiFetch("/auth/send-otp", jsonPost({ email }));
}

export function postVerifyOtp(email: string, code: string): Promise<{ user: User }> {
  return apiFetch("/auth/verify-otp", jsonPost({ email, code }));
}

export function postLogout(): Promise<void> {
  return apiFetch("/auth/logout", { method: "POST" });
}

// ── Sync ──────────────────────────────────────────────────────────────────────

export function postSync(): Promise<{ synced: number; skipped: number; errors: number }> {
  return apiFetch("/sync", { method: "POST" });
}

// ── Update check ──────────────────────────────────────────────────────────────

export function fetchUpdateCheck(): Promise<UpdateInfo> {
  return apiFetch("/update-check");
}

export type { Session, UseaiConfig, User, UpdateInfo, AuthResponse, StatsResponse };
