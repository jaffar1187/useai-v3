import { useEffect } from "react";
import { useStore } from "../store.js";
import { formatDate } from "../lib/stats.js";

const CATEGORY_ICONS: Record<string, string> = {
  feature: "✨",
  bugfix: "🐛",
  fix: "🔧",
  refactor: "♻️",
  test: "🧪",
  testing: "🧪",
  docs: "📝",
  documentation: "📝",
  setup: "🔨",
  deployment: "🚀",
  devops: "⚙️",
  config: "⚙️",
  performance: "⚡",
  security: "🔒",
  migration: "🔄",
  design: "🎨",
  research: "🔍",
  analysis: "📊",
  cleanup: "🧹",
  chore: "🧹",
  other: "📌",
};

const CATEGORY_COLORS: Record<string, string> = {
  feature: "badge-violet",
  bugfix: "badge-red",
  fix: "badge-red",
  refactor: "badge-amber",
  test: "badge-blue",
  testing: "badge-blue",
  docs: "badge-slate",
  documentation: "badge-slate",
  setup: "badge-slate",
  deployment: "badge-green",
  devops: "badge-slate",
  config: "badge-slate",
  performance: "badge-amber",
  security: "badge-red",
  migration: "badge-amber",
  design: "badge-violet",
  research: "badge-green",
  analysis: "badge-blue",
  cleanup: "badge-slate",
  chore: "badge-slate",
  other: "badge-slate",
};

export function MilestonesList() {
  const { milestones, loading, loadMilestones } = useStore();

  useEffect(() => {
    if (milestones.length === 0) void loadMilestones();
  }, [milestones.length, loadMilestones]);

  if (loading && milestones.length === 0) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card animate-pulse h-16 bg-slate-800/40" />
        ))}
      </div>
    );
  }

  if (milestones.length === 0) {
    return (
      <div className="card py-12 text-center">
        <p className="text-slate-400">No milestones found for this period.</p>
        <p className="mt-1 text-sm text-slate-600">
          Milestones are recorded during useai sessions.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {milestones.map((m) => (
        <div
          key={m.id}
          className="flex items-start gap-3 rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-3 transition-colors hover:bg-slate-800"
        >
          <span className="mt-0.5 text-base">{CATEGORY_ICONS[m.category] ?? "📌"}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-100">{m.title}</p>
            {m.privateTitle && (
              <p className="mt-0.5 truncate text-xs text-slate-500">{m.privateTitle}</p>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className={`badge ${CATEGORY_COLORS[m.category] ?? "badge-slate"}`}>
                {m.category}
              </span>
              {m.complexity !== "medium" && (
                <span className="badge badge-slate">{m.complexity}</span>
              )}
              <span className="text-xs text-slate-500">{m.client}</span>
              {m.project && <span className="text-xs text-slate-600">· {m.project}</span>}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xs text-slate-500">{formatDate(m.createdAt)}</p>
            <p className="mt-0.5 text-xs text-slate-600">{m.durationMinutes}m</p>
          </div>
        </div>
      ))}
    </div>
  );
}
