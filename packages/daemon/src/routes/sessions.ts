import { Hono } from "hono";
import { readSessionsForRange, deleteSession } from "@devness/useai-storage";

export const sessionsRoutes = new Hono();

sessionsRoutes.get("/", async (c) => {
  const days = Math.min(Number(c.req.query("days") ?? 7), 30);
  const sessions = await readSessionsForRange(days);
  return c.json({ ok: true, data: { sessions, total: sessions.length } });
});

sessionsRoutes.get("/milestones", async (c) => {
  const days = Math.min(Number(c.req.query("days") ?? 7), 30);
  const sessions = await readSessionsForRange(days);
  const milestones = sessions.flatMap((s) =>
    (s.milestones ?? []).map((m) => ({
      id: m.id,
      promptId: s.promptId,
      title: m.title,
      ...(m.privateTitle && { privateTitle: m.privateTitle }),
      ...(s.project && { project: s.project }),
      category: m.category,
      complexity: m.complexity ?? "medium",
      durationMinutes: Math.round(s.durationMs / 60000),
      languages: s.languages ?? [],
      client: s.client,
      createdAt: s.endedAt,
      chainHash: s.hash,
    })),
  );
  return c.json({ ok: true, data: { milestones } });
});

sessionsRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  await deleteSession(id);
  return c.json({ ok: true });
});
