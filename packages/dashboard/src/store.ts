import { create } from "zustand";
import type { Session, UseaiConfig, User, UpdateInfo } from "./lib/api.js";
import {
  fetchSessions,
  fetchMilestones,
  fetchConfig,
  patchConfig as apiPatchConfig,
  postSendOtp,
  postVerifyOtp,
  postLogout,
  postSync,
  fetchUpdateCheck,
  type MilestoneRow,
} from "./lib/api.js";
import { computeStats, type ComputedStats } from "./lib/stats.js";

export type ActiveTab = "stats" | "sessions" | "milestones" | "settings";
export type AuthStep = "idle" | "email" | "code";

interface State {
  // Data
  sessions: Session[];
  stats: ComputedStats | null;
  milestones: MilestoneRow[];
  config: UseaiConfig | null;
  user: User | null;
  updateInfo: UpdateInfo | null;

  // UI
  activeTab: ActiveTab;
  daysRange: number;
  loading: boolean;
  syncing: boolean;
  authStep: AuthStep;
  authEmail: string;
  authError: string | null;
  error: string | null;

  // Actions
  setTab: (tab: ActiveTab) => void;
  setDaysRange: (days: number) => void;

  loadAll: () => Promise<void>;
  loadSessions: () => Promise<void>;
  loadMilestones: () => Promise<void>;
  loadConfig: () => Promise<void>;
  loadUpdateCheck: () => Promise<void>;

  patchConfig: (patch: Partial<UseaiConfig>) => Promise<void>;

  // Auth
  beginLogin: () => void;
  cancelLogin: () => void;
  sendOtp: (email: string) => Promise<void>;
  verifyOtp: (code: string) => Promise<void>;
  logout: () => Promise<void>;

  // Sync
  syncNow: () => Promise<void>;
}

export const useStore = create<State>((set, get) => ({
  sessions: [],
  stats: null,
  milestones: [],
  config: null,
  user: null,
  updateInfo: null,
  activeTab: "stats",
  daysRange: 30,
  loading: false,
  syncing: false,
  authStep: "idle",
  authEmail: "",
  authError: null,
  error: null,

  setTab: (tab) => set({ activeTab: tab }),

  setDaysRange: (days) => {
    set({ daysRange: days });
    void get().loadSessions();
    void get().loadMilestones();
  },

  loadAll: async () => {
    set({ loading: true, error: null });
    try {
      await Promise.all([
        get().loadSessions(),
        get().loadMilestones(),
        get().loadConfig(),
        get().loadUpdateCheck(),
      ]);
    } catch (err) {
      set({ error: String(err) });
    } finally {
      set({ loading: false });
    }
  },

  loadSessions: async () => {
    const { daysRange } = get();
    const data = await fetchSessions(daysRange);
    const stats = computeStats(data.sessions);
    set({ sessions: data.sessions, stats });
  },

  loadMilestones: async () => {
    const { daysRange } = get();
    const data = await fetchMilestones(daysRange);
    set({ milestones: data.milestones });
  },

  loadConfig: async () => {
    const data = await fetchConfig();
    const config = data.config;
    const user = (config.auth?.user as User | undefined) ?? null;
    set({ config, user });
  },

  loadUpdateCheck: async () => {
    try {
      const info = await fetchUpdateCheck();
      set({ updateInfo: info });
    } catch {
      // Non-critical
    }
  },

  patchConfig: async (patch) => {
    const data = await apiPatchConfig(patch);
    const config = data.config;
    const user = (config.auth?.user as User | undefined) ?? null;
    set({ config, user });
  },

  // ── Auth ────────────────────────────────────────────────────────────────────

  beginLogin: () => set({ authStep: "email", authEmail: "", authError: null }),
  cancelLogin: () => set({ authStep: "idle", authEmail: "", authError: null }),

  sendOtp: async (email) => {
    set({ authError: null });
    try {
      await postSendOtp(email);
      set({ authStep: "code", authEmail: email });
    } catch (err) {
      set({ authError: String(err) });
    }
  },

  verifyOtp: async (code) => {
    set({ authError: null });
    const { authEmail } = get();
    try {
      const data = await postVerifyOtp(authEmail, code);
      set({ user: data.user, authStep: "idle" });
      await get().loadConfig();
    } catch (err) {
      set({ authError: String(err) });
    }
  },

  logout: async () => {
    await postLogout();
    await get().loadConfig();
    set({ user: null });
  },

  // ── Sync ────────────────────────────────────────────────────────────────────

  syncNow: async () => {
    set({ syncing: true });
    try {
      await postSync();
      await get().loadConfig();
    } finally {
      set({ syncing: false });
    }
  },
}));

export type { MilestoneRow };
