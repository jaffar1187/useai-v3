import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawn } from "node:child_process";
import { DAEMON_URL, DAEMON_PID_FILE, DAEMON_LOG_FILE } from "@devness/useai-storage/paths";

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  uptime?: number;
  activeSessions?: number;
  version?: string;
  url: string;
}

export async function getDaemonStatus(): Promise<DaemonStatus> {
  try {
    const res = await fetch(`${DAEMON_URL}/health`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const json = await res.json() as { uptime?: number; activeSessions?: number; version?: string };
      const pid = readPid();
      return {
        running: true,
        url: DAEMON_URL,
        ...(pid !== undefined && { pid }),
        ...(json.uptime !== undefined && { uptime: json.uptime }),
        ...(json.activeSessions !== undefined && { activeSessions: json.activeSessions }),
        ...(json.version !== undefined && { version: json.version }),
      };
    }
  } catch { /* not running */ }
  return { running: false, url: DAEMON_URL };
}

export function readPid(): number | undefined {
  try {
    if (!existsSync(DAEMON_PID_FILE)) return undefined;
    return parseInt(readFileSync(DAEMON_PID_FILE, "utf-8").trim(), 10);
  } catch {
    return undefined;
  }
}

export function startDaemonProcess(): void {
  const child = spawn("useai-daemon", [], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    env: { ...process.env },
  });
  child.unref();
  if (child.pid) {
    writeFileSync(DAEMON_PID_FILE, String(child.pid), "utf-8");
  }
}

export function stopDaemonProcess(): boolean {
  const pid = readPid();
  if (!pid) return false;
  try {
    process.kill(pid, "SIGTERM");
    if (existsSync(DAEMON_PID_FILE)) unlinkSync(DAEMON_PID_FILE);
    return true;
  } catch {
    if (existsSync(DAEMON_PID_FILE)) unlinkSync(DAEMON_PID_FILE);
    return false;
  }
}

export function getDaemonLogPath(): string {
  return DAEMON_LOG_FILE;
}
