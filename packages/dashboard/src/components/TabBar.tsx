import { useStore, type ActiveTab } from "../store.js";

const TABS: { id: ActiveTab; label: string; icon: string }[] = [
  { id: "stats", label: "Stats", icon: "📊" },
  { id: "sessions", label: "Sessions", icon: "💬" },
  { id: "milestones", label: "Milestones", icon: "🏆" },
  { id: "settings", label: "Settings", icon: "⚙️" },
];

export function TabBar() {
  const { activeTab, setTab } = useStore();

  return (
    <div className="flex gap-1 border-b border-slate-700 bg-slate-900/80 px-4">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => setTab(tab.id)}
          className={[
            "flex items-center gap-1.5 border-b-2 px-4 py-3 text-sm font-medium transition-colors",
            activeTab === tab.id
              ? "border-violet-500 text-violet-300"
              : "border-transparent text-slate-400 hover:text-slate-200",
          ].join(" ")}
        >
          <span>{tab.icon}</span>
          {tab.label}
        </button>
      ))}
    </div>
  );
}
