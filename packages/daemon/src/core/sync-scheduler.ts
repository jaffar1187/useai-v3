import { getConfig, saveConfig } from "@devness/useai-storage";
import { DAEMON_URL } from "@devness/useai-storage/paths";
import { syncPrompts } from "@devness/useai-cloud";
import type { Session } from "@devness/useai-types";

const MIN_INTERVAL_MS = 5 * 60 * 1000; // floor: 5 minutes

let schedulerHandle: NodeJS.Timeout | null = null;

async function fetchPrompts(days: number): Promise<Session[]> {
  const start = new Date(Date.now() - days * 86400000).toISOString();
  const end = new Date().toISOString();
  const all: Session[] = [];
  let offset = 0;
  const limit = 50;

  while (true) {
    const params = new URLSearchParams({ start, end, offset: String(offset), limit: String(limit) });
    const res = await fetch(`${DAEMON_URL}/api/local/prompts?${params}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) break;
    const json = await res.json() as {
      conversations: Array<{ sessions: Array<{ session: Session }> }>;
      has_more: boolean;
    };
    for (const conv of json.conversations) {
      for (const sg of conv.sessions) {
        all.push(sg.session);
      }
    }
    if (!json.has_more) break;
    offset += limit;
  }

  return all;
}

async function runSync(): Promise<void> {
  let config;
  try {
    config = await getConfig();
  } catch {
    return;
  }

  if (!config.sync.autoSync) return;

  const token = config.auth.token;
  if (!token) return;

  let sessions;
  try {
    sessions = await fetchPrompts(30);
  } catch {
    return;
  }

  if (sessions.length === 0) return;

  try {
    const result = await syncPrompts(token, sessions, config);
    if (result.synced > 0) {
      await saveConfig({ ...config, lastSyncAt: new Date().toISOString() });
    }
    if (result.synced > 0 || result.errors > 0) {
      console.log(`[useai sync] Synced ${result.synced} prompts (skipped: ${result.skipped}, errors: ${result.errors})`);
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
