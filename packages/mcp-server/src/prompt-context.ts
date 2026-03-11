import { randomUUID } from "node:crypto";

/** Idle gap threshold: gaps longer than this between heartbeats are counted as idle time. */
export const IDLE_GAP_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

export interface PromptContext {
  promptId: string;
  connectionId: string;
  prevHash: string;
  startedAt: Date | null;
  /** Timestamp (ms) of the last heartbeat call. Null if no heartbeat has fired yet. */
  lastActivityTime: number | null;
  /** Accumulated idle ms detected via heartbeat gaps. */
  idleMs: number;
  client: string;
  taskType: string;
  title: string | null;
  privateTitle: string | null;
  project: string | null;
  model: string | null;
  prompt: string | null;
  promptImages: Array<{ type: "image"; description: string }> | null;
  // ---- v3: session nesting ----
  /** Stack of saved parent contexts. Depth > 0 means we are inside a nested session. */
  parentStack: SavedPromptContext[];
  /** Total milliseconds spent in child sessions — subtracted from this session's duration. */
  childPausedMs: number;
  /** 0 = root session, 1+ = nested child. */
  sessionDepth: number;
}

/**
 * Snapshot of a parent PromptContext saved before a child session starts.
 * Includes nesting bookkeeping fields.
 */
export interface SavedPromptContext {
  promptId: string;
  connectionId: string;
  prevHash: string;
  startedAt: Date;
  lastActivityTime: number | null;
  idleMs: number;
  client: string;
  taskType: string;
  title: string | null;
  privateTitle: string | null;
  project: string | null;
  model: string | null;
  prompt: string | null;
  promptImages: Array<{ type: "image"; description: string }> | null;
  childPausedMs: number;
  /** Wall-clock ms when this parent was paused (child started). */
  pausedAt: number;
}

export function createPromptContext(): PromptContext {
  return {
    promptId: `prompt_${randomUUID()}`,
    connectionId: "",
    prevHash: "0".repeat(64),
    startedAt: null,
    lastActivityTime: null,
    idleMs: 0,
    client: "",
    taskType: "",
    title: null,
    privateTitle: null,
    project: null,
    model: null,
    prompt: null,
    promptImages: null,
    parentStack: [],
    childPausedMs: 0,
    sessionDepth: 0,
  };
}

/**
 * Save the current context onto the parent stack before starting a nested child.
 * The caller must then reset session-specific fields on ctx.
 */
export function saveParentState(ctx: PromptContext): void {
  const saved: SavedPromptContext = {
    promptId: ctx.promptId,
    connectionId: ctx.connectionId,
    prevHash: ctx.prevHash,
    startedAt: ctx.startedAt!,
    lastActivityTime: ctx.lastActivityTime,
    idleMs: ctx.idleMs,
    client: ctx.client,
    taskType: ctx.taskType,
    title: ctx.title,
    privateTitle: ctx.privateTitle,
    project: ctx.project,
    model: ctx.model,
    prompt: ctx.prompt,
    promptImages: ctx.promptImages,
    childPausedMs: ctx.childPausedMs,
    pausedAt: Date.now(),
  };
  ctx.parentStack.push(saved);
}

/**
 * Pop the parent state back, incorporating the just-finished child session.
 * - Parent's prevHash becomes the child's final hash (chain continuity).
 * - childPausedMs accumulates the child's duration.
 * - idleMs absorbs the paused gap to prevent false idle detection.
 */
export function restoreParentState(
  ctx: PromptContext,
  childDurationMs: number,
  childHash: string,
): void {
  const saved = ctx.parentStack.pop();
  if (!saved) return;

  const now = Date.now();
  const pausedGapMs = now - saved.pausedAt;

  ctx.promptId = saved.promptId;
  ctx.connectionId = saved.connectionId;
  ctx.prevHash = childHash; // chain: parent's prevHash is now child's final hash
  ctx.startedAt = saved.startedAt;
  ctx.lastActivityTime = now; // reset to now so no idle gap is recorded for the paused period
  ctx.idleMs = saved.idleMs + pausedGapMs; // absorb paused gap into idle (childPausedMs handles the correction)
  ctx.client = saved.client;
  ctx.taskType = saved.taskType;
  ctx.title = saved.title;
  ctx.privateTitle = saved.privateTitle;
  ctx.project = saved.project;
  ctx.model = saved.model;
  ctx.prompt = saved.prompt;
  ctx.promptImages = saved.promptImages;
  ctx.childPausedMs = saved.childPausedMs + childDurationMs;
  ctx.sessionDepth--;
}

/**
 * Return the IDs of all parent sessions currently on the stack.
 * Used to protect parent sessions from orphan sweeps.
 */
export function getParentSessionIds(ctx: PromptContext): string[] {
  return ctx.parentStack.map((s) => s.promptId);
}

/**
 * Record activity at the given timestamp (defaults to now).
 * If the gap since the last activity exceeds the idle threshold, the gap is
 * accumulated as idle time. Used by both the heartbeat tool and useai_end.
 */
export function touchActivity(
  ctx: PromptContext,
  now: number = Date.now(),
): void {
  const baseline = ctx.lastActivityTime ?? ctx.startedAt?.getTime() ?? null;
  if (baseline !== null) {
    const gap = now - baseline;
    if (gap > IDLE_GAP_THRESHOLD_MS) {
      ctx.idleMs += gap;
    }
  }
  ctx.lastActivityTime = now;
}

/**
 * Compute honest active duration, excluding idle gaps and child session time.
 */
export function getActiveDurationMs(
  startedAt: Date,
  lastActivityTime: number | null,
  idleMs: number,
  childPausedMs: number,
): number {
  const wallMs = (lastActivityTime ?? startedAt.getTime()) - startedAt.getTime();
  return Math.max(0, wallMs - idleMs - childPausedMs);
}
