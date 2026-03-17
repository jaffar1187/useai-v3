import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

const START_MARKER = "<!-- useai:start -->";
const END_MARKER = "<!-- useai:end -->";

export const INSTRUCTIONS_TEXT = [
  "## UseAI Session Tracking",
  "",
  "### Rule 1 — useai_start (beginning of response)",
  "**BEFORE EVERY RESPONSE — answer this question first:**",
  "> \"Does this turn contain any text written by the real human user?\"",
  "> - YES → call `useai_start` as the VERY FIRST thing, before any tool call or text output.",
  "> - NO (only task-notifications, system reminders, plan approvals, hook feedback) → skip `useai_start`.",
  "",
  "This check must happen on EVERY turn, including short follow-up questions, one-liners, and any message that arrives after a task-notification or after a previous session was sealed. There is no \"continuation\" state — every real user message is a new session.",
  "",
  "**Common failure pattern to avoid:** task-notification turns interrupt the flow → next real user message arrives → `useai_start` gets skipped because it feels like a continuation. It is NOT a continuation. Call `useai_start`.",
  "",
  "  1. **Always call it** when the turn contains actual user-authored text, regardless of whether a previous session just ended.",
  "  2. **Never call it** on turns that contain only system reminders, hook feedback, plan approval clicks, or other automated/system-generated content.",
  "  3. **Interrupted/resumed prompt**: If `useai_start` was called but `useai_end` was never reached (prompt interrupted mid-response), call `useai_heartbeat` instead of `useai_start` to resume — do NOT open a new nested session.",
  "  4. Generate a short `title` (generic, no project names) and a detailed `private_title` from the user's prompt.",
  "  5. **task_type values**: coding, debugging, testing, planning, reviewing, documenting, learning, deployment, devops, research, migration, design, data, security, configuration, code_review, investigation, infrastructure, analysis, ops, setup, refactoring, other",
  "",
  "### Rule 2 — useai_heartbeat (mid-response keep-alive)",
  "  1. Call `useai_heartbeat` at the start of every response where you are **not** calling `useai_start` or `useai_end`.",
  "  2. **Exception**: if `useai_end` was already called and no new `useai_start` has been called since (no active session), skip `useai_heartbeat` entirely — this includes task-notification turns that arrive after a session is sealed.",
  "  3. **While actively working**: also call `useai_heartbeat` after every **10 tool calls** (Read/Grep/Bash/etc.) OR every **4 minutes** — whichever comes first. After every tool call batch, explicitly state your current count (e.g. \"Tool count: 7/10\") before proceeding — this prevents losing count during dense file-read loops. Reset count to 0 after each heartbeat. Gaps longer than 5 minutes are counted as idle time.",
  "",
  "### Rule 3 — useai_end (end of response)",
  "Call `useai_end` at the end of every response where `useai_start` was called. **Reserve your last 5 tool calls exclusively for this — once you reach that budget, stop all other work and call `useai_end` immediately.** Provide:",
  "  1. `languages` used, `files_touched_count`",
  "  2. `milestones`: array of objects each with `title` (generic — no project/file names), `category`, and optional `private_title` (detailed).",
  '     Example: `[{"title": "Implemented auth flow", "private_title": "Added OAuth2 to UserService in acme-api", "category": "feature"}]`',
  "     Category values: feature, bugfix, refactor, test, docs, setup, deployment, fix, analysis, research, investigation, performance, cleanup, chore, security, migration, design, devops, config, other",
  "  3. `evaluation` object: prompt_quality (1-5), context_provided (1-5), task_outcome, iteration_count, independence_level (1-5), scope_quality (1-5), tools_leveraged count. Include a `*_reason` for every scored field.",
  '  4. **calibrated framework**: also provide `*_ideal` fields explaining what would make each metric perfect. Omit the ideal field if the metric is already 5/5. These enable gap analysis scoring that penalizes inflated self-assessments.',
  "- **Subagent tracking**: When spawning subagents, the agent prompt MUST include all of the following instructions explicitly:",
  "  1. Use `ToolSearch` to load the useai tools, then call `useai_start` **as the very first tool call** — before any Glob, Read, Grep, Bash, or other tool — **without** a `prompt_id` (each subagent gets its own independent session).",
  "  2. Note the `prompt_id` returned by `useai_start` and use that exact `prompt_id` for all subsequent `useai_heartbeat` and `useai_end` calls.",
  "  3. **Heartbeat rule (BOTH conditions apply — whichever triggers first)**: call `useai_heartbeat` after every **10 tool calls** (Read/Grep/Bash/etc.) OR every **4 minutes** — whichever comes first. After every tool call batch, explicitly state your current count (e.g. \"Tool count: 7/10\") before proceeding — this prevents losing count during dense file-read loops. Reset count to 0 after each heartbeat.",
  "  4. Do NOT pass the parent session's `prompt_id` to subagents — each subagent must have its own independent session to avoid tracking collisions.",
  "  5. **Reserve tool calls for useai_end**: Always reserve the last 5 tool calls exclusively for `useai_end`. Once you reach that budget, stop all other work and call `useai_end` immediately — never let context exhaustion prevent the session from being sealed.",
  "  - **Long-running commands**: If a command will run longer than 4 minutes (builds, test suites, deployments, sleeps), break it into ≤4-minute chunks and call `useai_heartbeat` between each chunk. Gaps over 5 minutes without a heartbeat are counted as idle time.",
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
