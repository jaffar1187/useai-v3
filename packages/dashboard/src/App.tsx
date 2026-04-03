import { useEffect, useState } from "react";
import { useDashboardStore } from "./store";
import { Header } from "./components/Header";
import { DashboardBody } from "./components/DashboardBody";
import { SearchOverlay } from "./components/SearchOverlay";
import { SettingsPage } from "./components/SettingsPage";
import { FaqsPage } from "./components/FaqsPage";

export function App() {
  const {
    config,
    health,
    updateInfo,
    loading,
    loadAll,
    loadHealth,
    loadUpdateCheck,
    deleteSession,
    deleteConversation,
    deleteMilestone,
    activeTab,
    setActiveTab,
  } = useDashboardStore();

  // Load data on mount
  useEffect(() => {
    loadAll();
    loadHealth();
    loadUpdateCheck();
  }, [loadAll, loadHealth, loadUpdateCheck]);

  // Auto-refresh every 30s
  useEffect(() => {
    const healthInterval = setInterval(loadHealth, 30000);
    const dataInterval = setInterval(loadAll, 30000);
    return () => {
      clearInterval(healthInterval);
      clearInterval(dataInterval);
    };
  }, [loadAll, loadHealth]);

  const [searchOpen, setSearchOpen] = useState(false);

  // Cmd+K / Ctrl+K to open search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-text-muted text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-base selection:bg-accent/30 selection:text-text-primary">
      <Header
        health={health}
        updateInfo={updateInfo}
        onSearchOpen={() => setSearchOpen(true)}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        config={config}
        onRefresh={loadAll}
      />
      <div className="max-w-[1240px] mx-auto px-4 sm:px-6 pb-6">
        {activeTab === "faqs" ? (
          <FaqsPage />
        ) : activeTab === "settings" ? (
          <SettingsPage onTabChange={setActiveTab as (tab: string) => void} />
        ) : (
          <>
            <SearchOverlay
              open={searchOpen}
              onClose={() => setSearchOpen(false)}
              onDeleteSession={deleteSession}
              onDeleteConversation={deleteConversation}
              onDeleteMilestone={deleteMilestone}
            />

            <DashboardBody
              useStore={useDashboardStore}
              onDeleteSession={deleteSession}
              onDeleteConversation={deleteConversation}
              onDeleteMilestone={deleteMilestone}
              activeTab={activeTab}
              onActiveTabChange={setActiveTab}
            />
          </>
        )}
      </div>
    </div>
  );
}
