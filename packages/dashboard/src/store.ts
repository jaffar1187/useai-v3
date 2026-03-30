import { create } from 'zustand';
import type { LocalConfig, HealthInfo, UpdateInfo, DashboardResponse, FeedResponse } from './lib/api';
import { fetchConfig, fetchHealth, fetchUpdateCheck, fetchDashboard, fetchFeed, deleteSession as apiDeleteSession, deleteConversation as apiDeleteConversation, deleteMilestone as apiDeleteMilestone } from './lib/api';
import type { TimeScale } from './components/time-travel/types';
import { ALL_SCALES, SCALE_MS } from './components/time-travel/types';
import type { Filters, ActiveTab } from './lib/types';

export type { TimeScale, Filters, ActiveTab, DashboardResponse, FeedResponse };
export { SCALE_MS };

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

export const useDashboardStore = create<DashboardState>((set, get) => ({
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
    const { timeScale, timeTravelTime } = get();
    try {
      const data = await fetchDashboard(timeScale, timeTravelTime ?? undefined);
      set({ dashboardData: data });
    } catch {
      // Fall back to client-side computation (old behavior still works)
    }
  },

  loadFeed: async (params) => {
    const { timeScale, timeTravelTime, filters, feedData } = get();
    const offset = params?.offset ?? 0;
    const append = params?.append ?? false;
    set({ feedLoading: true });
    try {
      const data = await fetchFeed({
        scale: timeScale,
        time: timeTravelTime ?? undefined,
        offset,
        limit: 50,
        client: filters.client !== 'all' ? filters.client : undefined,
        language: filters.language !== 'all' ? filters.language : undefined,
        project: filters.project !== 'all' ? filters.project : undefined,
      });
      if (append && feedData) {
        set({
          feedData: {
            ...data,
            conversations: [...feedData.conversations, ...data.conversations],
          },
          feedLoading: false,
        });
      } else {
        set({ feedData: data, feedLoading: false });
      }
    } catch {
      set({ feedLoading: false });
    }
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
