const API = '';

// In dev mode (Vite on :5174), cloud API calls go through /cloud-api proxy → localhost:3010
// In production (embedded in daemon on :19200), they go through the daemon's /api/local/* handlers
const isDev = import.meta.env.DEV;

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const opts: RequestInit = { method: 'POST' };
  if (body) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${API}${path}`, opts);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { message?: string }).message ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

async function patch<T>(path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (isDev) {
    const token = localStorage.getItem('useai_dev_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  const opts: RequestInit = { method: 'PATCH' };
  if (Object.keys(headers).length > 0) opts.headers = headers;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { message?: string }).message ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `${res.status} ${res.statusText}`);
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
  task_outcome: 'completed' | 'partial' | 'abandoned' | 'blocked';
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
  session_id: string;
  conversation_id?: string;
  conversation_index?: number;
  client: string;
  task_type: string;
  languages: string[];
  files_touched: number;
  project?: string;
  title?: string;
  private_title?: string;
  prompt?: string;
  prompt_image_count?: number;
  prompt_images?: Array<{ type: 'image'; description: string }>;
  prompt_word_count?: number;
  model?: string;
  evaluation?: SessionEvaluation;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  /** Active time segments as [isoStart, isoEnd] pairs. When present, used for accurate User Time union. */
  active_segments?: [string, string][];
  heartbeat_count: number;
  record_count: number;
  chain_start_hash: string;
  chain_end_hash: string;
  seal_signature: string;
}

export interface Milestone {
  id: string;
  session_id: string;
  title: string;
  private_title?: string;
  project?: string;
  category: string;
  complexity: string;
  duration_minutes: number;
  languages: string[];
  client: string;
  created_at: string;
  published: boolean;
  published_at: string | null;
  chain_hash: string;
}

export interface LocalConfig {
  mode: 'local' | 'cloud';
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
    session_count: number;
    prompt_quality: number;
    context_provided: number;
    scope_quality: number;
    independence_level: number;
  } | null;
  daily_summaries: Array<{
    date: string;
    sessions: number;
    total_hours: number;
    clients: Record<string, number>;
    task_types: Record<string, number>;
  }>;
  session_count: number;
  milestone_count: number;
  display_session_count: number;
  outside_window: { before: number; after: number };
  complexity: { simple: number; medium: number; complex: number };
  filtered_sessions: SessionSeal[];
  filtered_milestones: Milestone[];
  all_sessions_light: Array<{
    session_id: string;
    started_at: string;
    ended_at: string;
    duration_seconds: number;
    active_segments?: [string, string][];
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

export function fetchDashboard(scale: string, time?: number): Promise<DashboardResponse> {
  const params = new URLSearchParams({ scale });
  if (time != null) params.set('time', String(time));
  return get(`/api/local/dashboard?${params}`);
}

export function fetchFeed(params: {
  scale: string;
  time?: number | undefined;
  offset?: number | undefined;
  limit?: number | undefined;
  client?: string | undefined;
  language?: string | undefined;
  project?: string | undefined;
  search?: string | undefined;
}): Promise<FeedResponse> {
  const qs = new URLSearchParams({ scale: params.scale });
  if (params.time != null) qs.set('time', String(params.time));
  if (params.offset != null) qs.set('offset', String(params.offset));
  if (params.limit != null) qs.set('limit', String(params.limit));
  if (params.client) qs.set('client', params.client);
  if (params.language) qs.set('language', params.language);
  if (params.project) qs.set('project', params.project);
  if (params.search) qs.set('search', params.search);
  return get(`/api/local/sessions/feed?${qs}`);
}

export async function fetchConfig(): Promise<LocalConfig> {
  const config = await get<LocalConfig>('/api/local/config');
  // In dev mode, auth goes directly to cloud API and state is in localStorage
  if (isDev && localStorage.getItem('useai_dev_token')) {
    config.authenticated = true;
    config.email = localStorage.getItem('useai_dev_email') ?? config.email;
    config.username = localStorage.getItem('useai_dev_username') || config.username;
  }
  return config;
}

// ── Update check ─────────────────────────────────────────────────────────────

export interface UpdateInfo {
  current: string;
  latest: string;
  update_available: boolean;
}

export function fetchUpdateCheck(): Promise<UpdateInfo> {
  return get('/api/local/update-check');
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
  return get('/health');
}

// ── Auth/Sync ────────────────────────────────────────────────────────────────
// Dev:  /cloud-api/api/auth/* → Vite proxy → localhost:3010/api/auth/*
// Prod: /api/local/auth/*     → daemon     → api.useai.dev/api/auth/*

export function postSendOtp(email: string): Promise<{ message: string }> {
  return post('/api/local/auth/send-otp', { email });
}

export async function postVerifyOtp(email: string, code: string): Promise<{ success: boolean; email?: string; username?: string }> {
  return post('/api/local/auth/verify-otp', { email, code });
}

export async function postSync(): Promise<{ success: boolean; last_sync_at?: string; error?: string }> {
  return post('/api/local/sync');
}

export async function postLogout(): Promise<{ success: boolean }> {
  if (isDev) {
    localStorage.removeItem('useai_dev_token');
    localStorage.removeItem('useai_dev_email');
    localStorage.removeItem('useai_dev_username');
  }
  return post('/api/local/auth/logout');
}

// ── Username ──────────────────────────────────────────────────────────────────

export async function checkUsername(username: string): Promise<{ available: boolean; reason?: string }> {
  const encoded = encodeURIComponent(username);
  if (isDev) {
    const token = localStorage.getItem('useai_dev_token');
    const opts: RequestInit = {};
    if (token) opts.headers = { Authorization: `Bearer ${token}` };
    const res = await fetch(`${API}/cloud-api/api/users/check-username/${encoded}`, opts);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json() as Promise<{ available: boolean; reason?: string }>;
  }
  return get(`/api/local/users/check-username/${encoded}`);
}

export async function updateUsername(username: string): Promise<{ username: string }> {
  if (isDev) {
    const token = localStorage.getItem('useai_dev_token');
    if (!token) throw new Error('Not authenticated');
    const res = await fetch(`${API}/cloud-api/api/users/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ username }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { message?: string }).message ?? `${res.status} ${res.statusText}`);
    }
    const data = await res.json() as { username: string };
    localStorage.setItem('useai_dev_username', data.username);
    return data;
  }
  return patch('/api/local/users/me', { username });
}

// ── Delete ────────────────────────────────────────────────────────────────────

export function deleteSession(sessionId: string): Promise<{ deleted: boolean; session_id: string; milestones_removed: number }> {
  return del(`/api/local/sessions/${encodeURIComponent(sessionId)}`);
}

export function deleteConversation(conversationId: string): Promise<{ deleted: boolean; conversation_id: string; sessions_removed: number; milestones_removed: number }> {
  return del(`/api/local/conversations/${encodeURIComponent(conversationId)}`);
}

export function deleteMilestone(milestoneId: string): Promise<{ deleted: boolean; milestone_id: string }> {
  return del(`/api/local/milestones/${encodeURIComponent(milestoneId)}`);
}

// ── Config (full) ─────────────────────────────────────────────────────────────

export interface FullConfig {
  mode: 'local' | 'cloud';
  capture: {
    prompt: boolean;
    prompt_images: boolean;
    evaluation: boolean;
    evaluation_reasons: 'all' | 'below_perfect' | 'none';
    milestones: boolean;
  };
  sync: {
    enabled: boolean;
    interval_hours: number;
    include_stats: boolean;
    include_details: boolean;
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
  if (isDev) return get('/cloud-api/api/orgs');
  return get('/api/local/orgs');
}

// ── Sync Logs ─────────────────────────────────────────────────────────────

export interface SyncLogEntry {
  id: string;
  timestamp: string;
  event: 'sync' | 'auto_sync' | 'login' | 'logout' | 'cloud_pull';
  status: 'success' | 'error' | 'info';
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
  return get('/api/local/logs');
}

export function fetchFullConfig(): Promise<FullConfig> {
  return get('/api/local/config/full');
}

export function patchConfig(updates: Record<string, unknown>): Promise<FullConfig & { instructions_updated?: string[] }> {
  return patch('/api/local/config', updates);
}
