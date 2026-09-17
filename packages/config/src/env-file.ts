import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Load the nearest `.env` walking up from `startDir` (default cwd) and return
 * the directory it lives in, which is the project root. Existing process env
 * wins over file values. Returns `startDir` when no file is found so callers
 * always get a usable root.
 */
export function loadEnvFile(startDir: string = process.cwd()): string {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return resolve(startDir);
    dir = parent;
  }
}
