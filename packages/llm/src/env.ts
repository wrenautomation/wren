import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Populate process.env from llm.env with setdefault semantics: a variable already
 * exported always wins. The key fleets (NUM_<PROVIDER> + <PROVIDER>_API_KEY_N)
 * live in this one git-ignored file. A missing file is not an error here; makeLlm
 * raises a clear message if a provider truly has no keys anywhere.
 * Returns whether a file was loaded.
 */
export function loadLlmEnv(path = "llm.env", rootDir: string = process.cwd()): boolean {
  const full = resolve(rootDir, path);
  if (!existsSync(full)) return false;
  process.loadEnvFile(full);
  return true;
}
