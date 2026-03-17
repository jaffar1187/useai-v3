import { getConfig, saveConfig, readSessionsForRange } from "@devness/useai-storage";
import { syncSessions } from "@devness/useai-cloud";

const MIN_INTERVAL_MS = 5 * 60 * 1000; // floor: 5 minutes

let schedulerHandle: NodeJS.Timeout | null = null;

async function runSync(): Promise<void> {
  let config;
  try {
    config = await getConfig();
  } catch {
    return;
  }

  if (!config.sync.autoSync || !config.sync.enabled) return;

  const token = config.auth.token;
  if (!token) return;

  let sessions;
  try {
    sessions = await readSessionsForRange(30);
  } catch {
    return;
  }

  if (sessions.length === 0) return;

  try {
    const result = await syncSessions(token, sessions, config);
    if (result.synced > 0) {
      await saveConfig({ ...config, lastSyncAt: new Date().toISOString() });
      console.log(`[useai sync] Synced ${result.synced} sessions (skipped: ${result.skipped}, errors: ${result.errors})`);
    }
  } catch (err) {
    console.error("[useai sync] Sync failed:", err);
  }
}

/**
 * Start the background sync scheduler.
 * Reads `config.sync.intervalMinutes` on each tick so config changes take effect
 * without restarting the daemon.
 *
 * Returns a stop function.
 */
export function startSyncScheduler(): () => void {
  if (schedulerHandle) return () => stopSyncScheduler();

  // Run once shortly after startup, then on interval
  const startupDelay = setTimeout(() => {
    runSync().catch(() => {});
    scheduleNext();
  }, 30_000); // 30s after daemon start

  let nextHandle: NodeJS.Timeout | null = null;

  function scheduleNext(): void {
    getConfig()
      .then((config) => {
        const intervalMs = Math.max(
          config.sync.intervalMinutes * 60_000,
          MIN_INTERVAL_MS,
        );
        nextHandle = setTimeout(() => {
          runSync().catch(() => {});
          scheduleNext();
        }, intervalMs);
        schedulerHandle = nextHandle;
      })
      .catch(() => {
        // Default to 30min if config unreadable
        nextHandle = setTimeout(() => {
          runSync().catch(() => {});
          scheduleNext();
        }, 30 * 60_000);
        schedulerHandle = nextHandle;
      });
  }

  return () => {
    clearTimeout(startupDelay);
    if (nextHandle) clearTimeout(nextHandle);
    schedulerHandle = null;
  };
}

export function stopSyncScheduler(): void {
  if (schedulerHandle) {
    clearTimeout(schedulerHandle);
    schedulerHandle = null;
  }
}
