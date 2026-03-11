import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = homedir();
const HOOKS_DIR = join(HOME, ".useai", "hooks");
const CLAUDE_SETTINGS_PATH = join(HOME, ".claude", "settings.json");

const PROMPT_GUARD_PATH = join(HOOKS_DIR, "prompt-guard.js");
const STOP_GUARD_PATH = join(HOOKS_DIR, "stop-guard.js");

const PROMPT_GUARD_SCRIPT = `#!/usr/bin/env node
'use strict';
const { readFileSync } = require('node:fs');
let input = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const hook = JSON.parse(input);
    if (!hook.transcript_path) process.exit(0);
    let transcript;
    try { transcript = readFileSync(hook.transcript_path, 'utf-8'); } catch { process.exit(0); }
    const starts = (transcript.match(/useai_start/g) || []).length;
    const ends = (transcript.match(/useai_end/g) || []).length;
    if (starts > ends) process.exit(0);
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: 'UseAI: Call useai_start with the appropriate task_type, title, private_title, project, prompt, and model before doing any work.'
      }
    }));
  } catch { process.exit(0); }
});
`;

const STOP_GUARD_SCRIPT = `#!/usr/bin/env node
'use strict';
const { readFileSync } = require('node:fs');
let input = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const hook = JSON.parse(input);
    if (hook.stop_hook_active) process.exit(0);
    if (!hook.transcript_path) process.exit(0);
    let transcript;
    try { transcript = readFileSync(hook.transcript_path, 'utf-8'); } catch { process.exit(0); }
    const starts = (transcript.match(/useai_start/g) || []).length;
    if (starts === 0) process.exit(0);
    const ends = (transcript.match(/useai_end/g) || []).length;
    if (ends >= starts) process.exit(0);
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason: 'Before ending, call useai_end with milestones (each with a generic title, private_title for details, and category), languages used, and files_touched_count.'
    }));
  } catch { process.exit(0); }
});
`;

function readSettings(): Record<string, unknown> {
  if (!existsSync(CLAUDE_SETTINGS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CLAUDE_SETTINGS_PATH, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeSettings(settings: Record<string, unknown>): void {
  mkdirSync(join(HOME, ".claude"), { recursive: true });
  writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
}

export function installClaudeCodeHooks(): boolean {
  mkdirSync(HOOKS_DIR, { recursive: true });
  writeFileSync(PROMPT_GUARD_PATH, PROMPT_GUARD_SCRIPT);
  writeFileSync(STOP_GUARD_PATH, STOP_GUARD_SCRIPT);
  try { chmodSync(PROMPT_GUARD_PATH, "755"); } catch { /* Windows */ }
  try { chmodSync(STOP_GUARD_PATH, "755"); } catch { /* Windows */ }

  const settings = readSettings();
  const hooks = (settings["hooks"] ?? {}) as Record<string, unknown[]>;
  let changed = false;

  if (!hooks["UserPromptSubmit"]) hooks["UserPromptSubmit"] = [];
  const promptArr = hooks["UserPromptSubmit"] as Array<Record<string, unknown>>;
  const hasPrompt = promptArr.some((g) => {
    const inner = g["hooks"] as Array<Record<string, string>> | undefined;
    return inner?.some((h) => h["command"]?.includes("prompt-guard"));
  });
  if (!hasPrompt) {
    promptArr.push({ hooks: [{ type: "command", command: `node "${PROMPT_GUARD_PATH}"`, timeout: 10 }] });
    changed = true;
  }

  if (!hooks["Stop"]) hooks["Stop"] = [];
  const stopArr = hooks["Stop"] as Array<Record<string, unknown>>;
  const hasStop = stopArr.some((g) => {
    const inner = g["hooks"] as Array<Record<string, string>> | undefined;
    return inner?.some((h) => h["command"]?.includes("stop-guard"));
  });
  if (!hasStop) {
    stopArr.push({ hooks: [{ type: "command", command: `node "${STOP_GUARD_PATH}"`, timeout: 10 }] });
    changed = true;
  }

  settings["hooks"] = hooks;
  writeSettings(settings);
  return changed;
}

export function removeClaudeCodeHooks(): void {
  if (!existsSync(CLAUDE_SETTINGS_PATH)) return;
  try {
    const settings = readSettings();
    const hooks = settings["hooks"] as Record<string, unknown[]> | undefined;
    if (hooks) {
      if (hooks["UserPromptSubmit"]) {
        hooks["UserPromptSubmit"] = (hooks["UserPromptSubmit"] as Array<Record<string, unknown>>).filter((g) => {
          const inner = g["hooks"] as Array<Record<string, string>> | undefined;
          return !inner?.some((h) => h["command"]?.includes("prompt-guard"));
        });
        if ((hooks["UserPromptSubmit"] as unknown[]).length === 0) delete hooks["UserPromptSubmit"];
      }
      if (hooks["Stop"]) {
        hooks["Stop"] = (hooks["Stop"] as Array<Record<string, unknown>>).filter((g) => {
          const inner = g["hooks"] as Array<Record<string, string>> | undefined;
          return !inner?.some((h) => h["command"]?.includes("stop-guard"));
        });
        if ((hooks["Stop"] as unknown[]).length === 0) delete hooks["Stop"];
      }
      if (Object.keys(hooks).length === 0) delete settings["hooks"];
    }
    writeSettings(settings);
  } catch { /* ignore */ }
}

export function isClaudeCodeHooksInstalled(): boolean {
  const settings = readSettings();
  const hooks = settings["hooks"] as Record<string, unknown[]> | undefined;
  if (!hooks?.["Stop"]) return false;
  return (hooks["Stop"] as Array<Record<string, unknown>>).some((g) => {
    const inner = g["hooks"] as Array<Record<string, string>> | undefined;
    return inner?.some((h) => h["command"]?.includes("stop-guard"));
  });
}
