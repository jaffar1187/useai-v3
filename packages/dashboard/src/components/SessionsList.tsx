import { useStore } from "../store.js";
import { formatDuration, formatDate } from "../lib/stats.js";

const CATEGORY_COLORS: Record<string, string> = {
  coding: "badge-violet",
  debugging: "badge-red",
  testing: "badge-blue",
  planning: "badge-amber",
  reviewing: "badge-blue",
  documenting: "badge-slate",
  learning: "badge-green",
  research: "badge-green",
  migration: "badge-amber",
  design: "badge-violet",
  refactoring: "badge-amber",
  default: "badge-slate",
};

function taskBadgeClass(taskType: string): string {
  return CATEGORY_COLORS[taskType] ?? CATEGORY_COLORS["default"]!;
}

function ScorePill({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = pct >= 80 ? "text-green-400" : pct >= 60 ? "text-yellow-400" : "text-red-400";
  return <span className={`text-xs font-semibold tabular-nums ${color}`}>{pct}</span>;
}

export function SessionsList() {
  const { sessions, loading } = useStore();

  if (loading && sessions.length === 0) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card animate-pulse h-14 bg-slate-800/40" />
        ))}
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="card py-12 text-center">
        <p className="text-slate-400">No sessions found for this period.</p>
        <p className="mt-1 text-sm text-slate-600">Start a session in your AI tool to see data here.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-700">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-700 bg-slate-800/60 text-left">
            <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-slate-400">
              Date
            </th>
            <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-slate-400">
              Task
            </th>
            <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-slate-400">
              Tool
            </th>
            <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-slate-400">
              Duration
            </th>
            <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-slate-400">
              Score
            </th>
            <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-slate-400">
              Milestones
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700/50">
          {sessions.map((s) => (
            <tr key={s.promptId} className="transition-colors hover:bg-slate-800/40">
              <td className="px-4 py-3 text-xs text-slate-400">
                {formatDate(s.endedAt ?? s.startedAt ?? "")}
              </td>
              <td className="max-w-[200px] px-4 py-3">
                <span className={`badge ${taskBadgeClass(s.taskType)}`}>{s.taskType}</span>
              </td>
              <td className="px-4 py-3 text-xs text-slate-300">{s.client}</td>
              <td className="px-4 py-3 text-xs tabular-nums text-slate-300">
                {formatDuration(s.durationMs)}
              </td>
              <td className="px-4 py-3">
                {s.score ? <ScorePill score={s.score.overall} /> : <span className="text-xs text-slate-600">—</span>}
              </td>
              <td className="px-4 py-3 text-xs text-slate-400">
                {s.milestones?.length ?? 0}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
