import { existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

/**
 * Load the project's `.env` and return the directory it lives in, the project root.
 * Inside the repo (or with no `rootDir`) that is the nearest `.env` walking up from
 * `startDir` (default cwd), never above the repo root (`rootDir`, or the directory
 * holding `pnpm-workspace.yaml`): a worktree with no `.env` under `~/worktrees` is
 * still its own root, not `~`. Run from anywhere else, the launcher's `rootDir` wins:
 * a `.env` above some unrelated directory (a `~/.env`) is another tool's, not ours.
 * Existing process env wins over file values. With no file found, the repo root (or
 * `startDir` outside any repo) comes back so callers always get a usable root.
 */
export function loadEnvFile(startDir: string = process.cwd(), rootDir?: string): string {
  const start = resolve(startDir);
  if (rootDir) {
    const root = resolve(rootDir);
    if (start !== root && !start.startsWith(root + sep)) {
      if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));
      return root;
    }
  }
  const top = rootDir ? resolve(rootDir) : undefined;
  let dir = start;
  for (;;) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return dir;
    }
    if (dir === top || existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}
