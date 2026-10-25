#!/usr/bin/env node
/**
 * Makes the effects kit (designs/2026-10-24-video-film-file.md, Decision 4): earshot's `launch` kit,
 * made in code, rendered once and kept. earshot is a generator here, never a dependency of a render.
 * It writes `sfx/fx/*.ogg`, `sfx/fx/kit.lock.json` (earshot's own lock) and `src/fx.ts` (what the
 * renders read). Needs uv and ffmpeg. Run: `node packages/studio/sfx/make.mjs`.
 *
 * Pinned to the git tag: PyPI `earshot` is a different package.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EARSHOT = "git+https://github.com/Leonxlnx/earshot@v0.4.0";
const PRESET = "launch";

const sfx = dirname(fileURLToPath(import.meta.url));
const out = join(sfx, "fx");
const tmp = mkdtempSync(join(tmpdir(), "earshot-"));
const earshot = (...args) =>
  execFileSync("uvx", ["-q", "--from", EARSHOT, "earshot", ...args], { stdio: "inherit" });

earshot("kit", "init", "--preset", PRESET, "-o", join(tmp, "kit.json"));
earshot("kit", "render", join(tmp, "kit.json"), "--out", join(tmp, "takes"));
const kit = JSON.parse(readFileSync(join(tmp, "kit.json"), "utf8"));
const lock = JSON.parse(readFileSync(join(tmp, "takes/kit.lock.json"), "utf8"));

rmSync(out, { recursive: true, force: true });
mkdirSync(out);
const sha1 = (f) => createHash("sha1").update(readFileSync(f)).digest("hex");
const roles = {};
for (const [role, r] of Object.entries(lock.roles)) {
  if (!r) continue;
  roles[role] = {
    align: r.align,
    offsetMs: r.offset_ms ?? 0,
    gapMs: r.min_gap_ms ?? 0,
    bedDb: r.bed_db,
    note: kit.roles[role].note,
    takes: r.takes.map((t) => {
      const file = t.file.replace(/\.wav$/, ".ogg");
      // -bitexact: the same wav makes the same ogg, so the test can hold each file to its sha1.
      execFileSync("ffmpeg", [
        ...["-loglevel", "error", "-y", "-i", join(tmp, "takes", t.file)],
        ...["-c:a", "libopus", "-b:a", "128k", "-fflags", "+bitexact", "-flags:a", "+bitexact"],
        join(out, file),
      ]);
      return {
        file,
        sync: t[`${r.align}_s`],
        durS: t.dur_s,
        l50: t.l50_lufs,
        peakDb: t.peak_db,
        sha1: sha1(join(out, file)),
      };
    }),
  };
}
writeFileSync(join(out, "kit.lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
writeFileSync(
  join(sfx, "../src/fx.ts"),
  `/**
 * The effects kit, written by \`sfx/make.mjs\` (do not edit): earshot ${lock.earshot} \`${PRESET}\`, bank ${lock.bank}.
 * Each role: where its sync point (\`align\`) sits against the cue (\`offsetMs\`), how close a run
 * may go (\`gapMs\`), its level over the bed (\`bedDb\`), and its takes in \`sfx/fx/\`, each with its
 * sync point (s), its loudest 50 ms (\`l50\`, LUFS) and its peak.
 */
export interface Take {
  file: string;
  sync: number;
  durS: number;
  l50: number;
  peakDb: number;
  sha1: string;
}
export interface FxRole {
  align: "onset" | "peak";
  offsetMs: number;
  gapMs: number;
  bedDb: number;
  /** earshot's own note on the role. */
  note: string;
  takes: readonly Take[];
}
const fx = ${JSON.stringify(roles, null, 2)} as const satisfies Record<string, FxRole>;
export type Role = keyof typeof fx;
export const FX: Record<Role, FxRole> = fx;
`,
);
rmSync(tmp, { recursive: true, force: true });
console.log(`fx: ${Object.keys(roles).length} roles in ${out}`);
