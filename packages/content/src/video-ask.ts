/**
 * Editing a video from its page (designs/2026-10-06-video-editor.md, step 4): Ask Claude's prompt
 * and answer, the page's turns, Undo. Every change is studio's `setEdit`, a `runs` row holding
 * what it replaced; Claude answers a patch, Wren checks and writes it.
 */
import { parseKind } from "@wren/core/slots";
import { type LiveTemplate, literalPrompt, renderPrompt } from "@wren/core/templates";
import type { Queryable } from "@wren/db";
import { setEdit } from "@wren/studio/edit";
import type { Cut, VideoEdit } from "@wren/studio/schema";
import { sql } from "drizzle-orm";
import { z } from "zod";

export const VIDEO_ASK = "video-ask";
/** The page's changes, newest last: Undo puts back what the newest one replaced. */
const CHANGES = ["video set", "video keep", "video cut-words", VIDEO_ASK, "video undo"];
export const VIDEO_ASK_MAX = 2000;
const QUESTION_MAX = 4000;
const SYSTEM_MAX = 8000;

const SYSTEM = `You help William edit one of his videos before it renders. You are read only: you can't change, render or upload anything, so never say you did. Wren applies the patch you give.
Answer with one JSON object and nothing else: {"reply": "...", "patch": {...}}.
- reply: what you changed, or your answer to his question. A sentence or two, plain text.
- patch: only the fields to change; null when he only asked something. Fields: title (100 chars max), description (5000), tags (30 strings), chapters [{"at", "title"}], shorts [{"from", "to", "title"}] (15 to 60 s each), thumbnail {"at", "text"} (text 60 max) or null, and cuts.
- cuts: only the cuts to change, [{"from", "to", "state"}], state "cut" or "kept". One that matches no cut is a new cut. Every other list you give replaces the whole list.
- Every time is seconds on the raw recording, as the transcript gives them.
Write as William: "I", casual, plain words, no em dashes.`;

/** The system prompt's words, as the template store first takes them (kind prompt). */
export const VIDEO_ASK_PROMPT = `${literalPrompt(SYSTEM)}
The transcript, each word with its start and end, and every cut: run \`node scripts/prod-wren.mjs video show {id}\`.

The edit now:
{now}`;
export const VIDEO_ASK_REF = { system: "content", name: "video-ask" } as const;
const SEED_PROMPT = parseKind("prompt", VIDEO_ASK_REF.name, VIDEO_ASK_PROMPT);

/**
 * The question and system prompt for one ask: the edit without its words, which Claude reads.
 * `prompt`: the store's.
 */
export function videoPrompt(
  e: VideoEdit,
  ask: { by: string; message: string },
  prompt: Pick<LiveTemplate, "template"> = { template: SEED_PROMPT },
) {
  const now = {
    title: e.title,
    description: e.description,
    tags: e.tags,
    chapters: e.chapters,
    shorts: e.shorts,
    thumbnail: e.thumbnail,
    // Silence cuts are many and his to leave; the rest are the choices.
    cuts: e.cuts.filter((c) => c.why !== "silence"),
    rawSeconds: e.tracks.main.durationS,
  };
  const system = renderPrompt(prompt, { id: e.id, now: JSON.stringify(now) });
  return {
    question: `${ask.by} asks: ${ask.message}`.slice(0, QUESTION_MAX),
    system: system.slice(0, SYSTEM_MAX),
    commands: [`Bash(node scripts/prod-wren.mjs video show ${e.id})`],
  };
}

const ANSWER = z.object({ reply: z.string(), patch: z.record(z.string(), z.unknown()).nullable() });

/** Claude's answer as `{reply, patch}`: the first JSON object in it. Words alone patch nothing. */
export function videoAnswerOf(text: string): z.infer<typeof ANSWER> {
  const from = text.indexOf("{");
  try {
    const got = ANSWER.safeParse(JSON.parse(text.slice(from, text.lastIndexOf("}") + 1)));
    if (from >= 0 && got.success)
      return {
        reply: got.data.reply.trim(),
        patch: got.data.patch && Object.keys(got.data.patch).length ? got.data.patch : null,
      };
  } catch {
    // Not JSON: said in words.
  }
  return { reply: text.trim(), patch: null };
}

const CUT_CHANGES = z.array(
  z.object({ from: z.number(), to: z.number(), state: z.enum(["cut", "kept"]) }),
);

/**
 * Cut changes onto the cuts: the cut with the same ends (to the ms) takes the state, else a new
 * manual cut. Checked by `setEdit` after.
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

/** Claude's patch, cut changes merged in, written by `setEdit` on the ask's own run. */
export function applyAnswer(
  db: Queryable,
  e: VideoEdit,
  patch: Record<string, unknown>,
  o: { by: string; run: string; stats: object },
) {
  const { cuts, ...rest } = patch;
  const full = cuts === undefined ? rest : { ...rest, cuts: withCutChanges(e.cuts, cuts) };
  return setEdit(db, e.id, full, o);
}

export interface VideoTurn {
  id: string;
  command: string;
  by: string | null;
  message: string | null;
  at: string;
  state: "thinking" | "failed" | "done";
  reply: string | null;
  fields: string[] | null;
  error: string | null;
}

/** The page's changes to one video, oldest first: asks, saves, cuts, undos. */
export const videoTurns = async (db: Queryable, id: number) =>
  (await db.execute(sql`
    SELECT id::text, command, argv->>'by' AS by, argv->>'message' AS message, started_at AS at,
      CASE WHEN finished_at IS NULL THEN 'thinking' WHEN stats ? 'error' THEN 'failed'
        ELSE 'done' END AS state,
      stats->>'reply' AS reply, stats->'fields' AS fields, stats->>'error' AS error
    FROM runs WHERE command IN (${sql.join(
      CHANGES.map((c) => sql`${c}`),
      sql`, `,
    )}) AND argv->>'id' = ${String(id)}
    ORDER BY started_at, id`)) as unknown as VideoTurn[];

/** Put back what the newest change replaced. Undo twice and the change is back. */
export async function undoVideo(db: Queryable, id: number, by: string) {
  const [last] = (await db.execute(sql`
    SELECT id::text, stats->'before' AS before FROM runs
    WHERE command IN (${sql.join(
      CHANGES.map((c) => sql`${c}`),
      sql`, `,
    )}) AND argv->>'id' = ${String(id)}
      AND finished_at IS NOT NULL AND stats ? 'before' AND NOT stats ? 'error'
    ORDER BY started_at DESC, id DESC LIMIT 1`)) as unknown as { id: string; before: object }[];
  if (!last || !Object.keys(last.before).length) throw new Error("nothing to undo");
  return setEdit(db, id, last.before, { by, command: "video undo" });
}
