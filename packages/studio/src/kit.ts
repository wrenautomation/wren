/**
 * The sound kit on disk (designs/2026-10-24-video-film-file.md, Decision 4). Effects come from the
 * uisfx package (CC0), installed in the studio package. Music beds are not CC0: they live in the
 * media bucket under `sfx/`, are named in `sfx/kit.json` and pulled into the Mac's cache
 * (`wren video sfx pull`). A render copies the sounds its props name into the edit's folder,
 * Remotion's public dir.
 */
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { type AudioProps, BED_ID, isEffect, soundFile } from "./sounds.js";

/** Where bucket sounds are kept on this Mac once pulled. */
export const KIT_CACHE = join(homedir(), "Library/Caches/wren/sfx");

/** The uisfx folder, resolved from the studio package (`pkgDir`): a bundled CLI's own dir has none. */
export const uisfxDir = (pkgDir: string) =>
  dirname(createRequire(join(pkgDir, "package.json")).resolve("uisfx/manifest"));

const bedSchema = z
  .object({
    id: z.string().regex(BED_ID),
    file: z.string().regex(/^bed-[a-z0-9-]+\.wav$/),
    tags: z.array(z.string()),
    durationS: z.number().positive(),
    licence: z.string().min(1),
    source: z.string().min(1),
    /** In the media bucket under `sfx/<file>`, never the repo. */
    where: z.literal("bucket"),
  })
  .strict()
  .refine((e) => e.file === `${e.id}.wav`, "file must be <id>.wav");
export type Bed = z.infer<typeof bedSchema>;

/** The music beds `<pkgDir>/sfx/kit.json` names. */
export async function loadBeds(pkgDir: string): Promise<Bed[]> {
  const raw = JSON.parse(await readFile(join(pkgDir, "sfx/kit.json"), "utf8")) as { beds: unknown };
  const beds = z.array(bedSchema).parse(raw.beds);
  const ids = beds.map((e) => e.id);
  const twice = ids.find((id, i) => ids.indexOf(id) !== i);
  if (twice) throw new Error(`kit.json: ${twice} twice`);
  return beds;
}

/** Where one bed's file is on this Mac. */
export const bedPath = (e: Bed, cache = KIT_CACHE) => join(cache, e.file);

/** The ids that are neither a uisfx effect nor a listed bed: refuse them before saving. */
export function unknownSounds(beds: readonly Bed[], ids: Iterable<string>): string[] {
  const have = new Set(beds.map((e) => e.id));
  return [...new Set(ids)].filter((id) => !isEffect(id) && !have.has(id));
}

/** The kit ids an output's audio plays. */
export const audioIds = (audio: AudioProps | undefined): string[] =>
  audio
    ? [...audio.sounds.map((s) => s.file), ...(audio.music ? [audio.music.file] : [])]
        // A file of his own beside the script (a promo's music) is not the kit's.
        .filter((f) => f.startsWith("sfx/"))
        .map((f) => f.replace(/^sfx\/|\.(wav|ogg)$/g, ""))
    : [];

/**
 * Copy the sounds `ids` into `<dir>/sfx/` (the public dir), each once. Throws on an id the kit
 * lacks or a bucket sound not pulled yet.
 */
export async function stageSounds(
  dir: string,
  ids: Iterable<string>,
  o: { pkgDir: string; cache?: string },
): Promise<number> {
  const want = [...new Set(ids)];
  if (!want.length) return 0;
  const beds = await loadBeds(o.pkgDir);
  const missing = unknownSounds(beds, want);
  if (missing.length) throw new Error(`not in the sound kit: ${missing.join(", ")}`);
  for (const id of want) {
    const bed = beds.find((k) => k.id === id);
    const from = bed ? bedPath(bed, o.cache) : join(uisfxDir(o.pkgDir), "sounds", `${id}.ogg`);
    if (!(await stat(from).catch(() => null)))
      throw new Error(`${id} is not on this Mac yet: run wren video sfx pull`);
    const to = join(dir, soundFile(id));
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, to);
  }
  return want.length;
}
