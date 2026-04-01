import { create } from 'zustand';
import type { LocalConfig, HealthInfo, UpdateInfo, DashboardResponse, FeedResponse } from './lib/api';
import { fetchConfig, fetchHealth, fetchUpdateCheck, deleteSession as apiDeleteSession, deleteConversation as apiDeleteConversation, deleteMilestone as apiDeleteMilestone } from './lib/api';
import type { TimeScale } from './components/time-travel/types';
import { ALL_SCALES } from './components/time-travel/types';
import type { Filters, ActiveTab } from './lib/types';

export type { TimeScale, Filters, ActiveTab, DashboardResponse, FeedResponse };

export interface DashboardState {
  config: LocalConfig | null;
  health: HealthInfo | null;
  updateInfo: UpdateInfo | null;
  loading: boolean;
  timeTravelTime: number | null; // null = live
  timeScale: TimeScale;
  filters: Filters;
  activeTab: ActiveTab;

  // Server-computed data
  dashboardData: DashboardResponse | null;
  feedData: FeedResponse | null;
  feedLoading: boolean;

  loadAll: () => Promise<void>;
  loadHealth: () => Promise<void>;
  loadUpdateCheck: () => Promise<void>;
  loadDashboard: () => Promise<void>;
  loadFeed: (params?: { offset?: number; append?: boolean }) => Promise<void>;
  setTimeTravelTime: (t: number | null) => void;
  setTimeScale: (s: TimeScale) => void;
  setFilter: (key: keyof Filters, value: string) => void;
  setActiveTab: (tab: ActiveTab) => void;
  deleteSession: (sessionId: string) => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
  deleteMilestone: (milestoneId: string) => Promise<void>;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  config: null,
  health: null,
  updateInfo: null,
  loading: true,
  dashboardData: null,
  feedData: null,
  feedLoading: false,
  timeTravelTime: null,
  timeScale: (() => {
    try {
      const saved = localStorage.getItem('useai-time-scale');
      const valid: TimeScale[] = [...ALL_SCALES];
      if (saved && valid.includes(saved as TimeScale)) return saved as TimeScale;
    } catch { /* ignore */ }
    return 'day' as TimeScale;
  })(),
  filters: { category: 'all', client: 'all', project: 'all', language: 'all' },
  activeTab: (() => {
    try {
      const saved = localStorage.getItem('useai-active-tab');
      if (saved === 'sessions' || saved === 'insights' || saved === 'settings') return saved;
    } catch { /* ignore */ }
    return 'sessions' as ActiveTab;
  })(),
  loadAll: async () => {
    try {
      const config = await fetchConfig();
      set({ config, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  loadDashboard: async () => {
    // Not used by DashboardBody (it manages its own fetching)
  },

  loadFeed: async () => {
    // Not used — DashboardBody manages its own fetching
  },

  loadHealth: async () => {
    try {
      const health = await fetchHealth();
      set({ health });
    } catch { /* ignore */ }
  },

  loadUpdateCheck: async () => {
    try {
      const updateInfo = await fetchUpdateCheck();
      set({ updateInfo });
    } catch { /* ignore */ }
  },

  setTimeTravelTime: (t) => set({ timeTravelTime: t }),

  setTimeScale: (s) => {
    try { localStorage.setItem('useai-time-scale', s); } catch { /* ignore */ }
    set({ timeScale: s });
  },

  setFilter: (key, value) =>
    set((state) => ({ filters: { ...state.filters, [key]: value } })),

  setActiveTab: (tab) => {
    try { localStorage.setItem('useai-active-tab', tab); } catch { /* ignore */ }
    set({ activeTab: tab });
  },

  deleteSession: async (sessionId) => {
    try {
      await apiDeleteSession(sessionId);
    } catch (err) {
      console.error('Failed to delete session:', sessionId, err);
    }
  },

  deleteConversation: async (conversationId) => {
    try {
      await apiDeleteConversation(conversationId);
    } catch (err) {
      console.error('Failed to delete conversation:', conversationId, err);
    }
  },

  deleteMilestone: async (milestoneId) => {
    try {
      await apiDeleteMilestone(milestoneId);
    } catch (err) {
      console.error('Failed to delete milestone:', milestoneId, err);
    }
  },
}));
