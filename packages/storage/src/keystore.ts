import type { Keystore } from "@devness/useai-types";
import { generateKeystore, decryptKeystore } from "@devness/useai-crypto";
import { KEYSTORE_FILE } from "./paths.js";
import { readJson, writeJson } from "./fs.js";

export async function getOrCreateKeystore(): Promise<{
  keystore: Keystore;
  privateKey: Buffer;
}> {
  let keystore = await readJson<Keystore>(KEYSTORE_FILE);

  if (!keystore) {
    keystore = generateKeystore();
    await writeJson(KEYSTORE_FILE, keystore);
  }

  const privateKey = decryptKeystore(keystore);
  return { keystore, privateKey };
}
