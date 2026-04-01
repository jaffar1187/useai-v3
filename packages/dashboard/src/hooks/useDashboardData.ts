import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SessionSeal, DashboardResponse, FeedConversation } from '../lib/api';
import { fetchDashboard, fetchFeed } from '../lib/api';
import type { Filters } from '../lib/types';
import type { TimeScale } from '../components/time-travel/types';
import {
  ALL_SCALES,
  SCALE_LABELS,
  SCRUB_CALENDAR_MAP,
  isCalendarScale,
  getTimeWindow,
  jumpScale,
  shouldSnapToLive,
} from '../components/time-travel/types';

export type DashboardFetcher = typeof fetchDashboard;
export type FeedFetcher = typeof fetchFeed;

function readLocalStorage<T extends string>(key: string, valid: T[], fallback: T): T {
  try {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(key) : null;
    if (saved && (valid as string[]).includes(saved)) return saved as T;
  } catch { /* ignore */ }
  return fallback;
}

function writeLocalStorage(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

const EMPTY_STATS: DashboardResponse['stats'] = {
  totalHours: 0, totalSessions: 0, actualSpanHours: 0, coveredHours: 0,
  aiMultiplier: 0, peakConcurrency: 0, currentStreak: 0, filesTouched: 0,
  featuresShipped: 0, bugsFixed: 0, complexSolved: 0, totalMilestones: 0,
  completionRate: 0, activeProjects: 0,
  byClient: {}, byLanguage: {}, byTaskType: {}, byProject: {},
  byProjectClock: {}, byClientAI: {}, byLanguageAI: {}, byTaskTypeAI: {},
};

export interface UseDashboardDataOptions {
  defaultTimeScale?: TimeScale | undefined;
  dashboardFetcher?: DashboardFetcher | undefined;
  feedFetcher?: FeedFetcher | undefined;
  onDeleteSession?: ((id: string) => void) | undefined;
  onDeleteConversation?: ((id: string) => void) | undefined;
  onDeleteMilestone?: ((id: string) => void) | undefined;
}

export function useDashboardData({
  defaultTimeScale = 'day',
  dashboardFetcher: fetchDash = fetchDashboard,
  feedFetcher: fetchFd = fetchFeed,
  onDeleteSession,
  onDeleteConversation,
  onDeleteMilestone,
}: UseDashboardDataOptions = {}) {
  // ── Time travel state ──────────────────────────────────────────────────
  const [timeTravelTime, setTimeTravelTime] = useState<number | null>(null);
  const [timeScale, setTimeScaleRaw] = useState<TimeScale>(() =>
    readLocalStorage('useai-time-scale', ALL_SCALES as TimeScale[], defaultTimeScale),
  );

  const setTimeScale = useCallback((s: TimeScale) => {
    writeLocalStorage('useai-time-scale', s);
    setTimeScaleRaw(s);
  }, []);

  // Restore calendar scale when returning to live
  useEffect(() => {
    if (timeTravelTime === null) {
      const calendarScale = SCRUB_CALENDAR_MAP[timeScale];
      if (calendarScale) setTimeScale(calendarScale);
    }
  }, [timeTravelTime, timeScale, setTimeScale]);

  // ── Compute window ─────────────────────────────────────────────────────
  const effectiveTime = timeTravelTime ?? Date.now();
  const { start: windowStart, end: windowEnd } = getTimeWindow(timeScale, effectiveTime);
  const isLive = timeTravelTime === null;

  // ── Server data ────────────────────────────────────────────────────────
  const [serverData, setServerData] = useState<DashboardResponse | null>(null);
  const [feedConversations, setFeedConversations] = useState<FeedConversation[]>([]);
  const [feedHasMore, setFeedHasMore] = useState(false);
  const [feedLoading, setFeedLoading] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);
  const [filters, setFiltersRaw] = useState<Filters>({ category: 'all', client: 'all', project: 'all', language: 'all' });

  const setFilter = useCallback((key: keyof Filters, value: string) => {
    setFiltersRaw((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Fetch dashboard stats
  useEffect(() => {
    fetchDash(windowStart, windowEnd)
      .then(setServerData)
      .catch(() => setServerData(null));
  }, [windowStart, windowEnd, dataVersion]);

  // Fetch feed
  useEffect(() => {
    setFeedConversations([]);
    setFeedLoading(true);
    fetchFd({
      start: windowStart,
      end: windowEnd,
      offset: 0,
      limit: 50,
      client: filters.client !== 'all' ? filters.client : undefined,
      language: filters.language !== 'all' ? filters.language : undefined,
      project: filters.project !== 'all' ? filters.project : undefined,
    })
      .then((data) => {
        setFeedConversations(data.conversations);
        setFeedHasMore(data.has_more);
        setFeedLoading(false);
      })
      .catch(() => setFeedLoading(false));
  }, [windowStart, windowEnd, filters, dataVersion]);

  const handleLoadMore = useCallback(() => {
    if (feedLoading || !feedHasMore) return;
    setFeedLoading(true);
    fetchFd({
      start: windowStart,
      end: windowEnd,
      offset: feedConversations.length,
      limit: 50,
      client: filters.client !== 'all' ? filters.client : undefined,
      language: filters.language !== 'all' ? filters.language : undefined,
      project: filters.project !== 'all' ? filters.project : undefined,
    })
      .then((data) => {
        setFeedConversations((prev) => [...prev, ...data.conversations]);
        setFeedHasMore(data.has_more);
        setFeedLoading(false);
      })
      .catch(() => setFeedLoading(false));
  }, [timeScale, timeTravelTime, filters, feedConversations.length, feedLoading, feedHasMore]);

  // ── Delete handlers (re-fetch after delete) ────────────────────────────
  const handleDeleteSession = useCallback(async (id: string) => {
    await onDeleteSession?.(id);
    setDataVersion((v) => v + 1);
  }, [onDeleteSession]);

  const handleDeleteConversation = useCallback(async (id: string) => {
    await onDeleteConversation?.(id);
    setDataVersion((v) => v + 1);
  }, [onDeleteConversation]);

  const handleDeleteMilestone = useCallback(async (id: string) => {
    await onDeleteMilestone?.(id);
    setDataVersion((v) => v + 1);
  }, [onDeleteMilestone]);

  // ── Destructure server data ────────────────────────────────────────────
  const stats = serverData?.stats ?? EMPTY_STATS;
  const evaluation = serverData?.evaluation ?? null;
  const outsideWindow = serverData?.outsideWindow ?? { before: 0, after: 0 };
  const complexityData = serverData?.complexity ?? { simple: 0, medium: 0, complex: 0 };
  const displaySessionCount = serverData?.displaySessionCount ?? 0;
  const filteredSessions = serverData?.filteredSessions ?? [];
  const filteredMilestones = serverData?.filteredMilestones ?? [];
  const allSessionsLight = serverData?.allSessionsLight ?? [];
  const allSessionsForStrip = allSessionsLight as unknown as SessionSeal[];

  // ── Navigation ─────────────────────────────────────────────────────────
  const outsideWindowCounts = useMemo(() => {
    if (isLive && outsideWindow.before === 0) return undefined;
    const scaleLabel = SCALE_LABELS[timeScale];
    const fmt = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    const fmtDate = (iso: string) => {
      const d = new Date(iso);
      return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${fmt(iso)}`;
    };
    const isMultiDay = isCalendarScale(timeScale) || windowStart.slice(0, 10) !== windowEnd.slice(0, 10);
    const label = isMultiDay ? fmtDate : fmt;

    const olderRef = jumpScale(timeScale, effectiveTime, -1);
    const olderWindow = getTimeWindow(timeScale, olderRef);
    const olderLabel = `View prev ${scaleLabel} · ${label(olderWindow.start)} – ${label(olderWindow.end)}`;
    if (isLive) {
      return { before: outsideWindow.before, after: 0, olderLabel };
    }
    const newerRef = jumpScale(timeScale, effectiveTime, 1);
    const newerWindow = getTimeWindow(timeScale, newerRef);
    return {
      ...outsideWindow,
      newerLabel: `View next ${scaleLabel} · ${label(newerWindow.start)} – ${label(newerWindow.end)}`,
      olderLabel,
    };
  }, [outsideWindow, effectiveTime, isLive, timeScale, windowStart, windowEnd]);

  const handleNavigateNewer = useCallback(() => {
    const next = jumpScale(timeScale, effectiveTime, 1);
    if (shouldSnapToLive(timeScale, next)) {
      setTimeTravelTime(null);
    } else {
      setTimeTravelTime(next);
    }
  }, [effectiveTime, timeScale]);

  const handleNavigateOlder = useCallback(() => {
    const prev = jumpScale(timeScale, effectiveTime, -1);
    setTimeTravelTime(prev);
  }, [effectiveTime, timeScale]);

  const highlightDate = useMemo(() => {
    if (isLive) return undefined;
    const d = new Date(effectiveTime);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, [isLive, effectiveTime]);

  const handleDayClick = useCallback((date: string) => {
    const midday = new Date(`${date}T12:00:00`).getTime();
    setTimeTravelTime(midday);
    setTimeScale('day');
  }, [setTimeScale]);

  const feedMetrics = useMemo(() => {
    if (!evaluation || evaluation.sessionCount === 0) return null;
    return {
      promptQuality: evaluation.promptQuality,
      scope: evaluation.scopeQuality,
      context: evaluation.contextProvided,
      independence: evaluation.independenceLevel,
    };
  }, [evaluation]);

  return {
    // Time travel
    timeTravelTime, setTimeTravelTime,
    timeScale, setTimeScale,
    effectiveTime, isLive,
    windowStart, windowEnd,

    // Filters
    filters, setFilter,

    // Server data
    stats, evaluation, complexityData,
    displaySessionCount,
    filteredSessions, filteredMilestones,
    allSessionsForStrip,

    // Feed
    feedConversations, feedHasMore, feedLoading,
    handleLoadMore,

    // Navigation
    outsideWindowCounts,
    handleNavigateNewer, handleNavigateOlder,
    highlightDate, handleDayClick,

    // Delete
    handleDeleteSession, handleDeleteConversation, handleDeleteMilestone,

    // Metrics
    feedMetrics,
  };
}
