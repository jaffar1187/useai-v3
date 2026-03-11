import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PromptContext } from "./prompt-context.js";
import { registerStartTool } from "./mcp-tools/start.js";
import { registerHeartbeatTool } from "./mcp-tools/heartbeat.js";
import { registerEndTool } from "./mcp-tools/end.js";

export function registerTools(
  server: McpServer,
  promptContext: PromptContext,
): void {
  registerStartTool(server, promptContext);
  registerHeartbeatTool(server, promptContext);
  registerEndTool(server, promptContext);
}
