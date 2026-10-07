/**
 * The edit row: add (ingest), read, write (checked, a `runs` row each, like `wren drafts set`), and
 * the cut knobs in `wren_settings` under component `studio` (`{ cuts: {...} }`).
 */

import { mkdir, readdir } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { finishRun, openRun, recordedRun } from "@wren/core";
import { settingsFor, setWrenSettings } from "@wren/core/clients";
import { recordDraft } from "@wren/core/draft-record";
import { atomic, type Queryable } from "@wren/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { capMeta, capTracks, isCap } from "./cap.js";
import { CAPTION_SHOWS, CAPTION_STYLES } from "./caption-styles.js";
import {
  CUT_DEFAULTS,
  type CutKnobs,
  cutKnobsSchema,
  fillerProposals,
  keepSegments,
  onCut,
  toCutTime,
  withSilence,
} from "./cuts.js";
import { FPS, pcm, probe, silencePass, syncOffset, wav16k } from "./media.js";
import { SHORT_COUNT, SHORT_S } from "./props.js";
import {
  CUT_STATES,
  CUT_WHYS,
  type Cut,
  FORMATS,
  type Format,
  LAYOUTS,
  type RenderState,
  type Track,
  type Tracks,
  type VideoEdit,
  videoEdits,
  type Word,
} from "./schema.js";
import { checkStress, remapStress } from "./stress.js";
import { transcribe } from "./whisper.js";
import { fixWordAt, fixWords } from "./words.js";

export const STUDIO_COMPONENT = "studio";

/** The cut knobs; a bad block reads as the defaults. */
export async function cutKnobs(db: Queryable): Promise<CutKnobs> {
  const block = (await settingsFor(db, null))[STUDIO_COMPONENT] as { cuts?: unknown } | undefined;
  const p = cutKnobsSchema.safeParse(block?.cuts ?? {});
  return p.success ? p.data : CUT_DEFAULTS;
}

export async function setCutKnobs(
  db: Queryable,
  patch: Partial<CutKnobs>,
  by: string,
): Promise<CutKnobs> {
  return atomic(db, async (tx) => {
    const block = ((await settingsFor(tx, null))[STUDIO_COMPONENT] ?? {}) as Record<
      string,
      unknown
    >;
    const cuts = cutKnobsSchema.parse({ ...(await cutKnobs(tx)), ...patch });
    await setWrenSettings(tx, STUDIO_COMPONENT, { ...block, cuts }, by);
    return cuts;
  });
}

/** Names and jargon Whisper should spell right (`studio.words`): its prompt on ingest. */
export async function studioWords(db: Queryable): Promise<string[]> {
  const block = (await settingsFor(db, null))[STUDIO_COMPONENT] as { words?: unknown } | undefined;
  const p = z
    .array(z.string().min(1).max(60))
    .max(200)
    .safeParse(block?.words ?? []);
  return p.success ? p.data : [];
}

export async function setStudioWords(db: Queryable, words: string[], by: string) {
  return atomic(db, async (tx) => {
    const block = ((await settingsFor(tx, null))[STUDIO_COMPONENT] ?? {}) as Record<
      string,
      unknown
    >;
    const list = z
      .array(z.string().trim().min(1).max(60))
      .max(200)
      .parse([...new Set(words.map((w) => w.trim()).filter(Boolean))]);
    await setWrenSettings(tx, STUDIO_COMPONENT, { ...block, words: list }, by);
    return list;
  });
}

/** What a recording renders as by its shape: landscape the long video, portrait the vertical. */
export const formatsFor = (main: Pick<Track, "width" | "height">): Format[] =>
  main.height > main.width ? ["vertical"] : ["long"];

export const VIDEO = /\.(mp4|mkv|mov|m4v|webm)$/i;
export const CAM = /cam|camera|webcam|face/i;

/**
 * The recording's tracks: a file, or a folder holding OBS's recording and Source Record's camera
 * file (named cam/camera/webcam/face, else the smaller picture).
 */
export async function findTracks(input: string): Promise<{ main: string; cam?: string }> {
  const at = resolve(input);
  if (VIDEO.test(at)) return { main: at };
  const files = (await readdir(at)).filter((f) => VIDEO.test(f) && !f.startsWith("cut-")).sort();
  if (files.length === 1) return { main: join(at, files[0] as string) };
  if (files.length !== 2)
    throw new Error(`${at}: ${files.length} videos; want one file, or the recording + camera`);
  const [a, b] = files as [string, string];
  // No camera name: addVideo takes the bigger picture as the screen.
  return CAM.test(a)
    ? { main: join(at, b), cam: join(at, a) }
    : { main: join(at, a), cam: join(at, b) };
}

export interface AddOptions {
  ffmpeg: string;
  script?: { url: string; text: string };
  camBox?: [number, number, number, number];
  /** Camera minus main seconds, when the camera file has no audio to sync by. */
  offsetS?: number;
  model?: string;
  log?: (line: string) => void;
}

/** Probe, sync, transcribe, run the silence pass and propose fillers; one new row. */
export async function addVideo(db: Queryable, input: string, o: AddOptions): Promise<VideoEdit> {
  const log = o.log ?? (() => {});
  // A Cap project carries its camera offset and name; OBS's files don't.
  const cap = isCap(input) ? await capTracks(resolve(input), o.ffmpeg) : null;
  const found = cap ?? (await findTracks(input));
  const title = cap ? (await capMeta(resolve(input)))?.pretty_name : undefined;
  let [main, cam] = await Promise.all([
    probe(found.main, o.ffmpeg),
    found.cam ? probe(found.cam, o.ffmpeg) : undefined,
  ]);
  // No camera name to go by: the bigger picture is the screen.
  if (cam && !CAM.test(basename(cam.path)) && cam.width * cam.height > main.width * main.height)
    [main, cam] = [cam, main];
  if (!main.audio) throw new Error(`${main.path}: no audio; the cuts are heard on the recording`);
  const dir = join(dirname(main.path), `wren-${basename(main.path, extname(main.path))}`);
  await mkdir(dir, { recursive: true });
  const { audio: _a, ...mainTrack } = main;
  const tracks: Tracks = { main: mainTrack };
  if (cam) {
    let offsetS = o.offsetS ?? cap?.offsetS;
    if (offsetS === undefined) {
      if (!cam.audio)
        throw new Error(`${cam.path}: no audio to sync by; pass --offset <camera minus main s>`);
      log("syncing camera to recording by audio");
      const [a, b] = await Promise.all([
        pcm(main.path, o.ffmpeg, 16000, 120),
        pcm(cam.path, o.ffmpeg, 16000, 120),
      ]);
      offsetS = syncOffset(a, b);
    }
    const { audio: _c, ...camTrack } = cam;
    tracks.cam = { ...camTrack, offsetS };
  }
  if (o.camBox) tracks.camBox = o.camBox;

  const knobs = await cutKnobs(db);
  const known = await studioWords(db);
  return (
    await recordedRun(
      db,
      { command: "video add", argv: { input, main: main.path, cam: cam?.path ?? null } },
      async () => {
        log("transcribing (whisper.cpp)");
        const wav = join(dir, "audio-16k.wav");
        await wav16k(main.path, wav, o.ffmpeg);
        const started = Date.now();
        const heard = await transcribe(wav, {
          ...(o.model ? { model: o.model } : {}),
          ...(known.length ? { prompt: known.join(", ") } : {}),
        });
        log(`${heard.length} words in ${((Date.now() - started) / 1000).toFixed(1)}s`);
        const { words, cuts } = await silencePass(
          main.path,
          heard,
          main.durationS,
          o.ffmpeg,
          knobs,
        );
        const [row] = await db
          .insert(videoEdits)
          .values({
            title: (title || basename(main.path, extname(main.path))).slice(0, 100),
            dir,
            tracks,
            script: o.script ?? null,
            words,
            cuts: withSilence(fillerProposals(words), cuts),
            formats: formatsFor(main),
          })
          .returning();
        return row as VideoEdit;
      },
    )
  ).stats;
}

export async function getEdit(db: Queryable, id: number): Promise<VideoEdit> {
  const [row] = await db.select().from(videoEdits).where(eq(videoEdits.id, id));
  if (!row) throw new Error(`no video ${id}`);
  return row;
}

const sec = z.number().min(0);
const span = { from: sec, to: sec };

/** What `wren video set` takes: any of these fields, replaced whole. Words and tracks are ingest's. */
export const editPatchSchema = z
  .object({
    title: z.string().max(100),
    description: z.string().max(5000),
    tags: z.array(z.string().min(1).max(100)).max(30),
    chapters: z.array(z.object({ at: sec, title: z.string().min(1).max(100) }).strict()),
    cuts: z.array(z.object({ ...span, why: z.enum(CUT_WHYS), state: z.enum(CUT_STATES) }).strict()),
    layout: z.array(z.object({ ...span, show: z.enum(LAYOUTS) }).strict()),
    captions: z
      .object({
        style: z.enum(CAPTION_STYLES),
        long: z.enum(CAPTION_SHOWS).optional(),
        short: z.enum(CAPTION_SHOWS).optional(),
        behind: z.boolean().optional(),
        // A row from before per-format captions: its `on` becomes `short` and goes.
        on: z.boolean().optional(),
      })
      .strict()
      .transform(({ on, ...c }) =>
        on === false && !c.short ? { ...c, short: "track" as const } : c,
      ),
    /** Stressed words, as indexes into `words` (step 6). */
    stress: z.array(z.number().int().min(0)).max(500),
    shorts: z.array(z.object({ ...span, title: z.string().max(100) }).strict()),
    formats: z
      .array(z.enum(FORMATS))
      .min(1)
      .refine((f) => new Set(f).size === f.length, "each format once"),
    thumbnail: z
      .object({ at: sec, text: z.string().max(60) })
      .strict()
      .nullable(),
  })
  .partial()
  .strict();
export type EditPatch = z.infer<typeof editPatchSchema>;

/**
 * Refuse a range backwards or past the end, Shorts off the rules (none, or 2 to 4 of 20 to 60 s
 * each once cut), and stressed words off the spacing rule once cut (`stressOnCut`). `cuts`: the
 * edit's, unless the patch sets them too.
 */
export function checkPatch(
  patch: EditPatch,
  durationS: number,
  cuts: readonly Cut[] = [],
  words: readonly Word[] = [],
): string[] {
  const bad: string[] = [];
  const ranges = (name: string, xs: readonly { from: number; to: number }[] | undefined) =>
    xs?.forEach((r, i) => {
      if (!(r.to > r.from)) bad.push(`${name}[${i}]: to must be after from`);
      if (r.to > durationS + 0.001) bad.push(`${name}[${i}]: past the end (${durationS}s)`);
    });
  ranges("cuts", patch.cuts);
  ranges("layout", patch.layout);
  ranges("shorts", patch.shorts);
  for (const [name, at] of [
    ...(patch.chapters ?? []).map((c, i) => [`chapters[${i}]`, c.at] as const),
    ...(patch.thumbnail ? [["thumbnail", patch.thumbnail.at] as const] : []),
  ])
    if (at > durationS) bad.push(`${name}: past the end (${durationS}s)`);
  const shorts = patch.shorts ?? [];
  if (shorts.length && (shorts.length < SHORT_COUNT.min || shorts.length > SHORT_COUNT.max))
    bad.push(`shorts: ${shorts.length} picked; want ${SHORT_COUNT.min} to ${SHORT_COUNT.max}`);
  const keep = keepSegments(patch.cuts ?? cuts, durationS, FPS);
  shorts.forEach((r, i) => {
    const len = onCut(r.to, keep) - onCut(r.from, keep);
    if (len < SHORT_S.min || len > SHORT_S.max)
      bad.push(`shorts[${i}]: ${len.toFixed(1)}s once cut; want ${SHORT_S.min} to ${SHORT_S.max}`);
  });
  if (patch.stress) bad.push(...stressOnCut(words, patch.stress, keep));
  return bad;
}

/**
 * Stressed words checked as they play: each a word that isn't cut out, then the spacing rule
 * (`checkStress`) on the cut timeline, where a cut can bring two picks together.
 */
export function stressOnCut(
  words: readonly Word[],
  stress: readonly number[],
  keep: ReturnType<typeof keepSegments>,
): string[] {
  const at = new Map<number, number>();
  const cut: Word[] = [];
  words.forEach((w, i) => {
    const s = toCutTime(w.s, keep);
    if (s === null) return;
    at.set(i, cut.length);
    cut.push({ w: w.w, s, e: Math.max(s, onCut(w.e, keep)) });
  });
  const bad = stress.flatMap((i, n) =>
    i >= words.length
      ? [`stress[${n}]: no word ${i} (${words.length} words)`]
      : at.has(i)
        ? []
        : [`stress[${n}]: "${(words[i] as Word).w}" at ${(words[i] as Word).s.toFixed(1)}s is cut`],
  );
  if (bad.length) return bad;
  return checkStress(
    cut,
    stress.map((i) => at.get(i) as number),
  ).map((b) => `stress: ${b} (once cut)`);
}

/**
 * Write fields of the edit, checked, with a `runs` row holding what they were: `run` when one is
 * open (an Ask on the page), else a new one.
 */
export async function setEdit(
  db: Queryable,
  id: number,
  input: unknown,
  o: { by: string; command?: string; run?: string; stats?: object },
): Promise<{ run: string; edit: VideoEdit }> {
  const parsed = editPatchSchema.safeParse(input);
  if (!parsed.success)
    throw new Error(
      `not set: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  const patch = { ...parsed.data };
  if (patch.cuts) patch.cuts = [...patch.cuts].sort((a, b) => a.from - b.from || a.to - b.to);
  return atomic(db, async (tx) => {
    const now = await getEdit(tx, id);
    if (patch.stress) patch.stress = [...patch.stress].sort((a, b) => a - b);
    const bad = checkPatch(patch, now.tracks.main.durationS, now.cuts, now.words);
    if (bad.length) throw new Error(`not set: ${bad.join("; ")}`);
    const before = Object.fromEntries(
      Object.keys(patch).map((k) => [k, now[k as keyof EditPatch]]),
    );
    const [edit] = await tx
      .update(videoEdits)
      .set({ ...patch, state: now.state === "added" ? "edited" : now.state, updatedAt: new Date() })
      .where(eq(videoEdits.id, id))
      .returning();
    const run =
      o.run ??
      (
        await openRun(tx, {
          command: o.command ?? "video set",
          argv: { id, fields: Object.keys(patch), by: o.by },
        })
      ).id;
    await finishRun(tx, run, { ...o.stats, fields: Object.keys(patch), before });
    if (edit && (edit.title !== now.title || edit.description !== now.description))
      // An open run with no command is an Ask on the page: Claude's words.
      await keepWords(tx, now, edit, { ...o, run, asked: !!o.run && !o.command });
    return { run, edit: edit as VideoEdit };
  });
}

/**
 * A title or description change in the draft record (`video:<id>`): the words it started from
 * once, then each version, Claude's when an Ask wrote it.
 */
async function keepWords(
  db: Queryable,
  before: VideoEdit,
  after: VideoEdit,
  o: { by: string; command?: string; run: string; asked: boolean },
) {
  const item = `video:${before.id}`;
  if (before.title || before.description)
    await recordDraft(db, {
      item,
      kind: "video",
      platform: "youtube",
      event: "generated",
      via: "wren",
      by: "video add",
      text: before.description,
      title: before.title,
      ref: `${item}:first`,
      at: before.createdAt,
    });
  await recordDraft(db, {
    item,
    kind: "video",
    platform: "youtube",
    event: "edited",
    via: o.asked ? "claude" : "person",
    by: o.by,
    text: after.description,
    title: after.title,
    meta: o.command === "video undo" ? { undo: true } : {},
    runId: o.run,
  });
}

/**
 * The stressed words, whole (`wren video stress`): checked like `set`, a `runs` row of its own so
 * Undo puts the last list back.
 */
export function setStress(
  db: Queryable,
  id: number,
  stress: number[],
  o: { by: string; stats?: object },
) {
  return setEdit(db, id, { stress }, { ...o, command: "video stress" });
}

/** A transcript fix: every match of `wrong`, or the one word at `at` seconds. */
export type WordsFix = { wrong: string; right: string } | { at: number; text: string };

const wordSchema = z.object({ w: z.string().min(1), s: sec, e: sec }).strict();

/**
 * Rewrite the transcript's text, never its times (`wren video words`, the page's transcript): a
 * fix, or (Undo) the words as they were. One `runs` row holding the words before.
 */
export async function setWords(
  db: Queryable,
  id: number,
  change: WordsFix | { words: unknown; stress?: unknown },
  o: { by: string; command?: string },
): Promise<{ run: string; n: number; edit: VideoEdit }> {
  return atomic(db, async (tx) => {
    const now = await getEdit(tx, id);
    const r =
      "words" in change
        ? { words: z.array(wordSchema).parse(change.words), n: 1 }
        : "wrong" in change
          ? fixWords(now.words, change.wrong, change.right)
          : fixWordAt(now.words, change.at, change.text);
    if (!r.n) throw new Error(`no "${"wrong" in change ? change.wrong : ""}" in the transcript`);
    // A fix that merges or splits words moves the stressed words with them.
    const stress =
      "words" in change && change.stress !== undefined
        ? z.array(z.number().int().min(0)).parse(change.stress)
        : remapStress(now.words, r.words as Word[], now.stress);
    const [edit] = await tx
      .update(videoEdits)
      .set({ words: r.words as Word[], stress, updatedAt: new Date() })
      .where(eq(videoEdits.id, id))
      .returning();
    const moved = stress.length !== now.stress.length || stress.some((x, k) => x !== now.stress[k]);
    const fields = moved ? ["words", "stress"] : ["words"];
    const { id: run } = await openRun(tx, {
      command: o.command ?? "video words",
      argv: { id, by: o.by, ...("words" in change ? {} : change) },
    });
    await finishRun(tx, run, { fields, n: r.n, before: { words: now.words, stress: now.stress } });
    return { run, n: r.n, edit: edit as VideoEdit };
  });
}

/** Undo cut `n` (1-based, as `wren video cuts` numbers them). */
export async function keepCut(db: Queryable, id: number, n: number, by: string) {
  const { cuts } = await getEdit(db, id);
  if (!cuts[n - 1]) throw new Error(`video ${id} has ${cuts.length} cuts; no ${n}`);
  const next = cuts.map((c, i) => (i === n - 1 ? { ...c, state: "kept" as const } : c));
  return setEdit(db, id, { cuts: next }, { by, command: "video keep" });
}

/**
 * Cut or keep [from, to]: the cut with those ends (to the ms), else a new manual cut, as the page
 * sends a span of words picked in the transcript.
 */
export async function setCut(
  db: Queryable,
  id: number,
  span: { from: number; to: number },
  state: "cut" | "kept",
  by: string,
) {
  const { cuts } = await getEdit(db, id);
  const same = (a: number, b: number) => Math.abs(a - b) < 0.001;
  const i = cuts.findIndex((c) => same(c.from, span.from) && same(c.to, span.to));
  if (i < 0 && state === "kept") throw new Error("no cut there to keep");
  const next =
    i < 0
      ? [...cuts, { from: span.from, to: span.to, why: "manual" as const, state }]
      : cuts.map((c, j) => (j === i ? { ...c, state } : c));
  return setEdit(db, id, { cuts: next }, { by, command: i < 0 ? "video cut-words" : "video keep" });
}

/** A render's way through: waiting, rendering, failed and why; null when done. */
export async function setRender(db: Queryable, id: number, render: RenderState | null) {
  await db.update(videoEdits).set({ render, updatedAt: new Date() }).where(eq(videoEdits.id, id));
}

/** Rerun the silence pass with today's knobs; other cuts stay as they are. */
export async function redoSilence(db: Queryable, id: number, ffmpeg: string, by: string) {
  const e = await getEdit(db, id);
  const { cuts: fresh } = await silencePass(
    e.tracks.main.path,
    e.words,
    e.tracks.main.durationS,
    ffmpeg,
    await cutKnobs(db),
  );
  return setEdit(db, id, { cuts: withSilence(e.cuts, fresh) }, { by, command: "video cuts" });
}

/** A render's files and S3 keys, merged into the row's; the state moves to rendered. */
export async function setRendered(
  db: Queryable,
  id: number,
  files: Record<string, string>,
  keys: Record<string, string>,
) {
  const e = await getEdit(db, id);
  await db
    .update(videoEdits)
    .set({
      files: { ...e.files, ...files },
      keys: { ...e.keys, ...keys },
      state: e.state === "added" || e.state === "edited" ? "rendered" : e.state,
      render: null,
      updatedAt: new Date(),
    })
    .where(eq(videoEdits.id, id));
}

/** Local files the cut pass or a render wrote. */
export async function setFiles(db: Queryable, id: number, files: Record<string, string>) {
  const e = await getEdit(db, id);
  await db
    .update(videoEdits)
    .set({ files: { ...e.files, ...files }, updatedAt: new Date() })
    .where(eq(videoEdits.id, id));
}

export async function setLook(db: Queryable, id: number, provider: string, look: unknown) {
  const e = await getEdit(db, id);
  await db
    .update(videoEdits)
    .set({ looks: { ...e.looks, [provider]: look } as VideoEdit["looks"], updatedAt: new Date() })
    .where(eq(videoEdits.id, id));
}

/** TwelveLabs minutes spent by every edit's looks: what the free-plan stop counts. */
export async function twelvelabsMinutes(db: Queryable): Promise<number> {
  const rows = await db.select({ looks: videoEdits.looks }).from(videoEdits);
  return rows.reduce((n, r) => n + (r.looks.twelvelabs?.media?.minutes ?? 0), 0);
}
