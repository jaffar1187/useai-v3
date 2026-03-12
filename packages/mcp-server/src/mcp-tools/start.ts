import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { TaskTypeSchema } from "@devness/useai-types";
import type { PromptContext } from "../prompt-context.js";
import { saveParentState } from "../prompt-context.js";
import { coerceJsonString } from "../coerce.js";

export function registerStartTool(
  server: McpServer,
  ctx: PromptContext,
): void {
  server.registerTool(
    "useai_start",
    {
      description:
        "Start tracking an AI coding session. Call this at the beginning of every response to a real user message. " +
        'Generate a session title from the user\'s prompt: a generic public "title" (no project/file names) ' +
        'and a detailed "private_title" (can include specifics). ' +
        "task_type must be one of: coding, debugging, testing, planning, reviewing, documenting, learning, " +
        "deployment, devops, research, migration, design, data, security, configuration, code_review, " +
        "investigation, infrastructure, analysis, ops, setup, refactoring, other.",
      inputSchema: {
        client: z
          .string()
          .optional()
          .describe("Name of the AI tool being used (e.g. claude-code, cursor, windsurf)"),
        task_type: TaskTypeSchema.optional().describe(
          "What kind of task is the developer working on?",
        ),
        title: z
          .string()
          .optional()
          .describe('Short public session title. No project names or file paths. Example: "Fix authentication bug"'),
        private_title: z
          .string()
          .optional()
          .describe("Detailed session title for private records. Can include project names and specifics."),
        project: z
          .string()
          .optional()
          .describe('Project name — typically the root directory name of the codebase. Example: "useai", "goodpass"'),
        prompt: z
          .string()
          .optional()
          .describe("The user's full verbatim prompt text. Stored locally for self-review."),
        model: z
          .string()
          .optional()
          .describe('The AI model ID running this session. Example: "claude-sonnet-4-6"'),
        prompt_images: coerceJsonString(
          z.array(
            z.object({
              type: z.literal("image"),
              description: z.string().describe("AI-generated description of the image"),
            }),
          ),
        )
          .optional()
          .describe("Metadata for images attached to the prompt (description only, no binary data)."),
      },
    },
    async ({ client, task_type, title, private_title, project, prompt, model, prompt_images }) => {
      const isNested = ctx.startedAt !== null;

      if (isNested) {
        // ---- Nested session: save parent, reset only session-specific fields ----
        saveParentState(ctx);
        ctx.sessionDepth++;
        // prevHash intentionally preserved: child inherits parent's chain position

        ctx.promptId = `prompt_${randomUUID()}`;
        ctx.startedAt = new Date();
        ctx.lastActivityTime = null;
        ctx.idleMs = 0;
        ctx.childPausedMs = 0;
        ctx.client = client ?? ctx.client;
        ctx.taskType = task_type ?? "other";
        ctx.title = title ?? null;
        ctx.privateTitle = private_title ?? null;
        ctx.project = project ?? ctx.project;
        ctx.model = model ?? ctx.model;
        ctx.prompt = prompt ?? null;
        ctx.promptImages = prompt_images ?? null;

        return {
          content: [
            {
              type: "text" as const,
              text: `Session ${ctx.promptId} started (depth ${ctx.sessionDepth}). Call useai_end when done.`,
            },
          ],
        };
      }

      // ---- Root session: full reset ----
      ctx.promptId = `prompt_${randomUUID()}`;
      ctx.prevHash = "0".repeat(64);
      ctx.startedAt = new Date();
      ctx.lastActivityTime = null;
      ctx.idleMs = 0;
      ctx.childPausedMs = 0;
      ctx.sessionDepth = 0;
      ctx.parentStack = [];
      ctx.client = client ?? "unknown";
      ctx.taskType = task_type ?? "other";
      ctx.title = title ?? null;
      ctx.privateTitle = private_title ?? null;
      ctx.project = project ?? null;
      ctx.model = model ?? null;
      ctx.prompt = prompt ?? null;
      ctx.promptImages = prompt_images ?? null;

      return {
        content: [
          {
            type: "text" as const,
            text: `Session ${ctx.promptId} started. Call useai_end when done.`,
          },
        ],
      };
    },
  );
}
