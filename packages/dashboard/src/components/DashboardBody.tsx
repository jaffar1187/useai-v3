import { useCallback, useEffect, useMemo, useState } from 'react';
import { Filter, Eye, EyeOff, Info } from 'lucide-react';
import type { SessionSeal, Milestone, DashboardResponse, FeedConversation } from '../lib/api';
import { fetchDashboard, fetchFeed } from '../lib/api';
import type { StatCardType } from './stats/StatDetailPanel';
import type { Filters, ActiveTab } from '../lib/types';
import type { TimeScale } from './time-travel/types';
import { ALL_SCALES, SCALE_LABELS, SCRUB_CALENDAR_MAP, isCalendarScale, getTimeWindow, jumpScale, shouldSnapToLive } from './time-travel/types';
import { filterSessionsByWindow, filterMilestonesByWindow } from '../lib/stats';
import { StatsBar } from './stats/StatsBar';
import { StatDetailPanel } from './stats/StatDetailPanel';
import { TimeDetailPanel } from './stats/TimeDetailPanel';
import { TabBar } from './TabBar';
import { FilterChips } from './sessions/FilterChips';
import { SessionList } from './sessions/SessionList';
import { TimeTravelPanel } from './time-travel/TimeTravelPanel';
import { DailyRecap } from './insights/DailyRecap';
import { ComplexityDistribution } from './insights/ComplexityDistribution';
import { TaskTypeBreakdown } from './insights/TaskTypeBreakdown';
import { ProjectAllocation } from './insights/ProjectAllocation';
import { ActivityStrip } from './insights/ActivityStrip';
import { RecentMilestones } from './insights/RecentMilestones';
import { SummaryChips } from './insights/SummaryChips';

export interface DashboardBodyProps {
  sessions: SessionSeal[];
  milestones: Milestone[];
  onDeleteSession?: (id: string) => void;
  onDeleteConversation?: (id: string) => void;
  onDeleteMilestone?: (id: string) => void;
  defaultTimeScale?: TimeScale;
  activeTab?: ActiveTab;
  onActiveTabChange?: (tab: ActiveTab) => void;
}

type ChipColor = 'default' | 'blue' | 'amber' | 'purple' | 'green';

const CHIP_STYLES: Record<ChipColor, { chip: string; value: string; dot: string }> = {
  default: { chip: 'bg-bg-surface-2 border-border/40',        value: 'text-text-muted',   dot: 'bg-text-muted/40' },
  blue:    { chip: 'bg-accent/10 border-accent/30',           value: 'text-accent',        dot: 'bg-accent' },
  amber:   { chip: 'bg-amber-500/10 border-amber-500/30',     value: 'text-amber-400',     dot: 'bg-amber-400' },
  purple:  { chip: 'bg-violet-500/10 border-violet-500/30',   value: 'text-violet-400',    dot: 'bg-violet-400' },
  green:   { chip: 'bg-success/10 border-success/30',         value: 'text-success',       dot: 'bg-success' },
};

function MetricChip({ value, label, title, description, color = 'default' }: {
  value: string; label: string; title: string; description: string; color?: ChipColor;
}) {
  const s = CHIP_STYLES[color];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-mono border px-2 py-0.5 rounded ${s.chip}`}>
      <span className={`w-1 h-1 rounded-full shrink-0 ${s.dot}`} />
      <span className={`font-semibold ${s.value}`}>{value}</span>
      <span className="text-text-muted">{label}</span>
      <span className="relative group flex items-center">
        <Info className="w-2.5 h-2.5 text-text-muted/60 hover:text-text-muted transition-colors cursor-default" />
        <span className={`pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 rounded-lg border-2 px-3 py-2.5 font-sans opacity-0 group-hover:opacity-100 transition-opacity duration-0 z-[9999] shadow-2xl space-y-1 ${s.chip}`} style={{ backgroundColor: 'var(--color-bg-base, #0f0f0f)' }}>
          <p className={`text-[11px] font-bold tracking-wide ${s.value}`}>{title}</p>
          <p className="text-[10px] text-text-secondary leading-relaxed">{description}</p>
        </span>
      </span>
    </span>
  );
}

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

export function DashboardBody({
  sessions,
  milestones,
  onDeleteSession,
  onDeleteConversation,
  onDeleteMilestone,
  defaultTimeScale = 'day',
  activeTab: controlledTab,
  onActiveTabChange,
}: DashboardBodyProps) {
  // ── UI state ────────────────────────────────────────────────────────────
  const [timeTravelTime, setTimeTravelTime] = useState<number | null>(null);
  const [timeScale, setTimeScaleRaw] = useState<TimeScale>(() =>
    readLocalStorage('useai-time-scale', ALL_SCALES as TimeScale[], defaultTimeScale),
  );
  const [filters, setFilters] = useState<Filters>({ category: 'all', client: 'all', project: 'all', language: 'all' });
  const [internalTab, setInternalTabRaw] = useState<ActiveTab>(() =>
    readLocalStorage('useai-active-tab', ['sessions', 'insights'], 'sessions'),
  );
  const [selectedStatCard, setSelectedStatCard] = useState<StatCardType>(null);
  const [globalShowPublic, setGlobalShowPublic] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [serverData, setServerData] = useState<DashboardResponse | null>(null);
  const [feedConversations, setFeedConversations] = useState<FeedConversation[]>([]);
  const [_feedTotal, setFeedTotal] = useState(0);
  const [feedHasMore, setFeedHasMore] = useState(false);
  const [feedLoading, setFeedLoading] = useState(false);

  // Controlled vs uncontrolled tab
  const isControlledTab = controlledTab !== undefined;
  const activeTab = controlledTab ?? internalTab;
  const setActiveTab = useCallback((tab: ActiveTab) => {
    if (onActiveTabChange) {
      onActiveTabChange(tab);
    } else {
      writeLocalStorage('useai-active-tab', tab);
      setInternalTabRaw(tab);
    }
  }, [onActiveTabChange]);

  const setTimeScale = useCallback((s: TimeScale) => {
    writeLocalStorage('useai-time-scale', s);
    setTimeScaleRaw(s);
  }, []);

  const setFilter = useCallback((key: keyof Filters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Restore calendar scale when returning to live
  useEffect(() => {
    if (timeTravelTime === null) {
      const calendarScale = SCRUB_CALENDAR_MAP[timeScale];
      if (calendarScale) {
        setTimeScale(calendarScale);
      }
    }
  }, [timeTravelTime, timeScale, setTimeScale]);

  // ── Fetch server-computed data ──────────────────────────────────────────
  useEffect(() => {
    fetchDashboard(timeScale, timeTravelTime ?? undefined)
      .then(setServerData)
      .catch(() => setServerData(null));
  }, [timeScale, timeTravelTime, sessions.length]);

  // ── Fetch session feed ───────────────────────────────────────────────────
  useEffect(() => {
    setFeedConversations([]);
    setFeedLoading(true);
    fetchFeed({
      scale: timeScale,
      time: timeTravelTime ?? undefined,
      offset: 0,
      limit: 50,
      client: filters.client !== 'all' ? filters.client : undefined,
      language: filters.language !== 'all' ? filters.language : undefined,
      project: filters.project !== 'all' ? filters.project : undefined,
    })
      .then((data) => {
        setFeedConversations(data.conversations);
        setFeedTotal(data.total);
        setFeedHasMore(data.has_more);
        setFeedLoading(false);
      })
      .catch(() => setFeedLoading(false));
  }, [timeScale, timeTravelTime, filters, sessions.length]);

  const handleLoadMore = useCallback(() => {
    if (feedLoading || !feedHasMore) return;
    setFeedLoading(true);
    fetchFeed({
      scale: timeScale,
      time: timeTravelTime ?? undefined,
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

  // ── Server data (all stats come from server) ───────────────────────────
  const stats = serverData?.stats ?? EMPTY_STATS;
  const evaluation = serverData?.evaluation ?? null;
  const outsideWindow = serverData?.outside_window ?? { before: 0, after: 0 };
  const complexityData = serverData?.complexity ?? { simple: 0, medium: 0, complex: 0 };
  const displaySessionCount = serverData?.display_session_count ?? 0;

  // ── Derived values (only what server can't provide) ────────────────────
  const isLive = timeTravelTime === null;
  const effectiveTime = timeTravelTime ?? Date.now();
  const { start: windowStart, end: windowEnd } = getTimeWindow(timeScale, effectiveTime);

  // Raw filtered sessions — still needed for SessionList, ActivityStrip, TimeTravelPanel
  const filteredSessions = useMemo(
    () => filterSessionsByWindow(sessions, windowStart, windowEnd),
    [sessions, windowStart, windowEnd],
  );

  const filteredMilestones = useMemo(
    () => filterMilestonesByWindow(milestones, windowStart, windowEnd),
    [milestones, windowStart, windowEnd],
  );

  const displaySessions = useMemo(
    () => filteredSessions.filter(s => !!s.ended_at && s.duration_seconds > 0),
    [filteredSessions],
  );

  // Navigation labels
  const outsideWindowCounts = useMemo(() => {
    if (isLive && outsideWindow.before === 0) return undefined;
    const scaleLabel = SCALE_LABELS[timeScale];
    const fmt = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    const fmtDate = (ts: number) => {
      const d = new Date(ts);
      return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${fmt(ts)}`;
    };
    const isMultiDay = isCalendarScale(timeScale) || (windowEnd - windowStart) >= 86400000;
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

  const hasActiveFilter = filters.client !== 'all' || filters.language !== 'all' || filters.project !== 'all';

  // Feed metrics from server evaluation
  const feedMetrics = useMemo(() => {
    if (!evaluation || evaluation.session_count === 0) return null;
    return {
      promptQuality: evaluation.prompt_quality,
      scope: evaluation.scope_quality,
      context: evaluation.context_provided,
      independence: evaluation.independence_level,
    };
  }, [evaluation]);

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      <TimeTravelPanel
        value={timeTravelTime}
        onChange={setTimeTravelTime}
        scale={timeScale}
        onScaleChange={setTimeScale}
        sessions={sessions}
        milestones={milestones}
        showPublic={globalShowPublic}
      />

      <StatsBar
        totalHours={stats.totalHours}
        totalSessions={stats.totalSessions}
        actualSpanHours={stats.actualSpanHours}
        coveredHours={stats.coveredHours}
        aiMultiplier={stats.aiMultiplier}
        peakConcurrency={stats.peakConcurrency}
        currentStreak={stats.currentStreak}
        filesTouched={stats.filesTouched}
        featuresShipped={stats.featuresShipped}
        bugsFixed={stats.bugsFixed}
        complexSolved={stats.complexSolved}
        totalMilestones={stats.totalMilestones}
        completionRate={stats.completionRate}
        activeProjects={stats.activeProjects}
        selectedCard={selectedStatCard}
        onCardClick={setSelectedStatCard}
      />

      <StatDetailPanel
        type={selectedStatCard}
        milestones={filteredMilestones}
        showPublic={globalShowPublic}
        onClose={() => setSelectedStatCard(null)}
      />

      <TimeDetailPanel
        type={selectedStatCard}
        sessions={displaySessions}
        allSessions={sessions}
        currentStreak={stats.currentStreak}
        stats={{
          totalHours: stats.totalHours,
          coveredHours: stats.coveredHours,
          aiMultiplier: stats.aiMultiplier,
          peakConcurrency: stats.peakConcurrency,
        }}
        showPublic={globalShowPublic}
        onClose={() => setSelectedStatCard(null)}
      />

      {!isControlledTab && <TabBar activeTab={activeTab} onTabChange={setActiveTab} />}

      {activeTab === 'sessions' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between px-1 pt-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-bold text-text-muted uppercase tracking-widest">
                Activity Feed
              </h2>
              <MetricChip
                value={`${displaySessionCount}`}
                label="Prompts"
                title="Prompts"
                description="Your direct messages to the AI plus any subagent calls it spawned — each one counts as a prompt."
              />
              {feedMetrics && (
                <>
                  <MetricChip
                    value={feedMetrics.promptQuality.toFixed(1)}
                    label="Prompt_Quality"
                    title="Prompt Quality"
                    description="How well-crafted were your prompts? Considers clarity, specificity, and whether they gave the AI everything needed to succeed on the first try."
                  />
                  <MetricChip
                    value={feedMetrics.context.toFixed(1)}
                    label="Context"
                    title="Context"
                    description="Did you give the AI enough detail in your prompt — like file names, error messages, or what you've already tried?"
                  />
                  <MetricChip
                    value={feedMetrics.scope.toFixed(1)}
                    label="Scope"
                    title="Scope"
                    description="Did the AI clearly know what to work on — which files, which feature, which boundaries — without having to guess?"
                  />
                  <MetricChip
                    value={feedMetrics.independence.toFixed(1)}
                    label="Independence"
                    title="Independence"
                    description="How much did the AI handle on its own? High means it completed the task without needing corrections or follow-ups."
                  />
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setGlobalShowPublic((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border transition-all duration-200 ${
                  globalShowPublic
                    ? 'bg-success/10 border-success/30 text-success'
                    : 'bg-bg-surface-1 border-border/50 text-text-muted hover:text-text-primary hover:border-text-muted/50'
                }`}
                title={globalShowPublic ? 'Showing public titles' : 'Showing private titles'}
              >
                {globalShowPublic ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline text-xs font-medium">
                  {globalShowPublic ? 'Public' : 'Private'}
                </span>
              </button>
              <button
                onClick={() => setShowFilters((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border transition-all duration-200 ${
                  showFilters || hasActiveFilter
                    ? 'bg-accent/10 border-accent/30 text-accent'
                    : 'bg-bg-surface-1 border-border/50 text-text-muted hover:text-text-primary hover:border-text-muted/50'
                }`}
              >
                <Filter className="w-3.5 h-3.5" />
                <span className="hidden sm:inline text-xs font-medium">Filters</span>
              </button>
            </div>
          </div>

          {showFilters && (
            <FilterChips sessions={filteredSessions} filters={filters} onFilterChange={setFilter} />
          )}

          <SessionList
            preGrouped={feedConversations as unknown as import('../lib/stats').ConversationGroup[]}
            filters={filters}
            globalShowPublic={globalShowPublic}
            showFullDate
            outsideWindowCounts={outsideWindowCounts}
            onNavigateNewer={handleNavigateNewer}
            onNavigateOlder={handleNavigateOlder}
            onDeleteSession={onDeleteSession}
            onDeleteConversation={onDeleteConversation}
            onDeleteMilestone={onDeleteMilestone}
            onLoadMore={handleLoadMore}
            hasMore={feedHasMore}
          />
        </div>
      )}

      {activeTab === 'insights' && (
        <div className="space-y-4 pt-2">
          <DailyRecap
            sessions={displaySessions}
            milestones={filteredMilestones}
            isLive={isLive}
            windowStart={windowStart}
            windowEnd={windowEnd}
            allSessions={sessions}
            allMilestones={milestones}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ProjectAllocation byProjectClock={stats.byProjectClock} byProject={stats.byProject} />
            <ComplexityDistribution data={complexityData} milestones={filteredMilestones} showPublic={globalShowPublic} />
            <SummaryChips stats={stats} />
          </div>

          <TaskTypeBreakdown byTaskType={stats.byTaskType} byTaskTypeAI={stats.byTaskTypeAI} sessions={filteredSessions} milestones={filteredMilestones} showPublic={globalShowPublic} />

          <ActivityStrip
            sessions={sessions}
            timeScale={timeScale}
            effectiveTime={effectiveTime}
            isLive={isLive}
            onDayClick={handleDayClick}
            highlightDate={highlightDate}
          />

          <RecentMilestones milestones={filteredMilestones} showPublic={globalShowPublic} />
        </div>
      )}
    </div>
  );
}
