export { createApp } from "./router.js";
export { startDaemon } from "./app.js";
export { startSyncScheduler, stopSyncScheduler } from "./sync-scheduler.js";
export {
  installAutostart,
  uninstallAutostart,
  isAutostartEnabled,
  getAutostartPlatform,
} from "./autostart.js";
export type { AutostartPlatform } from "./autostart.js";
