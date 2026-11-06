/** A setup's CLIs on the child's PATH: each plugin package's `bin` entries, linked into one dir per setup. */
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { pluginRoot } from "./launch.js";
import type { Setup } from "./setup.js";

export function setupBins(
  setup: Setup,
  resolvePlugin = pluginRoot,
  /** Workspace root: a path plugin (`./…`) resolves from here; without it, path plugins give no bins. */
  workspace?: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of setup.plugins) {
    const path = isAbsolute(p) || p.startsWith(".");
    if (path && !isAbsolute(p) && !workspace) continue;
    const root = path ? resolve(workspace ?? "", p) : resolvePlugin(p);
    // a path plugin may be a bare folder of skills
    if (path && !existsSync(join(root, "package.json"))) continue;
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      name: string;
      bin?: string | Record<string, string>;
    };
    const bin =
      typeof pkg.bin === "string"
        ? { [pkg.name.split("/").pop() ?? pkg.name]: pkg.bin }
        : (pkg.bin ?? {});
    for (const [name, file] of Object.entries(bin)) out[name] = resolve(root, file);
  }
  return out;
}

export function binDir(
  setup: Setup,
  base = join(tmpdir(), "wren-agent-bin"),
  workspace?: string,
): string {
  const dir = join(base, setup.name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [name, file] of Object.entries(setupBins(setup, pluginRoot, workspace)))
    symlinkSync(file, join(dir, name));
  return dir;
}
