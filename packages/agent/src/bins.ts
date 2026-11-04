/** A setup's CLIs on the child's PATH: each plugin package's `bin` entries, linked into one dir per setup. */
import { mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { pluginRoot } from "./launch.js";
import type { Setup } from "./setup.js";

export function setupBins(setup: Setup, resolvePlugin = pluginRoot): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of setup.plugins) {
    if (isAbsolute(p) || p.startsWith(".")) continue;
    const root = resolvePlugin(p);
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

export function binDir(setup: Setup, base = join(tmpdir(), "wren-agent-bin")): string {
  const dir = join(base, setup.name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [name, file] of Object.entries(setupBins(setup))) symlinkSync(file, join(dir, name));
  return dir;
}
