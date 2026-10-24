/**
 * Change an edit in one sentence (designs/2026-10-15-storyboard.md): the sentence and the edit go
 * to the model, which answers a patch in `VideoDesk.set`'s shape and one plain line per change.
 * Wren checks the patch the way `wren video set` does (`readyPatch`), and shows the storyboard as
 * it would be after. Nothing is written but a `video propose` run; Apply is `setEdit` with the
 * fields as they were (`expect`), so a change made meanwhile refuses instead of being overwritten.
 * The page (`VideoDesk.propose`), `wren video ask` and Claude Code through the CLI all run this.
 */
import { finishRun, openRun } from "@wren/core";
import type { Queryable } from "@wren/db";
import { z } from "zod";
import { CAPTION_SHOWS, CAPTION_STYLES } from "./caption-styles.js";
import { reviewCuts } from "./cuts.js";
import {
  type EditPatch,
  editField,
  getEdit,
  readyPatch,
  sameJson,
  setEdit,
  withPatch,
} from "./edit.js";
import { OVERLAY } from "./finish-look.js";
import { CARD, SHORT_COUNT, SHORT_S } from "./props.js";
import { type Cut, FORMATS, LAYOUTS, type VideoEdit } from "./schema.js";
import type { Moved } from "./sentences.js";
import { KIT_IDS, SOUND_RULES } from "./sounds.js";
import {
  type Beat,
  type BoardChange,
  beatText,
  boardChange,
  type Storyboard,
  storyboardOf,
  storyboardText,
} from "./storyboard.js";
import type { StressModel } from "./stress.js";

export const VIDEO_PROPOSE = "video propose";

export const CHANGE = {
  /** Longest sentence he can send. */
  maxChars: 1000,
  /** Asks per sentence: the first, then one more with what was refused. */
  asks: 2,
  /** Each beat's words in the prompt, at most. */
  beatChars: 900,
  descriptionChars: 1500,
  maxTokens: 4000,
} as const;

/** What the model may answer for `cuts`: only the ones to change. */
const CUT_CHANGES = z.array(
  z.object({ from: z.number(), to: z.number(), state: z.enum(["cut", "kept"]) }),
);

/**
 * Cut changes onto the cuts: the cut with the same ends (to the ms) takes the state, else a new
 * manual cut. Checked by `readyPatch` after.
 */
export function withCutChanges(cuts: readonly Cut[], changes: unknown): Cut[] {
  const out = [...cuts];
  for (const c of CUT_CHANGES.parse(changes)) {
    const i = out.findIndex(
      (x) => Math.abs(x.from - c.from) < 0.001 && Math.abs(x.to - c.to) < 0.001,
    );
    if (i >= 0) out[i] = { ...(out[i] as Cut), state: c.state };
    else if (c.state === "cut") out.push({ from: c.from, to: c.to, why: "manual", state: "cut" });
  }
  return out;
}

/** The rules the model edits by: the fields `VideoDesk.set` takes, in plain words. */
export function changeSystem(): string {
  return [
    "You change one recorded video's edit from a sentence he says. You never render.",
    'Answer only JSON: {"changes": ["one short plain line per change"], "patch": {...} or null}.',
    "The patch holds only the fields that change. Each field is replaced whole, except cuts.",
    "Every time is seconds on the raw recording, the times the storyboard shows.",
    "Fields:",
    "- title (up to 100 characters), description, tags (list of words).",
    "- chapters: [{at, title}], the first at 0.",
    '- cuts: only the cuts to change, [{from, to, state}], state "cut" (taken out) or "kept" (put back). A cut from the list keeps its exact from and to. A new span with state "cut" is a new cut. "Tighter" means cut the proposed fillers and retakes, or long pauses between sentences.',
    `- layout: [{from, to, show}], show one of ${LAYOUTS.join(", ")} (corner: his camera in the corner; cam: his face only; screen: the screen only). Outside every range it is corner. Send the whole list.`,
    `- captions: {style, long, short, behind, place}. style one of ${CAPTION_STYLES.join(", ")}. long and short: ${CAPTION_SHOWS.join(" or ")} (screen: burned into the picture; track: subtitle file only). place: {long 0.1-0.92, short 0.12-0.8}, the line's height from the top. Send the whole object.`,
    `- overlays: text on the video, [{text, from, to, x, y, size}], text up to ${OVERLAY.maxChars} characters, x and y the text's middle as ${OVERLAY.margin}-${1 - OVERLAY.margin} of the frame, size s, m or l, on screen at least ${OVERLAY.minS}s. Send the whole list. "Make sure this says X" on screen is an overlay.`,
    `- shorts: [{from, to, title, card, cardText}], none or ${SHORT_COUNT.min} to ${SHORT_COUNT.max}, each ${SHORT_S.min}-${SHORT_S.max}s once cut, on whole sentences (Wren moves the ends to the nearest sentence). card false hides the title on screen; cardText (up to ${CARD.maxChars}) replaces it. Send the whole list.`,
    `- sounds: kit sounds at moments, [{at, id, gainDb, only}], id one of ${KIT_IDS.join(", ")}. gainDb (-60 to 12) only when he asks for louder or softer; only "long" or "short" for one output. Wren places these on its own: ${SOUND_RULES.map((r) => r.says).join("; ")}. Send the whole list; leave the automatic ones in unless he asks.`,
    "- music: the bed under the whole video, {id, gainDb, duck} or null. duck false keeps it level under speech. A bed is a kit id that starts with bed-; ask him to add one with wren video sfx add when there is none.",
    `- formats: any of ${FORMATS.join(", ")}, each once.`,
    "- thumbnail: {at, text} (text up to 60 characters), the cover frame.",
    "- crops: {vertical, square, portrait: {x, y} 0-1 of the picture}.",
    "The words he said (the transcript) can't change here, nor the caption size. If he asks for what can't be done, patch null and one line saying so.",
    "Change only what he asked. Keep times inside the recording. Each line says what changes and where, like: Cut the pause at 1:12. No other text.",
  ].join("\n");
}

const min = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** The edit now, as the model reads it: fields, the choices among the cuts, the storyboard. */
export function changePrompt(
  e: VideoEdit,
  sentence: string,
  o: { board?: Storyboard; beat?: Beat | null; refused?: string[] } = {},
): string {
  const board = o.board ?? storyboardOf(e);
  // Silence cuts are many and settled; fillers, retakes and his own are the choices.
  const cuts = reviewCuts(e.cuts, e.words)
    .filter((r) => r.cut.why !== "silence")
    .map((r) => ({
      from: r.cut.from,
      to: r.cut.to,
      why: r.cut.why,
      state: r.cut.state,
      around: `${r.before} | ${r.after}`,
    }));
  const now = {
    title: e.title,
    description: e.description.slice(0, CHANGE.descriptionChars),
    tags: e.tags,
    chapters: e.chapters,
    shorts: e.shorts,
    layout: e.layout,
    captions: e.captions,
    overlays: e.overlays,
    sounds: e.sounds,
    music: e.music,
    formats: e.formats,
    thumbnail: e.thumbnail,
    crops: e.crops,
    cuts,
    rawSeconds: e.tracks.main.durationS,
    hasCameraFile: !!e.tracks.cam,
  };
  return [
    "The edit now:",
    JSON.stringify(now),
    "",
    "The storyboard (raw times; plays = once cut):",
    storyboardText(board, { max: CHANGE.beatChars }),
    ...(o.beat
      ? ["", `He means this frame (${min(o.beat.from)}-${min(o.beat.to)}):`, ...beatText(o.beat)]
      : []),
    "",
    `He says: ${sentence}`,
    ...(o.refused?.length
      ? [
          "",
          `Your last patch was refused: ${o.refused.join("; ")}. Fix it and answer the whole JSON again.`,
        ]
      : []),
  ].join("\n");
}

const ANSWER = z.object({
  changes: z.array(z.string()).default([]),
  patch: z.record(z.string(), z.unknown()).nullable().default(null),
});

/** The model's answer: the first JSON object in it, else null (it said words, not JSON). */
export function changeAnswerOf(
  text: string,
): { changes: string[]; patch: Record<string, unknown> | null } | null {
  const from = text.indexOf("{");
  if (from < 0) return null;
  try {
    const got = ANSWER.safeParse(JSON.parse(text.slice(from, text.lastIndexOf("}") + 1)));
    if (!got.success) return null;
    const patch = got.data.patch && Object.keys(got.data.patch).length ? got.data.patch : null;
    return { changes: got.data.changes.map((c) => c.trim()).filter(Boolean), patch };
  } catch {
    return null;
  }
}

export interface Checked {
  /** In `VideoDesk.set`'s shape, fields that change only; null when nothing would. */
  patch: EditPatch | null;
  /** What each field was: Apply sends it, so a change made meanwhile refuses. */
  expect: Record<string, unknown>;
  issues: string[];
  snapped: Moved[];
}

/**
 * The model's patch checked as `wren video set` checks it: cut changes merged onto the cuts,
 * parsed, Shorts snapped, `checkPatch`. Fields it leaves as they are drop out.
 */
export function checkChange(e: VideoEdit, raw: Record<string, unknown> | null): Checked {
  const none = { patch: null, expect: {}, snapped: [] };
  if (!raw) return { ...none, issues: [] };
  const { cuts, ...rest } = raw;
  let input: Record<string, unknown> = rest;
  if (cuts !== undefined) {
    try {
      input = { ...rest, cuts: withCutChanges(e.cuts, cuts) };
    } catch (err) {
      const why = err instanceof z.ZodError ? z.prettifyError(err) : String(err);
      return { ...none, issues: [`cuts: ${why.replace(/\s+/g, " ")}`] };
    }
  }
  const ready = readyPatch(e, input);
  if (!ready.patch) return { ...none, issues: ready.issues };
  const patch = Object.fromEntries(
    Object.entries(ready.patch).filter(([k, v]) => !sameJson(editField(e, k), v)),
  ) as EditPatch;
  const keys = Object.keys(patch);
  return {
    patch: keys.length ? patch : null,
    expect: Object.fromEntries(keys.map((k) => [k, editField(e, k)])),
    issues: ready.issues,
    snapped: ready.snapped,
  };
}

/** A sentence's proposal: what the page shows before Apply, and what Apply sends. */
export interface Proposal {
  /** The `video propose` run. */
  run: string;
  id: number;
  sentence: string;
  /** The frame it was said on, by key; null for the whole video. */
  beat: string | null;
  changes: string[];
  patch: EditPatch | null;
  expect: Record<string, unknown>;
  /** Why it can't be applied as it stands; empty when it can. */
  issues: string[];
  snapped: Moved[];
  /** The storyboard as it would be after, and what moved on it. */
  after: Storyboard;
  changed: BoardChange;
  model: string;
}

/** What answers a sentence: `@wren/llm`'s client fits; `answered` names who did. */
export type ChangeModel = StressModel & { answered?: string[]; name?: string };

/**
 * Ask the model for the change, check it, and show the board after. A refused patch is asked
 * again once with why; what's still refused comes back in `issues`. A `video propose` run holds
 * the sentence, the patch and the lines; nothing else is written.
 */
export async function proposeChange(
  db: Queryable,
  id: number,
  sentence: string,
  model: ChangeModel,
  o: { by: string; beat?: string | null },
): Promise<Proposal> {
  const said = sentence.trim();
  if (!said) throw new Error("Say what to change.");
  if (said.length > CHANGE.maxChars)
    throw new Error(`Keep it under ${CHANGE.maxChars} characters.`);
  const e = await getEdit(db, id);
  const board = storyboardOf(e);
  const beat = o.beat
    ? ([...board.beats, ...board.shorts].find((b) => b.key === o.beat) ?? null)
    : null;
  if (o.beat && !beat) throw new Error(`This video has no frame ${o.beat}. Reload the page.`);
  const { id: run } = await openRun(db, {
    command: VIDEO_PROPOSE,
    argv: { id, by: o.by, sentence: said, beat: o.beat ?? null },
    ...(model.name ? { model: model.name } : {}),
  });
  try {
    let answer: ReturnType<typeof changeAnswerOf> = null;
    let checked: Checked = { patch: null, expect: {}, issues: [], snapped: [] };
    let refused: string[] = [];
    let asks = 0;
    while (asks < CHANGE.asks) {
      asks++;
      const r = await model.complete(changePrompt(e, said, { board, beat, refused }), {
        system: changeSystem(),
        maxTokens: CHANGE.maxTokens,
      });
      answer = changeAnswerOf(r.text);
      if (!answer) {
        refused = ["the answer wasn't the JSON asked for"];
        continue;
      }
      checked = checkChange(e, answer.patch);
      refused = checked.issues;
      if (!refused.length) break;
    }
    const issues = answer ? checked.issues : refused;
    const changes = answer?.changes.length
      ? answer.changes
      : checked.patch
        ? Object.keys(checked.patch).map((k) => `Change ${k}.`)
        : ["Nothing to change."];
    const after = checked.patch ? storyboardOf(withPatch(e, checked.patch)) : board;
    const used = model.answered?.join(", ") ?? model.name ?? "";
    await finishRun(db, run, {
      changes,
      patch: checked.patch,
      issues,
      asks,
      ...(checked.snapped.length ? { snapped: checked.snapped } : {}),
      ...(used ? { model: used } : {}),
    });
    return {
      run,
      id,
      sentence: said,
      beat: o.beat ?? null,
      changes,
      patch: checked.patch,
      expect: checked.expect,
      issues,
      snapped: checked.snapped,
      after,
      changed: boardChange(board, after),
      model: used,
    };
  } catch (err) {
    await finishRun(db, run, { error: String((err as Error)?.message ?? err).slice(0, 5000) });
    throw err;
  }
}

/**
 * Apply a proposal: `setEdit`, as `VideoDesk.set` saves, with the fields as they were when it
 * was proposed. The `video set` run names the proposal; Undo puts the fields back.
 */
export function applyChange(
  db: Queryable,
  id: number,
  p: Pick<Proposal, "patch" | "expect" | "run">,
  by: string,
) {
  if (!p.patch) throw new Error("Nothing to apply.");
  return setEdit(db, id, p.patch, { by, expect: p.expect, stats: { proposal: p.run } });
}
