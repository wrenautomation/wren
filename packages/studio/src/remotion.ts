/**
 * Remotion runs as its own CLI from this package (its bundler and renderer never enter the wren
 * bundle): the edit's folder is the public dir, the props a JSON file in it.
 */
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LongProps } from "./props.js";

const ENTRY = "remotion/index.tsx";

async function remotion(pkgDir: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const p = spawn(join(pkgDir, "node_modules/.bin/remotion"), args, {
      cwd: pkgDir,
      stdio: "inherit",
    });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`remotion exit ${code}`))));
  });
}

async function propsFile(dir: string, props: LongProps): Promise<string> {
  const file = join(dir, "long-props.json");
  await writeFile(file, JSON.stringify(props));
  return file;
}

/** Remotion Studio on localhost, live on this edit; runs until Ctrl-C. */
export async function openStudio(pkgDir: string, dir: string, props: LongProps): Promise<void> {
  const file = await propsFile(dir, props);
  await remotion(pkgDir, ["studio", ENTRY, "--public-dir", dir, "--props", file]);
}

/** One frame of `Long` as a png, to check the layout without opening Studio. */
export async function renderStill(
  pkgDir: string,
  dir: string,
  props: LongProps,
  atS: number,
): Promise<string> {
  const file = await propsFile(dir, props);
  const out = join(dir, `still-${atS}s.png`);
  const frame = Math.min(props.durationInFrames - 1, Math.round(atS * props.fps));
  await remotion(pkgDir, [
    ...["still", ENTRY, "Long", out, `--frame=${frame}`],
    ...["--public-dir", dir, "--props", file],
  ]);
  return out;
}
