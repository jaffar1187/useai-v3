import { useStore } from "../store.js";
import { ProfileDropdown } from "./ProfileDropdown.js";

const RANGE_OPTIONS = [7, 14, 30] as const;

export function Header() {
  const { daysRange, setDaysRange } = useStore();

  return (
    <header className="flex items-center justify-between border-b border-slate-700 bg-slate-900/80 px-5 py-3 backdrop-blur">
      <div className="flex items-center gap-3">
        <span className="text-lg font-bold tracking-tight text-slate-50">
          <span className="text-violet-400">use</span>ai
        </span>
        <span className="hidden text-xs text-slate-500 sm:inline">AI session tracker</span>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex rounded-lg border border-slate-700 bg-slate-800 p-0.5">
          {RANGE_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => setDaysRange(d)}
              className={[
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                daysRange === d
                  ? "bg-violet-600 text-white"
                  : "text-slate-400 hover:text-slate-200",
              ].join(" ")}
            >
              {d}d
            </button>
          ))}
        </div>
        <ProfileDropdown />
      </div>
    </header>
  );
}
