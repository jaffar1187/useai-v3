async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const opts: RequestInit = { method: "POST" };
  if (body) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${path}`, opts);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      (data as { message?: string }).message ??
        `${res.status} ${res.statusText}`,
    );
  }
  return res.json() as Promise<T>;
}

async function patch<T>(path: string, body?: unknown): Promise<T> {
  const opts: RequestInit = { method: "PATCH" };
  if (body) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${path}`, opts);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      (data as { message?: string }).message ??
        `${res.status} ${res.statusText}`,
    );
  }
  return res.json() as Promise<T>;
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${path}`, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      (data as { error?: string }).error ?? `${res.status} ${res.statusText}`,
    );
  }
  return res.json() as Promise<T>;
}

// ── Data endpoints ───────────────────────────────────────────────────────────

export interface SessionEvaluation {
  prompt_quality: number;
  prompt_quality_reason?: string;
  prompt_quality_ideal?: string;
  context_provided: number;
  context_provided_reason?: string;
  context_provided_ideal?: string;
  task_outcome: "completed" | "partial" | "abandoned" | "blocked";
  task_outcome_reason?: string;
  task_outcome_ideal?: string;
  iteration_count: number;
  independence_level: number;
  independence_level_reason?: string;
  independence_level_ideal?: string;
  scope_quality: number;
  scope_quality_reason?: string;
  scope_quality_ideal?: string;
  tools_leveraged: number;
}

export interface SessionSeal {
  promptId: string;
  conversationId?: string;
  conversationIndex?: number;
  client: string;
  taskType: string;
  languages: string[];
  filesTouched: number;
  project?: string;
  title?: string;
  privateTitle?: string;
  prompt?: string;
  promptImageCount?: number;
  promptImages?: Array<{ type: "image"; description: string }>;
  promptWordCount?: number;
  model?: string;
  evaluation?: SessionEvaluation;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  /** Active time segments as [isoStart, isoEnd] pairs. When present, used for accurate User Time union. */
  activeSegments?: [string, string][];
  heartbeatCount: number;
  recordCount: number;
  chainStartHash: string;
  chainEndHash: string;
  sealSignature: string;
}

export interface Milestone {
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
  published: boolean;
  publishedAt: string | null;
  chainHash: string;
}

export interface LocalConfig {
  mode: "local" | "cloud";
  authenticated: boolean;
  email: string | null;
  username: string | null;
  last_sync_at: string | null;
  auto_sync: boolean;
}

// ── Server-side computed endpoints ────────────────────────────────────────

export interface DashboardResponse {
  window: { start: number; end: number; scale: string };
  stats: {
    totalHours: number;
    totalSessions: number;
    actualSpanHours: number;
    coveredHours: number;
    aiMultiplier: number;
    peakConcurrency: number;
    currentStreak: number;
    filesTouched: number;
    featuresShipped: number;
    bugsFixed: number;
    complexSolved: number;
    totalMilestones: number;
    completionRate: number;
    activeProjects: number;
    byClient: Record<string, number>;
    byLanguage: Record<string, number>;
    byTaskType: Record<string, number>;
    byProject: Record<string, number>;
    byProjectClock: Record<string, number>;
    byClientAI: Record<string, number>;
    byLanguageAI: Record<string, number>;
    byTaskTypeAI: Record<string, number>;
  };
  evaluation: {
    sessionCount: number;
    promptQuality: number;
    contextProvided: number;
    scopeQuality: number;
    independenceLevel: number;
  } | null;
  dailySummaries: Array<{
    date: string;
    sessions: number;
    totalHours: number;
    clients: Record<string, number>;
    taskTypes: Record<string, number>;
  }>;
  sessionCount: number;
  milestoneCount: number;
  displaySessionCount: number;
  outsideWindow: { before: number; after: number };
  complexity: { simple: number; medium: number; complex: number };
  filteredSessions: SessionSeal[];
  filteredMilestones: Milestone[];
  allSessionsLight: Array<{
    promptId: string;
    startedAt: string;
    endedAt: string;
    durationMs: number;
    activeSegments?: [string, string][];
    client: string;
    languages: string[];
  }>;
}

export interface FeedConversation {
  conversationId: string | null;
  sessions: Array<{
    session: SessionSeal;
    milestones: Milestone[];
  }>;
  aggregateEval: {
    prompt_quality: number;
    context_provided: number;
    independence_level: number;
    scope_quality: number;
    tools_leveraged: number;
    total_iterations: number;
    outcomes: Record<string, number>;
    session_count: number;
  } | null;
  totalDuration: number;
  totalMilestones: number;
  startedAt: string;
  endedAt: string;
  lastSessionAt: string;
}

export interface FeedResponse {
  total: number;
  conversations: FeedConversation[];
  has_more: boolean;
}

export function fetchAggregations(
  start: string,
  end: string,
): Promise<DashboardResponse> {
  const params = new URLSearchParams({ start, end });
  return get(`/api/local/aggregations?${params}`);
}

export function fetchPrompts(params: {
  start: string;
  end: string;
  offset?: number | undefined;
  limit?: number | undefined;
  tool?: string | undefined;
  language?: string | undefined;
  project?: string | undefined;
  search?: string | undefined;
}): Promise<FeedResponse> {
  const qs = new URLSearchParams({ start: params.start, end: params.end });
  if (params.offset != null) qs.set("offset", String(params.offset));
  if (params.limit != null) qs.set("limit", String(params.limit));
  if (params.tool) qs.set("tool", params.tool);
  if (params.language) qs.set("language", params.language);
  if (params.project) qs.set("project", params.project);
  if (params.search) qs.set("search", params.search);
  return get(`/api/local/prompts?${qs}`);
}

export function fetchConfig(): Promise<LocalConfig> {
  return get("/api/local/config");
}

// ── Update check ─────────────────────────────────────────────────────────────

export interface UpdateInfo {
  current: string;
  latest: string;
  update_available: boolean;
}

export function fetchUpdateCheck(): Promise<UpdateInfo> {
  return get("/api/local/update-check");
}

// ── Health ────────────────────────────────────────────────────────────────────

export interface HealthInfo {
  status: string;
  version: string;
  active_sessions: number;
  mcp_connections: number;
  uptime_seconds: number;
}

export function fetchHealth(): Promise<HealthInfo> {
  return get("/health");
}

// ── Auth/Sync ────────────────────────────────────────────────────────────────

export function postSendOtp(email: string): Promise<{ message: string }> {
  return post("/api/local/auth/send-otp", { email });
}

export async function postVerifyOtp(
  email: string,
  code: string,
): Promise<{ success: boolean; email?: string; username?: string }> {
  return post("/api/local/auth/verify-otp", { email, code });
}

export async function postSync(): Promise<{
  success: boolean;
  last_sync_at?: string;
  error?: string;
}> {
  return post("/api/local/sync");
}

export function postLogout(): Promise<{ success: boolean }> {
  return post("/api/local/auth/logout");
}

// ── Username ──────────────────────────────────────────────────────────────────

export function checkUsername(
  username: string,
): Promise<{ available: boolean; reason?: string }> {
  return get(`/api/local/users/check-username/${encodeURIComponent(username)}`);
}

export function updateUsername(
  username: string,
): Promise<{ username: string }> {
  return patch("/api/local/users/me", { username });
}

// ── Delete ────────────────────────────────────────────────────────────────────

export function deleteSession(sessionId: string): Promise<{
  deleted: boolean;
  session_id: string;
  milestones_removed: number;
}> {
  return del(`/api/local/sessions/${encodeURIComponent(sessionId)}`);
}

export function deleteConversation(conversationId: string): Promise<{
  deleted: boolean;
  conversation_id: string;
  sessions_removed: number;
  milestones_removed: number;
}> {
  return del(`/api/local/conversations/${encodeURIComponent(conversationId)}`);
}

export function deleteMilestone(
  milestoneId: string,
): Promise<{ deleted: boolean; milestone_id: string }> {
  return del(`/api/local/milestones/${encodeURIComponent(milestoneId)}`);
}

// ── Config (full) ─────────────────────────────────────────────────────────────

export interface FullConfig {
  mode: "local" | "cloud";
  capture: {
    prompt: boolean;
    prompt_images: boolean;
    evaluation: boolean;
    evaluation_reasons: "none" | "below_perfect" | "all";
    milestones: boolean;
  };
  sync: {
    auto_sync: boolean;
    interval_hours: number;
    include_leaderboard_stats: boolean;
    include_private_details: boolean;
  };
  evaluation_framework: string;
  authenticated: boolean;
  email: string | null;
}

// ── Organizations ─────────────────────────────────────────────────────────

export interface UserOrg {
  org: { id: string; name: string; slug: string };
  role: string;
}

export function fetchMyOrgs(): Promise<UserOrg[]> {
  return get("/api/local/orgs");
}

// ── Sync Logs ─────────────────────────────────────────────────────────────

export interface SyncLogEntry {
  id: string;
  timestamp: string;
  event: "sync" | "auto_sync" | "login" | "logout" | "cloud_pull";
  status: "success" | "error" | "info";
  message: string;
  details?: {
    sessions_synced?: number;
    milestones_published?: number;
    dates_synced?: number;
    error?: string;
    [key: string]: unknown;
  };
}

export function fetchLogs(): Promise<SyncLogEntry[]> {
  return get("/api/local/logs");
}

export function fetchFullConfig(): Promise<FullConfig> {
  return get("/api/local/config/full");
}

export function patchConfig(
  updates: Record<string, unknown>,
): Promise<FullConfig & { instructions_updated?: string[] }> {
  return patch("/api/local/config", updates);
}
