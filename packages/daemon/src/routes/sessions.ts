import { Hono } from "hono";
import type { Session } from "@devness/useai-types";
import { readSessionsForRange, readV1Sessions, readV1Milestones, deleteSession } from "@devness/useai-storage";

export const sessionsRoutes = new Hono();

// Maps v3 camelCase Session → dashboard snake_case SessionSeal
function toSessionSeal(s: Session) {
  return {
    session_id: s.promptId,
    ...(s.connectionId && { conversation_id: s.connectionId }),
    client: s.client,
    task_type: s.taskType,
    languages: s.languages ?? [],
    files_touched: s.filesTouchedCount ?? 0,
    ...(s.project && { project: s.project }),
    title: s.title,
    ...(s.privateTitle && { private_title: s.privateTitle }),
    ...(s.prompt && { prompt: s.prompt }),
    ...(s.promptImages && { prompt_images: s.promptImages }),
    ...(s.promptImageCount && { prompt_image_count: s.promptImageCount }),
    ...(s.model && { model: s.model }),
    ...(s.evaluation && { evaluation: s.evaluation }),
    started_at: s.startedAt,
    ended_at: s.endedAt,
    duration_seconds: Math.round(s.durationMs / 1000),
    chain_start_hash: s.prevHash,
    chain_end_hash: s.hash,
    seal_signature: s.signature,
  };
}

// Maps embedded milestones from a Session → dashboard Milestone objects
function toMilestones(s: Session) {
  return (s.milestones ?? []).map((m) => ({
    id: m.id,
    session_id: s.promptId,
    title: m.title,
    ...(m.privateTitle && { private_title: m.privateTitle }),
    ...(s.project && { project: s.project }),
    category: m.category,
    complexity: m.complexity ?? "medium",
    duration_minutes: Math.round(s.durationMs / 60000),
    languages: s.languages ?? [],
    client: s.client,
    created_at: s.endedAt,
    published: false,
    published_at: null,
    chain_hash: s.hash,
  }));
}

// GET /api/local/sessions — returns SessionSeal[]
sessionsRoutes.get("/", async (c) => {
  const days = Math.min(Number(c.req.query("days") ?? 30), 90);
  const [sessions, v1Sessions] = await Promise.all([
    readSessionsForRange(days),
    readV1Sessions(),
  ]);
  return c.json([...sessions.map(toSessionSeal), ...v1Sessions]);
});

// GET /api/local/sessions/milestones — returns Milestone[]
sessionsRoutes.get("/milestones", async (c) => {
  const days = Math.min(Number(c.req.query("days") ?? 30), 90);
  const [sessions, v1Milestones] = await Promise.all([
    readSessionsForRange(days),
    readV1Milestones(),
  ]);
  return c.json([...sessions.flatMap(toMilestones), ...v1Milestones]);
});

// DELETE /api/local/sessions/:id
sessionsRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  await deleteSession(id);
  return c.json({ deleted: true, session_id: id, milestones_removed: 0 });
});
