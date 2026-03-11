import type { UseaiConfig } from "@devness/useai-types";
import { UseaiConfigSchema } from "@devness/useai-types/config";
import { CONFIG_FILE } from "./paths.js";
import { readJson, writeJson } from "./fs.js";

export async function getConfig(): Promise<UseaiConfig> {
  const raw = await readJson<Record<string, unknown>>(CONFIG_FILE);
  return UseaiConfigSchema.parse(raw ?? {});
}

export async function saveConfig(config: UseaiConfig): Promise<void> {
  await writeJson(CONFIG_FILE, config);
}

export async function patchConfig(
  patch: Partial<UseaiConfig>,
): Promise<UseaiConfig> {
  const current = await getConfig();
  const updated = { ...current, ...patch };
  await saveConfig(updated);
  return updated;
}
