/**
 * The sound kit on disk (designs/2026-10-24-video-film-file.md, Decision 4). Effects are earshot
 * takes in the studio package, `sfx/fx/` (`sfx/make.mjs` makes them). Music beds are not ours: they live in the
 * media bucket under `sfx/`, are named in `sfx/kit.json` and pulled into the Mac's cache
 * (`wren video sfx pull`). A render copies the sounds its props name into the edit's folder,
 * Remotion's public dir.
 */
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { FX } from "./fx.js";
import { type AudioProps, BED_ID, isEffect } from "./sounds.js";

/** Where bucket sounds are kept on this Mac once pulled. */
export const KIT_CACHE = join(homedir(), "Library/Caches/wren/sfx");

const TAKES = new Set(Object.values(FX).flatMap((r) => r.takes.map((t) => t.file)));

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

/** The ids that are neither a kit role nor a listed bed: refuse them before saving. */
export function unknownSounds(beds: readonly Bed[], ids: Iterable<string>): string[] {
  const have = new Set(beds.map((e) => e.id));
  return [...new Set(ids)].filter((id) => !isEffect(id) && !have.has(id));
}

/** The kit files an output's audio plays, as public paths (`sfx/fx/hit_1.ogg`, `sfx/bed-calm.wav`). */
export const audioFiles = (audio: AudioProps | undefined): string[] =>
  audio
    ? [...audio.sounds.map((s) => s.file), ...(audio.music ? [audio.music.file] : [])]
        // A file of his own beside the script (a promo's music) is not the kit's.
        .filter((f) => f.startsWith("sfx/"))
    : [];

/**
 * Copy the kit files `files` (public paths) into `dir`, the public dir, each once: a take from the
 * studio package (`pkgDir`, not the bundled CLI's own dir), a bed from the Mac's cache. Throws on a
 * file the kit lacks or a bed not pulled yet.
 */
export async function stageSounds(
  dir: string,
  files: Iterable<string>,
  o: { pkgDir: string; cache?: string },
): Promise<number> {
  const want = [...new Set(files)];
  if (!want.length) return 0;
  const beds = await loadBeds(o.pkgDir);
  for (const file of want) {
    const take = /^sfx\/fx\/(.+)$/.exec(file)?.[1];
    const bed = beds.find((k) => file === `sfx/${k.file}`);
    if (!(take && TAKES.has(take)) && !bed) throw new Error(`not in the sound kit: ${file}`);
    const from = bed ? bedPath(bed, o.cache) : join(o.pkgDir, "sfx/fx", take as string);
    if (!(await stat(from).catch(() => null)))
      throw new Error(`${file} is not on this Mac yet: run wren video sfx pull`);
    const to = join(dir, file);
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, to);
  }
  return want.length;
}
