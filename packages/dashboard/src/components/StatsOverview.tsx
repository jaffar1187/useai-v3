import { useStore } from "../store.js";
import { formatScore } from "../lib/stats.js";

interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}

function StatCard({ label, value, sub, accent }: StatCardProps) {
  return (
    <div className="card flex flex-col gap-1">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={["text-2xl font-bold", accent ? "text-violet-300" : "text-slate-50"].join(" ")}>
        {value}
      </p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function MiniBar({ items, total }: { items: { name: string; count: number }[]; total: number }) {
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.name} className="flex items-center gap-2">
          <span className="w-24 truncate text-xs text-slate-400">{item.name}</span>
          <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-slate-700">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-violet-500"
              style={{ width: `${(item.count / total) * 100}%` }}
            />
          </div>
          <span className="w-6 text-right text-xs text-slate-400">{item.count}</span>
        </div>
      ))}
    </div>
  );
}

function ActivityChart({ byDay }: { byDay: { date: string; hours: number; sessions: number }[] }) {
  const maxHours = Math.max(...byDay.map((d) => d.hours), 0.1);
  const recent = byDay.slice(-30);

  return (
    <div className="card">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">
        Daily activity
      </p>
      <div className="flex h-20 items-end gap-0.5">
        {recent.map((d) => (
          <div
            key={d.date}
            className="group relative flex-1"
            title={`${d.date}: ${d.sessions} sessions, ${d.hours.toFixed(1)}h`}
          >
            <div
              className="w-full rounded-sm bg-violet-600/70 transition-colors group-hover:bg-violet-400"
              style={{ height: `${Math.max((d.hours / maxHours) * 100, 4)}%` }}
            />
          </div>
        ))}
      </div>
      <p className="mt-2 text-right text-xs text-slate-600">← {recent.length} days</p>
    </div>
  );
}

export function StatsOverview() {
  const { stats, loading } = useStore();

  if (loading && !stats) {
    return (
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card animate-pulse h-20 bg-slate-800/40" />
        ))}
      </div>
    );
  }

  if (!stats) return null;

  const hoursStr =
    stats.totalHours >= 1
      ? `${stats.totalHours.toFixed(1)}h`
      : `${Math.round(stats.totalHours * 60)}m`;

  return (
    <div className="space-y-4">
      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label="Sessions"
          value={String(stats.totalSessions)}
        />
        <StatCard
          label="Total time"
          value={hoursStr}
          sub={`avg ${Math.round(stats.avgDurationMinutes)}m/session`}
        />
        <StatCard
          label="Avg score"
          value={stats.averageScore > 0 ? formatScore(stats.averageScore) : "—"}
          sub="out of 100"
          accent
        />
        <StatCard
          label="Streak"
          value={`${stats.currentStreak}d`}
          sub={`longest ${stats.longestStreak}d`}
        />
        <StatCard
          label="Milestones"
          value={String(stats.totalMilestones)}
          sub="across all sessions"
        />
      </div>

      {/* Activity chart */}
      {stats.byDay.length > 0 && <ActivityChart byDay={stats.byDay} />}

      {/* Breakdowns */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {stats.topClients.length > 0 && (
          <div className="card">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">
              By tool
            </p>
            <MiniBar items={stats.topClients} total={stats.totalSessions} />
          </div>
        )}
        {stats.topTaskTypes.length > 0 && (
          <div className="card">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">
              By task type
            </p>
            <MiniBar items={stats.topTaskTypes} total={stats.totalSessions} />
          </div>
        )}
      </div>
    </div>
  );
}
