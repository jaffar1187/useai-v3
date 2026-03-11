import { useEffect } from "react";
import { useStore } from "./store.js";
import { Header } from "./components/Header.js";
import { TabBar } from "./components/TabBar.js";
import { StatsOverview } from "./components/StatsOverview.js";
import { SessionsList } from "./components/SessionsList.js";
import { MilestonesList } from "./components/MilestonesList.js";
import { SettingsPage } from "./components/SettingsPage.js";

function DaemonError() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <p className="text-4xl">⚡</p>
      <h2 className="text-lg font-semibold text-slate-200">Daemon not running</h2>
      <p className="max-w-sm text-sm text-slate-400">
        Start the useai daemon to see your session data.
      </p>
      <code className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-violet-300">
        useai daemon start
      </code>
    </div>
  );
}

export function App() {
  const { activeTab, loadAll, error } = useStore();

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Header />
      <TabBar />

      <main className="flex-1 overflow-y-auto">
        {error ? (
          <div className="mx-auto max-w-4xl px-4 pt-6">
            <DaemonError />
          </div>
        ) : (
          <div className="mx-auto max-w-5xl px-4 py-5">
            {activeTab === "stats" && <StatsOverview />}
            {activeTab === "sessions" && <SessionsList />}
            {activeTab === "milestones" && <MilestonesList />}
            {activeTab === "settings" && <SettingsPage />}
          </div>
        )}
      </main>
    </div>
  );
}
