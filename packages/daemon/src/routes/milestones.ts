import { Hono } from "hono";
import { readSessionsForRange, writeSessionsForDate } from "@devness/useai-storage";

export const milestonesRoutes = new Hono();

// GET /api/local/milestones — returns Milestone[]
milestonesRoutes.get("/", async (c) => {
  const days = Math.min(Number(c.req.query("days") ?? 30), 90);
  const sessions = await readSessionsForRange(days);
  const milestones = sessions.flatMap((s) =>
    (s.milestones ?? []).map((m) => ({
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
    })),
  );
  return c.json(milestones);
});

// DELETE /api/local/milestones/:id — removes a milestone from its parent session
milestonesRoutes.delete("/:id", async (c) => {
  const milestoneId = c.req.param("id");
  const sessions = await readSessionsForRange(30);

  for (const session of sessions) {
    const idx = (session.milestones ?? []).findIndex((m) => m.id === milestoneId);
    if (idx === -1) continue;

    session.milestones = session.milestones.filter((m) => m.id !== milestoneId);
    const date = session.endedAt.slice(0, 10);
    await writeSessionsForDate(date, sessions.filter((s) => s.endedAt.slice(0, 10) === date));
    return c.json({ deleted: true, milestone_id: milestoneId });
  }

  return c.json({ deleted: false, milestone_id: milestoneId });
});
