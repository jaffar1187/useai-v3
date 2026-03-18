import { randomUUID } from "node:crypto";

/** Idle gap threshold: gaps longer than this between heartbeats are counted as idle time. */
export const IDLE_GAP_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Global registry of active child sessions keyed by promptId.
 * Child sessions are registered here when created so they remain findable
 * even after the parent's concurrentChildren map is reset by a new root useai_start.
 */
export const globalSessionRegistry = new Map<string, PromptContext>();

export interface PromptContext {
  promptId: string;
  connectionId: string;
  prevHash: string;
  startedAt: Date | null;
  /** Timestamp (ms) of the last heartbeat call. Null if no heartbeat has fired yet. */
  lastActivityTime: number | null;
  /** Accumulated idle ms detected via heartbeat gaps. */
  idleMs: number;
  /** Active time segments as [startMs, endMs] pairs. Used for accurate User Time union in dashboard. */
  activeSegments: [number, number][];
  client: string;
  taskType: string;
  title: string | null;
  privateTitle: string | null;
  project: string | null;
  model: string | null;
  prompt: string | null;
  promptImages: Array<{ type: "image"; description: string }> | null;
  // ---- v3: session nesting ----
  /** @deprecated Use concurrentChildren + activeChildStack instead. Kept for type compat. */
  parentStack: SavedPromptContext[];
  /** Total milliseconds spent in child sessions — subtracted from this session's duration. */
  childPausedMs: number;
  /** 0 = root session, 1+ = nested child. */
  sessionDepth: number;
  // ---- v3.1: concurrent child sessions ----
  /** Map of concurrent child sessions, keyed by promptId. */
  concurrentChildren: Map<string, PromptContext>;
  /** Stack of active child session IDs for backward compat (LIFO). Top = most recent child. */
  activeChildStack: string[];
}

/**
 * Snapshot of a parent PromptContext saved before a child session starts.
 * @deprecated Kept for type compatibility. New code uses concurrentChildren map.
 */
export interface SavedPromptContext {
  promptId: string;
  connectionId: string;
  prevHash: string;
  startedAt: Date;
  lastActivityTime: number | null;
  idleMs: number;
  activeSegments: [number, number][];
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
    activeSegments: [],
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
    concurrentChildren: new Map(),
    activeChildStack: [],
  };
}

/**
 * Create a child PromptContext for a concurrent nested session.
 * The child inherits connection/chain/client from the parent but gets its own tracking state.
 */
export function createChildContext(
  parent: PromptContext,
  overrides: {
    client?: string | undefined;
    taskType?: string | undefined;
    title?: string | null | undefined;
    privateTitle?: string | null | undefined;
    project?: string | null | undefined;
    model?: string | null | undefined;
    prompt?: string | null | undefined;
    promptImages?:
      | Array<{ type: "image"; description: string }>
      | null
      | undefined;
  },
): PromptContext {
  const now = new Date();
  return {
    promptId: `prompt_${randomUUID()}`,
    connectionId: parent.connectionId,
    prevHash: parent.prevHash,
    startedAt: now,
    lastActivityTime: null,
    idleMs: 0,
    activeSegments: [[now.getTime(), now.getTime()]],
    client: overrides.client ?? parent.client,
    taskType: overrides.taskType ?? "other",
    title: overrides.title ?? null,
    privateTitle: overrides.privateTitle ?? null,
    project: overrides.project ?? parent.project,
    model: overrides.model ?? parent.model,
    prompt: overrides.prompt ?? null,
    promptImages: overrides.promptImages ?? null,
    parentStack: [],
    childPausedMs: 0,
    sessionDepth: parent.sessionDepth + 1,
    concurrentChildren: new Map(),
    activeChildStack: [],
  };
}

/**
 * Resolve which session context to operate on.
 * - If sessionId is provided, look it up in the root's concurrentChildren map.
 * - If not provided, return the most recently started child (top of activeChildStack),
 *   or the root ctx itself if no children are active.
 */
export function resolveSession(
  rootCtx: PromptContext,
  promptId?: string,
): PromptContext | null {
  if (promptId) {
    if (rootCtx.promptId === promptId) return rootCtx;
    const child = rootCtx.concurrentChildren.get(promptId);
    if (child) return child;
    // Fall back to global registry for orphaned children (e.g. parent was reset by a new root session)
    return globalSessionRegistry.get(promptId) ?? null;
  } else return null;
}

/**
 * Remove a finished child session from the root context's tracking.
 * Accumulates child duration into root's childPausedMs and updates prevHash for chain continuity.
 */
export function removeChildSession(
  rootCtx: PromptContext,
  childId: string,
  childDurationMs: number,
  childHash: string,
): void {
  rootCtx.concurrentChildren.delete(childId);
  const idx = rootCtx.activeChildStack.indexOf(childId);
  if (idx !== -1) rootCtx.activeChildStack.splice(idx, 1);
  rootCtx.childPausedMs += childDurationMs;
  rootCtx.prevHash = childHash; // chain continuity
  // Reset lastActivityTime so the parent doesn't see the child's duration as idle
  rootCtx.lastActivityTime = Date.now();
}

/**
 * Return the IDs of all active sessions (root + concurrent children).
 * Used to protect sessions from orphan sweeps.
 */
export function getActiveSessionIds(ctx: PromptContext): string[] {
  return [ctx.promptId, ...ctx.concurrentChildren.keys()];
}

/** @deprecated Use getActiveSessionIds instead. Kept for export compat. */
export function getParentSessionIds(ctx: PromptContext): string[] {
  return [...ctx.concurrentChildren.keys()];
}

/**
 * @deprecated Use createChildContext + concurrentChildren map instead.
 * Kept for reference — no longer called by tools.
 */
export function saveParentState(ctx: PromptContext): void {
  const saved: SavedPromptContext = {
    promptId: ctx.promptId,
    connectionId: ctx.connectionId,
    prevHash: ctx.prevHash,
    startedAt: ctx.startedAt!,
    lastActivityTime: ctx.lastActivityTime,
    idleMs: ctx.idleMs,
    activeSegments: ctx.activeSegments,
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
 * @deprecated Use removeChildSession instead.
 * Kept for reference — no longer called by tools.
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
  ctx.prevHash = childHash;
  ctx.startedAt = saved.startedAt;
  ctx.lastActivityTime = now;
  ctx.idleMs = saved.idleMs + pausedGapMs;
  ctx.activeSegments = saved.activeSegments;
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
 * Record activity at the given timestamp (defaults to now).
 * If the gap since the last activity exceeds the idle threshold, the gap is
 * accumulated as idle time and the current active segment is closed.
 * Used by both the heartbeat tool and useai_end.
 */
export function touchActivity(
  ctx: PromptContext,
  now: number = Date.now(),
): void {
  const baseline = ctx.lastActivityTime || ctx.startedAt?.getTime() || 0;
  const gap = now - baseline;
  if (gap > IDLE_GAP_THRESHOLD_MS) {
    ctx.idleMs += gap;
    // Close the current segment at the last known activity time
    if (ctx.activeSegments.length > 0) {
      const last = ctx.activeSegments[ctx.activeSegments.length - 1]!;
      last[1] = baseline;
    }
    // // Start a new segment at the current time
    // ctx.activeSegments.push([now, now]);
  } else if (ctx.activeSegments.length > 0) {
    // Extend the current segment
    ctx.activeSegments[ctx.activeSegments.length - 1]![1] = now;
  }

  ctx.lastActivityTime = now;
}

/**
 * Return finalized active segments as ISO pairs for storage.
 * Ensures the last segment is closed at the given end time.
 */
export function finalizeActiveSegments(ctx: PromptContext): [string, string][] {
  return ctx.activeSegments.map(([start, end]) => [
    new Date(start).toISOString(),
    new Date(end).toISOString(),
  ]);
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
  const durationMs =
    (lastActivityTime ?? startedAt.getTime()) - startedAt.getTime();
  return Math.max(0, durationMs - idleMs - childPausedMs);
}
