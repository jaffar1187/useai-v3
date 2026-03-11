import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

const START_MARKER = "<!-- useai:start -->";
const END_MARKER = "<!-- useai:end -->";

export const INSTRUCTIONS_TEXT = [
  "## UseAI Session Tracking",
  "- At the START of every response to a **real user message**, call `useai_start` with the appropriate task_type. Also generate a short session `title` (generic, no project names) and `private_title` (detailed, can include specifics) from the user's prompt.",
  '  - **"Real user message"** = the turn contains actual user-authored text. Do NOT call `useai_start` on turns that only contain system reminders, hook feedback, plan approval clicks, or other automated/system-generated content.',
  "  - **task_type values**: coding, debugging, testing, planning, reviewing, documenting, learning, deployment, devops, research, migration, design, data, security, configuration, code_review, investigation, infrastructure, analysis, ops, setup, refactoring, other",
  "- At the START of every response where you are **not** calling `useai_start` or `useai_end`, call `useai_heartbeat` first.",
  "- While actively working, call `useai_heartbeat` every 4–4.5 minutes. This tracks honest active time — gaps longer than 5 minutes between heartbeats are automatically counted as idle and excluded from the session duration.",
  "- At the END of every response where `useai_start` was called, call `useai_end` with languages used, files_touched_count, milestones, and an `evaluation` object honestly assessing: prompt_quality (1-5), context_provided (1-5), task_outcome, iteration_count, independence_level (1-5), scope_quality (1-5), tools_leveraged count.",
  '  - **milestones**: Array of objects, each with required `title` (generic — no project/file names), `category`, and optional `private_title` (detailed). Example: `[{"title": "Implemented auth flow", "private_title": "Added OAuth2 to UserService in acme-api", "category": "feature"}]`',
  "  - **milestone category values**: feature, bugfix, refactor, test, docs, setup, deployment, fix, analysis, research, investigation, performance, cleanup, chore, security, migration, design, devops, config, other",
].join("\n");

/**
 * Inject instructions into a file using marker blocks (append method)
 * or create a new file (create method).
 */
export function injectInstructions(
  filePath: string,
  method: "append" | "create",
): void {
  mkdirSync(dirname(filePath), { recursive: true });

  if (method === "create") {
    writeFileSync(filePath, INSTRUCTIONS_TEXT + "\n", "utf-8");
    return;
  }

  // append: insert/update marker block in existing file
  const block = `${START_MARKER}\n${INSTRUCTIONS_TEXT}\n${END_MARKER}`;

  if (!existsSync(filePath)) {
    writeFileSync(filePath, block + "\n", "utf-8");
    return;
  }

  const existing = readFileSync(filePath, "utf-8");

  // Update existing block if present
  if (existing.includes(START_MARKER)) {
    const markerRegex = new RegExp(
      `${escapeRegex(START_MARKER)}[\\s\\S]*?${escapeRegex(END_MARKER)}`,
    );
    writeFileSync(filePath, existing.replace(markerRegex, block), "utf-8");
    return;
  }

  // Append new block
  const separator = existing && !existing.endsWith("\n") ? "\n\n" : existing ? "\n" : "";
  writeFileSync(filePath, existing + separator + block + "\n", "utf-8");
}

/**
 * Remove injected instructions from a file.
 */
export function removeInstructions(
  filePath: string,
  method: "append" | "create",
): void {
  if (!existsSync(filePath)) return;

  if (method === "create") {
    unlinkSync(filePath);
    return;
  }

  const existing = readFileSync(filePath, "utf-8");
  const markerRegex = new RegExp(
    `\\n?${escapeRegex(START_MARKER)}[\\s\\S]*?${escapeRegex(END_MARKER)}\\n?`,
  );
  const cleaned = existing.replace(markerRegex, "").trim();

  if (!cleaned) {
    unlinkSync(filePath);
  } else {
    writeFileSync(filePath, cleaned + "\n", "utf-8");
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
