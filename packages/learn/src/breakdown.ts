/**
 * How an item is made (designs/2026-10-11-competitor-breakdowns.md, 2026-10-25-competitor-analyzer.md):
 * its hook style from a fixed set, the hook line and why it works, the beats, the call to action,
 * and its kind's facts. Read off the transcript once it is read, by the same judge that scored it
 * (a client's on its own allowance). The style set is fixed and the same for every kind, so items
 * group: "which hook reaches in my space" is a count, not a read.
 */
import { isVendorStop } from "@wren/core/metered";
import type { Db } from "@wren/db";
import { completeAndParse } from "@wren/llm";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { secondsOf } from "./feeds.js";
import {
  type Beat,
  breakdowns,
  CTA_KINDS,
  HOOK_STYLES,
  type HookStyle,
  type ItemKind,
  items,
  POST_FORMATS,
} from "./schema.js";
import type { JudgeFor } from "./score.js";

/** Text the model sees: a reel whole, a long video's opening (the hook and the first beats). */
const PROMPT_TEXT = 6_000;
const TRIES = 2;

/** The kinds with a rubric: a hook, beats and facts to read. */
export const BROKEN_DOWN = ["reel", "video"] as const satisfies readonly ItemKind[];
const isBrokenDown = (k: ItemKind): k is (typeof BROKEN_DOWN)[number] =>
  (BROKEN_DOWN as readonly string[]).includes(k);

/** Each style as the model is told it: what the opening does. */
export const HOOK_STYLE_ABOUT: Record<HookStyle, string> = {
  contrarian: "says a common belief is wrong",
  "demo-first": "opens on the thing working, before any talk",
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

export const breakdownSchema = z.object({
  hook_style: z.enum(HOOK_STYLES),
  hook: z.string().min(1).max(300),
  hook_why: z.string().min(1).max(300),
  topic: z.string().min(1).max(120),
  format: z.enum(POST_FORMATS),
  beats: z
    .array(z.object({ at: z.string().optional(), beat: z.string().min(1).max(160) }))
    .min(1)
    .max(8),
  cta_kind: z.enum(CTA_KINDS),
  cta: z.string().max(200).nullish(),
});
type BreakdownAnswer = z.infer<typeof breakdownSchema>;

export function breakdownPrompt(item: { title: string; url: string; text: string }): string {
  const styles = HOOK_STYLES.map((h) => `- ${h}: ${HOOK_STYLE_ABOUT[h]}`).join("\n");
  return `Break down how this short video is made, so it can be compared with others.

Hook styles (pick the one its first line does):
${styles}

Formats: ${POST_FORMATS.join(", ")}.
Calls to action: comment-word (comment a word to get something), follow, link (bio, site), dm, save-share, none, other.

Answer {"hook_style": "...", "hook": "the opening line as said or shown", "hook_why": "one sentence: why it stops the scroll", "topic": "under 8 words", "format": "...", "beats": [{"at": "m:ss from the [m:ss] marks, when there are any", "beat": "what this part does, under 15 words"}] (3 to 8, in order, the hook first), "cta_kind": "...", "cta": "the ask as said, or null"}.

Title: ${item.title}
URL: ${item.url}
${item.text.slice(0, PROMPT_TEXT)}`;
}

/** The answer's beats in seconds where it gave a mark it can place. */
export function beatsOf(raw: BreakdownAnswer["beats"]): Beat[] {
  return raw.map((b) => ({
    t: b.at ? (b.at.trim() === "0:00" ? 0 : secondsOf(b.at)) : null,
    beat: b.beat,
  }));
}

/**
 * Break down one read reel or video through its workspace's judge, once. False when it isn't due
 * (another kind, unread, done already), the judge waits (a client's gate), or the answer didn't
 * read twice. A provider failure throws, so the step retries.
 */
export async function breakdownItem(db: Db, judgeFor: JudgeFor, id: number): Promise<boolean> {
  const [row] = await db
    .select({ item: items, done: breakdowns.itemId })
    .from(items)
    .leftJoin(breakdowns, eq(breakdowns.itemId, items.id))
    .where(eq(items.id, id));
  if (!row || row.done !== null) return false;
  const { item } = row;
  if (!isBrokenDown(item.kind) || !item.readAt || !item.transcript) return false;
  const judge = await judgeFor(item.client);
  if (judge.wait || !judge.llm) return false;
  const prompt = breakdownPrompt({ title: item.title, url: item.url, text: item.transcript });
  for (let i = 0; i < TRIES; i++) {
    const out = await completeAndParse(judge.llm, prompt, breakdownSchema, {
      maxTokens: 900,
      system: "You study how short videos are made. Answer with JSON only.",
      name: "learn.breakdown",
    }).catch((err: unknown) => {
      if (isVendorStop(err)) return null;
      throw err;
    });
    if (!out) return false;
    const v = out.parsed;
    if (!v) continue;
    await db
      .insert(breakdowns)
      .values({
        itemId: id,
        hookStyle: v.hook_style,
        hook: v.hook,
        hookWhy: v.hook_why,
        topic: v.topic,
        kind: item.kind,
        facts: { format: v.format },
        beats: beatsOf(v.beats),
        ctaKind: v.cta_kind,
        cta: v.cta_kind === "none" ? null : (v.cta ?? null),
      })
      .onConflictDoNothing();
    return true;
  }
  return false;
}
