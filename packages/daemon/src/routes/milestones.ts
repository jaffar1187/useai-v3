import { Hono } from "hono";
import { readSessionsForRange, readV1Milestones, writeSessionsForDate } from "@devness/useai-storage";

export const milestonesRoutes = new Hono();

// GET /api/local/milestones — returns Milestone[]
milestonesRoutes.get("/", async (c) => {
  const days = Math.min(Number(c.req.query("days") ?? 30), 90);
  const [sessions, v1Milestones] = await Promise.all([
    readSessionsForRange(days),
    readV1Milestones(),
  ]);

  const v3Milestones = sessions.flatMap((s) =>
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

  // Normalize v1 milestones to match dashboard Milestone shape
  const normalize = (m: Record<string, unknown>) => ({
    id: (m["id"] as string) ?? `v1_${Math.random().toString(36).slice(2)}`,
    session_id: (m["session_id"] as string) ?? "",
    title: (m["title"] as string) ?? "",
    ...((m["private_title"] ?? m["privateTitle"]) ? { private_title: (m["private_title"] ?? m["privateTitle"]) as string } : {}),
    ...((m["project"]) ? { project: m["project"] as string } : {}),
    category: (m["category"] as string) ?? "other",
    complexity: (m["complexity"] as string) ?? "medium",
    duration_minutes: (m["duration_minutes"] as number) ?? 0,
    languages: (m["languages"] as string[]) ?? [],
    client: (m["client"] as string) ?? "unknown",
    created_at: (m["created_at"] as string) ?? new Date().toISOString(),
    published: (m["published"] as boolean) ?? false,
    published_at: (m["published_at"] as string) ?? null,
    chain_hash: (m["chain_hash"] as string) ?? "",
  });

  // Dedup by session_id + title
  const seen = new Set<string>();
  const all = [...v3Milestones, ...v1Milestones.map(normalize)];
  const deduped = all.filter((m) => {
    const key = `${m.session_id}::${m.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return c.json(deduped);
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
