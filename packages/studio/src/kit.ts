/**
 * The sound kit on disk (designs/2026-10-24-video-film-file.md, Decision 4): `sfx/kit.json` names
 * each sound. CC0 files sit beside it in the repo; any other licence (and every long music bed)
 * lives in the media bucket under `sfx/` and is pulled into the Mac's cache (`pullKit`). A render
 * copies the sounds its props name into the edit's folder, Remotion's public dir.
 */
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { type AudioProps, SOUND_ID, SOUND_KINDS, soundFile } from "./sounds.js";

export const KIT_DIR = join(dirname(fileURLToPath(import.meta.url)), "../sfx");
/** Where bucket sounds are kept on this Mac once pulled. */
export const KIT_CACHE = join(homedir(), "Library/Caches/wren/sfx");

const entrySchema = z
  .object({
    id: z.string().regex(SOUND_ID),
    file: z.string().regex(/^[a-z0-9-]+\.wav$/),
    kind: z.enum(SOUND_KINDS),
    tags: z.array(z.string()),
    durationS: z.number().positive(),
    licence: z.string().min(1),
    source: z.string().min(1),
    /** In the media bucket under `sfx/<file>`, not the repo. */
    where: z.literal("bucket").optional(),
  })
  .strict()
  .refine((e) => e.file === `${e.id}.wav`, "file must be <id>.wav")
  .refine((e) => e.where === "bucket" || e.licence === "CC0-1.0", "only CC0 files sit in the repo");
export type KitEntry = z.infer<typeof entrySchema>;

export async function loadKit(dir = KIT_DIR): Promise<KitEntry[]> {
  const raw = JSON.parse(await readFile(join(dir, "kit.json"), "utf8")) as { sounds: unknown };
  const kit = z.array(entrySchema).parse(raw.sounds);
  const ids = kit.map((e) => e.id);
  const twice = ids.find((id, i) => ids.indexOf(id) !== i);
  if (twice) throw new Error(`kit.json: ${twice} twice`);
  return kit;
}

/** Where one kit sound's file is on this Mac. */
export const kitPath = (e: KitEntry, dir = KIT_DIR, cache = KIT_CACHE) =>
  join(e.where === "bucket" ? cache : dir, e.file);

/** The kit ids an edit's sounds and bed name that the kit has not: refuse them before saving. */
export function unknownSounds(kit: readonly KitEntry[], ids: Iterable<string>): string[] {
  const have = new Set(kit.map((e) => e.id));
  return [...new Set(ids)].filter((id) => !have.has(id));
}

/** The kit ids an output's audio plays. */
export const audioIds = (audio: AudioProps | undefined): string[] =>
  audio
    ? [...audio.sounds.map((s) => s.file), ...(audio.music ? [audio.music.file] : [])]
        // A file of his own beside the script (a promo's music) is not the kit's.
        .filter((f) => f.startsWith("sfx/"))
        .map((f) => f.replace(/^sfx\/|\.wav$/g, ""))
    : [];

/**
 * Copy the sounds `ids` into `<dir>/sfx/` (the public dir), each once. Throws on an id the kit
 * lacks or a bucket sound not pulled yet.
 */
export async function stageSounds(
  dir: string,
  ids: Iterable<string>,
  o: { kitDir?: string; cache?: string } = {},
): Promise<number> {
  const want = [...new Set(ids)];
  if (!want.length) return 0;
  const kit = await loadKit(o.kitDir);
  const missing = unknownSounds(kit, want);
  if (missing.length) throw new Error(`not in the sound kit: ${missing.join(", ")}`);
  await mkdir(join(dir, "sfx"), { recursive: true });
  for (const id of want) {
    const e = kit.find((k) => k.id === id) as KitEntry;
    const from = kitPath(e, o.kitDir, o.cache);
    if (!(await stat(from).catch(() => null)))
      throw new Error(`${id} is not on this Mac yet: run wren video sfx pull`);
    await copyFile(from, join(dir, soundFile(id)));
  }
  return want.length;
}
