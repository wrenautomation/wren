/**
 * How an item is made (designs/2026-10-11-competitor-breakdowns.md, 2026-10-25-competitor-analyzer.md):
 * its hook style from a fixed set, the hook line and why it works, the beats, the call to action,
 * and its kind's facts. Read off the transcript once it is read, by the same judge that scored it
 * (a client's on its own allowance). The style set is fixed and the same for every kind, so items
 * group: "which hook reaches in my space" is a count, not a read.
 *
 * Code counts, the model reads: a post's lengths and a film's cuts are measured here; the model
 * labels only the closed sets (hook style, a post's shape, a reel's format) and the free text.
 */
import { isVendorStop } from "@wren/core/metered";
import type { Db } from "@wren/db";
import { completeAndParse } from "@wren/llm";
import { readWatchFacts } from "@wrenautomation/falcon/video";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { secondsOf } from "./feeds.js";
import { type FilmFacts, filmFacts, filmFactsSchema } from "./film.js";
import { factFindings } from "./findings.js";
import {
  type Beat,
  type BreakdownBy,
  breakdowns,
  CTA_KINDS,
  HOOK_STYLES,
  type HookStyle,
  type ItemKind,
  items,
  POST_FORMATS,
  POST_LINKS,
  POST_MEDIA,
  POST_SHAPES,
} from "./schema.js";
import type { JudgeFor } from "./score.js";

/** Text the model sees: a reel whole, a long video's opening (the hook and the first beats). */
const PROMPT_TEXT = 6_000;
const TRIES = 2;

/** The kinds with a rubric: a hook, beats and facts to read. */
export const BROKEN_DOWN = ["reel", "video", "post", "film"] as const satisfies readonly ItemKind[];
export type BrokenDown = (typeof BROKEN_DOWN)[number];
const isBrokenDown = (k: ItemKind): k is BrokenDown =>
  (BROKEN_DOWN as readonly string[]).includes(k);

/** Each style as the model is told it: what the opening does. */
export const HOOK_STYLE_ABOUT: Record<HookStyle, string> = {
  contrarian: "says a common belief is wrong",
  "demo-first": "opens on the thing working, before any talk (a post: on a screenshot or clip)",
  "result-first": "opens on a number or an outcome",
  "identity-call": "names who it is for (if you use X, if you run Y)",
  "list-tease": "promises a count of things (5 tools, 3 mistakes)",
  question: "opens on a question to the viewer",
  story: "drops into a moment of a story",
  warning: "stop doing X, a mistake, a risk",
  news: "something just launched or changed",
  "how-to": "here is how to do X",
  "pattern-break": "an odd sight, sound or line that stops the scroll",
  other: "none of these",
};

/** The shared answer: the fields every kind has. */
const sharedSchema = z.object({
  hook_style: z.enum(HOOK_STYLES),
  hook: z.string().min(1).max(300),
  hook_why: z.string().min(1).max(300),
  topic: z.string().min(1).max(120),
  beats: z
    .array(z.object({ at: z.string().optional(), beat: z.string().min(1).max(160) }))
    .min(1)
    .max(8),
  cta_kind: z.enum(CTA_KINDS),
  cta: z.string().max(200).nullish(),
});

/** What the model labels past the shared fields, by kind: closed sets only. */
const LABELS = {
  reel: { format: z.enum(POST_FORMATS) },
  video: { format: z.enum(POST_FORMATS) },
  post: { shape: z.enum(POST_SHAPES) },
  film: {},
} as const satisfies Record<BrokenDown, z.ZodRawShape>;

export const breakdownSchema = sharedSchema.extend(LABELS.reel);
export const answerSchema = <K extends BrokenDown>(kind: K) => sharedSchema.extend(LABELS[kind]);
type Answer = z.infer<typeof sharedSchema> & {
  format?: string;
  shape?: string;
};

/** The facts each kind's row carries, checked at write time. */
export const postFactsSchema = z.object({
  format: z.enum(POST_MEDIA).nullable(),
  chars: z.number().int().min(0),
  lines: z.number().int().min(0),
  first_line_chars: z.number().int().min(0),
  link: z.enum(POST_LINKS).nullable(),
  hashtags: z.number().int().min(0),
  shape: z.enum(POST_SHAPES),
});
export type PostFacts = z.infer<typeof postFactsSchema>;
export const FACTS = {
  reel: z.object({ format: z.enum(POST_FORMATS) }),
  video: z.object({ format: z.enum(POST_FORMATS) }),
  post: postFactsSchema,
  film: filmFactsSchema,
} as const satisfies Record<BrokenDown, z.ZodTypeAny>;

/** A post's counts, from its text alone. `link` is `body` or unknown: a link in a comment is not in the saved text. */
export function postCounts(text: string): Omit<PostFacts, "shape" | "format"> {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return {
    chars: text.trim().length,
    lines: lines.length,
    first_line_chars: lines[0]?.length ?? 0,
    link: /https?:\/\/|\bwww\./i.test(text) ? "body" : null,
    hashtags: (text.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length,
  };
}

/** What each kind is called to the model, and what its beats are. */
const ABOUT: Record<BrokenDown, { thing: string; beats: string }> = {
  reel: {
    thing: "short video",
    beats: "m:ss from the [m:ss] marks, when there are any",
  },
  video: {
    thing: "video",
    beats: "m:ss from the [m:ss] marks, when there are any",
  },
  post: { thing: "post (text, image or carousel)", beats: "" },
  film: {
    thing: "product launch film",
    beats: "m:ss from the [m:ss] marks, when there are any",
  },
};

export function breakdownPrompt(item: {
  kind?: BrokenDown;
  title: string;
  url: string;
  text: string;
}): string {
  const kind = item.kind ?? "reel";
  const about = ABOUT[kind];
  const styles = HOOK_STYLES.map((h) => `- ${h}: ${HOOK_STYLE_ABOUT[h]}`).join("\n");
  const label =
    kind === "post"
      ? `Shapes: ${POST_SHAPES.join(", ")}.`
      : kind === "film"
        ? ""
        : `Formats: ${POST_FORMATS.join(", ")}.`;
  const labelField = kind === "post" ? `"shape": "..."` : kind === "film" ? "" : `"format": "..."`;
  const at = about.beats ? `"at": "${about.beats}", ` : "";
  const fields = [
    `"hook_style": "..."`,
    `"hook": "the opening line as said or shown"`,
    `"hook_why": "one sentence: why it stops the scroll"`,
    `"topic": "under 8 words"`,
    labelField,
    `"beats": [{${at}"beat": "what this part does, under 15 words"}] (3 to 8, in order, the hook first)`,
    `"cta_kind": "..."`,
    `"cta": "the ask as said, or null"`,
  ].filter(Boolean);
  return `Break down how this ${about.thing} is made, so it can be compared with others.

Hook styles (pick the one its first line does):
${styles}

${label ? `${label}\n` : ""}Calls to action: comment-word (comment a word to get something), follow, link (bio, site), dm, save-share, none, other.

Answer {${fields.join(", ")}}.

Title: ${item.title}
URL: ${item.url}
${item.text.slice(0, PROMPT_TEXT)}`;
}

/** The answer's beats in seconds where it gave a mark it can place. */
export function beatsOf(raw: Answer["beats"]): Beat[] {
  return raw.map((b) => ({
    t: b.at ? (b.at.trim() === "0:00" ? 0 : secondsOf(b.at)) : null,
    beat: b.beat,
  }));
}

/** A film's facts off its read page; null when the page has no facts fence (read before films had one). */
export function filmFactsOf(transcript: string): FilmFacts | null {
  const w = readWatchFacts(transcript);
  return w ? filmFacts(w, { speech: !/## Speech\n\n\(no speech\)/.test(transcript) }) : null;
}

/** The kind's facts for an item: code's counts, with the model's labels. Null when the item cannot give them. */
export function factsOf(
  item: { kind: BrokenDown; text: string; transcript: string },
  v: Answer,
): Record<string, unknown> | null {
  switch (item.kind) {
    case "reel":
    case "video":
      return { format: v.format };
    case "post":
      return { format: null, ...postCounts(item.text), shape: v.shape };
    case "film":
      return filmFactsOf(item.transcript);
  }
}

/**
 * Break down one read item through its workspace's judge, once. False when it isn't due (a kind
 * with no rubric, unread, done already, a film page with no facts), the judge waits (a client's
 * gate), or the answer didn't read twice. A provider failure throws, so the step retries.
 * `hand` facts (the seed study's) take the place of code's, and the row says so (`by`).
 */
export async function breakdownItem(
  db: Db,
  judgeFor: JudgeFor,
  id: number,
  hand?: { facts: Record<string, unknown>; by: BreakdownBy },
): Promise<boolean> {
  const [row] = await db
    .select({ item: items, done: breakdowns.itemId })
    .from(items)
    .leftJoin(breakdowns, eq(breakdowns.itemId, items.id))
    .where(eq(items.id, id));
  if (!row || row.done !== null) return false;
  const { item } = row;
  if (!isBrokenDown(item.kind) || !item.readAt || !item.transcript) return false;
  const kind = item.kind;
  const judge = await judgeFor(item.client);
  if (judge.wait || !judge.llm) return false;
  const prompt = breakdownPrompt({
    kind,
    title: item.title,
    url: item.url,
    text: item.transcript,
  });
  for (let i = 0; i < TRIES; i++) {
    const out = await completeAndParse(judge.llm, prompt, answerSchema(kind), {
      maxTokens: 900,
      system: `You study how ${ABOUT[kind].thing}s are made. Answer with JSON only.`,
      name: "learn.breakdown",
    }).catch((err: unknown) => {
      if (isVendorStop(err)) return null;
      throw err;
    });
    if (!out) return false;
    const v = out.parsed as Answer | null;
    if (!v) continue;
    const facts = hand?.facts ?? factsOf({ kind, text: item.text, transcript: item.transcript }, v);
    if (!facts) return false;
    const [row] = await db
      .insert(breakdowns)
      .values({
        itemId: id,
        hookStyle: v.hook_style,
        hook: v.hook,
        hookWhy: v.hook_why,
        topic: v.topic,
        kind,
        facts: FACTS[kind].parse(facts) as Record<string, unknown>,
        by: hand?.by ?? "model",
        beats: beatsOf(v.beats),
        ctaKind: v.cta_kind,
        cta: v.cta_kind === "none" ? null : (v.cta ?? null),
      })
      .onConflictDoNothing()
      .returning();
    if (row) await factFindings(db, row);
    return true;
  }
  return false;
}
