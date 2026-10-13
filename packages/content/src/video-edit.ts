/**
 * The editing agent's pass on one video (designs/2026-10-13-video-review.md): the prompt, its
 * answer, writing it, and what the page shows of it: the steps every video run took and the checks
 * he reads before Approve. The desk's `claude` stays read only; Wren writes what it answers.
 */
import { finishRun, openRun } from "@wren/core";
import { parseKind } from "@wren/core/slots";
import { type LiveTemplate, promptRef, renderPrompt } from "@wren/core/templates";
import { defaultSource } from "@wren/core/templates/defaults";
import { atomic, type Queryable } from "@wren/db";
import { reviewCuts } from "@wren/studio/cuts";
import { getEdit, setWords } from "@wren/studio/edit";
import { type RenderState, type VideoEdit, videoEdits } from "@wren/studio/schema";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { applyAnswer } from "./video-ask.js";

export const VIDEO_EDIT = "video-edit";
/** The system prompt (kind prompt, system `content`, name `video-edit`). */
export const VIDEO_EDIT_REF = { system: "content", name: "video-edit" } as const;
export const VIDEO_NOTE_MAX = 2000;
const SYSTEM_MAX = 12000;
/** Flagged cuts handed to the agent; the rest it reads with `video show`. */
const FLAGGED_MAX = 20;
/** A render that said "rendering" this long ago died with its Mac. */
export const RENDER_STALE_MS = 3 * 3600_000;
/** Renders from the page: never one approved (its upload points at the file) or rejected. */
export const RENDERABLE = ["added", "edited", "rendered"];

export const videoEditDefault = () =>
  parseKind(
    "prompt",
    VIDEO_EDIT_REF.name,
    defaultSource(promptRef(VIDEO_EDIT_REF.system, VIDEO_EDIT_REF.name)),
  );

/** The pass's question and system prompt: the edit without its words, which the agent reads. */
export function editPrompt(
  e: VideoEdit,
  ask: { by: string; note: string | null },
  prompt: Pick<LiveTemplate, "template"> = { template: videoEditDefault() },
) {
  const now = {
    title: e.title,
    description: e.description,
    tags: e.tags,
    chapters: e.chapters,
    shorts: e.shorts,
    thumbnail: e.thumbnail,
    cuts: e.cuts.filter((c) => c.why !== "silence"),
    flagged: reviewCuts(e.cuts, e.words)
      .filter((r) => r.flags.length && r.cut.state !== "kept")
      .slice(0, FLAGGED_MAX)
      .map((r) => ({
        from: r.cut.from,
        to: r.cut.to,
        flags: r.flags,
        before: r.before,
        after: r.after,
      })),
    rawSeconds: e.tracks.main.durationS,
  };
  const system = renderPrompt(prompt, { id: e.id, now: JSON.stringify(now) });
  return {
    question: ask.note ? `${ask.by} asks for changes: ${ask.note}` : "Do your pass on this video.",
    system: system.slice(0, SYSTEM_MAX),
    commands: [`Bash(node scripts/prod-wren.mjs video show ${e.id})`],
  };
}

const FIX = z.object({ wrong: z.string().trim().min(1), right: z.string().trim().min(1) });
const PASS = z.object({
  reply: z.string(),
  notes: z.array(z.string()).nullish(),
  words: z.array(z.unknown()).nullish(),
  patch: z.record(z.string(), z.unknown()).nullish(),
});
export interface Pass {
  reply: string;
  notes: string[];
  words: z.infer<typeof FIX>[];
  patch: Record<string, unknown> | null;
}

/** The agent's answer: the first JSON object in it. Words alone change nothing. */
export function passOf(text: string): Pass {
  const from = text.indexOf("{");
  try {
    const got = PASS.safeParse(JSON.parse(text.slice(from, text.lastIndexOf("}") + 1)));
    if (from >= 0 && got.success) {
      const patch = got.data.patch;
      return {
        reply: got.data.reply.trim(),
        notes: (got.data.notes ?? [])
          .map((n) => n.trim())
          .filter(Boolean)
          .slice(0, 5),
        // A malformed fix is dropped, not the pass.
        words: (got.data.words ?? []).flatMap((w) => {
          const f = FIX.safeParse(w);
          return f.success && f.data.wrong !== f.data.right ? [f.data] : [];
        }),
        patch: patch && Object.keys(patch).length ? patch : null,
      };
    }
  } catch {
    // Not JSON: said in words.
  }
  return { reply: text.trim(), notes: [], words: [], patch: null };
}

/**
 * Write a pass: each word fix (its own `video words` run, by `agent`), then the patch on the pass's
 * run. A fix that matches nothing is skipped and said; a refused patch is said on the run. Returns
 * whether anything changed, so the caller renders again.
 */
export async function applyPass(
  db: Queryable,
  e: VideoEdit,
  pass: Pass,
  o: { run: string; stats: object; by?: string },
): Promise<{ changed: boolean; fixed: string[]; skipped: string[]; error: string | null }> {
  const by = o.by ?? "agent";
  const fixed: string[] = [];
  const skipped: string[] = [];
  for (const f of pass.words) {
    try {
      const { n } = await setWords(db, e.id, f, { by });
      fixed.push(`${f.wrong} → ${f.right} (${n})`);
    } catch (err) {
      skipped.push(`${f.wrong}: ${(err as Error).message}`);
    }
  }
  const stats = { ...o.stats, reply: pass.reply, notes: pass.notes, fixed, skipped };
  if (!pass.patch) {
    await finishRun(db, o.run, stats);
    return { changed: fixed.length > 0, fixed, skipped, error: null };
  }
  try {
    // Read again: the word fixes moved it, and he may have edited while the agent worked.
    await applyAnswer(db, await getEdit(db, e.id), pass.patch, { by, run: o.run, stats });
    return { changed: true, fixed, skipped, error: null };
  } catch (err) {
    const error = `Not written: ${(err as Error).message}`;
    await finishRun(db, o.run, { ...stats, error });
    return { changed: fixed.length > 0, fixed, skipped, error };
  }
}

/** Why a render can't be queued now, or null when it can. */
export function renderRefusal(
  e: Pick<VideoEdit, "state" | "render">,
  now = Date.now(),
): string | null {
  if (!RENDERABLE.includes(e.state)) return `it is ${e.state}; an approved video keeps its render`;
  const r = e.render;
  if (r?.state === "waiting") return "it is waiting for the Mac already";
  if (r?.state === "rendering" && now - Date.parse(r.at) < RENDER_STALE_MS)
    return "it is rendering now";
  return null;
}

/** Every video run on one id, as the page lists them: who, what, when, and how it ended. */
export interface VideoStep {
  id: string;
  command: string;
  by: string | null;
  at: string;
  state: "running" | "failed" | "done";
  what: string;
  error: string | null;
  reply: string | null;
  notes: string[] | null;
  note: string | null;
  /** It wrote fields of the edit, so a render before it is out of date. */
  changed: boolean;
}

const STEP_MAX = 200;

/** What a run did, in a few words. */
export function stepWhat(
  command: string,
  argv: Record<string, unknown>,
  stats: Record<string, unknown> | null,
): string {
  const fields = (stats?.fields ?? argv.fields) as string[] | undefined;
  const list = fields?.length ? fields.join(", ") : "";
  switch (command) {
    case VIDEO_EDIT: {
      const fixed = (stats?.fixed as string[] | undefined)?.length ?? 0;
      const parts = [
        fixed ? `fixed ${fixed} word${fixed === 1 ? "" : "s"}` : "",
        list ? `changed ${list}` : "",
        stats?.rendering ? "queued a render" : "",
      ].filter(Boolean);
      return parts.length ? `Agent pass: ${parts.join("; ")}` : "Agent pass";
    }
    case "video-ask":
      return list ? `Ask: changed ${list}` : "Ask";
    case "video words":
      return argv.wrong
        ? `Fixed "${argv.wrong}" to "${argv.right}"`
        : `Fixed a word at ${argv.at ?? "?"} s`;
    case "video set":
      return list ? `Changed ${list}` : "Saved";
    case "video cut":
      return `Cut the files${argv.segments ? ` (${argv.segments} pieces)` : ""}`;
    case "video render":
      return argv.upload ? "Uploaded the previews" : "Rendered";
    case "video undo":
      return list ? `Undo: put back ${list}` : "Undo";
    case "video reject":
      return "Rejected";
    case "video restore":
      return "Brought back";
    default:
      return command.replace(/^video /, "").replace(/^./, (c) => c.toUpperCase());
  }
}

/** Every `video *` run for the id, oldest first. */
export async function videoSteps(db: Queryable, id: number): Promise<VideoStep[]> {
  const rows = (await db.execute(sql`
    SELECT id::text, command, argv, stats, started_at AS at, finished_at AS done
    FROM runs WHERE (command LIKE 'video %' OR command IN ('video-ask', ${VIDEO_EDIT}))
      AND argv->>'id' = ${String(id)}
    ORDER BY started_at DESC, id DESC LIMIT ${STEP_MAX}`)) as unknown as {
    id: string;
    command: string;
    argv: Record<string, unknown> | null;
    stats: Record<string, unknown> | null;
    at: string | Date;
    done: string | Date | null;
  }[];
  return rows.reverse().map((r) => {
    const argv = r.argv ?? {};
    const error = typeof r.stats?.error === "string" ? r.stats.error : null;
    return {
      id: r.id,
      command: r.command,
      by: typeof argv.by === "string" ? argv.by : null,
      at: new Date(r.at).toISOString(),
      state: !r.done ? "running" : error ? "failed" : "done",
      what: stepWhat(r.command, argv, r.stats),
      error,
      reply: typeof r.stats?.reply === "string" ? r.stats.reply : null,
      notes: Array.isArray(r.stats?.notes) ? (r.stats.notes as string[]) : null,
      note: typeof argv.note === "string" ? argv.note : null,
      changed:
        !!r.done &&
        !error &&
        !NOT_DRAWN.has(r.command) &&
        Array.isArray(r.stats?.fields) &&
        r.stats.fields.length > 0,
    };
  });
}

export type CheckTone = "good" | "warn" | "bad" | "neutral";
export interface VideoCheck {
  tone: CheckTone;
  say: string;
}

/** Runs that write files, not the edit. */
const NOT_DRAWN = new Set(["video render", "video cut", "video add"]);

/** When the last change and the last good render ran (ISO), for `videoChecks`. */
export function renderTimes(steps: readonly VideoStep[]): {
  lastChange: string | null;
  lastRender: string | null;
} {
  let lastChange: string | null = null;
  let lastRender: string | null = null;
  for (const s of steps) {
    if (s.command === "video render" && s.state === "done") lastRender = s.at;
    else if (s.changed) lastChange = s.at;
  }
  return { lastChange, lastRender };
}

/** What he reads before Approve: each a plain sentence, good or to look at. */
export function videoChecks(
  e: Pick<
    VideoEdit,
    "title" | "description" | "chapters" | "cuts" | "words" | "state" | "render" | "files"
  >,
  o: { chaptersShown: number; lastChange: string | null; lastRender: string | null; now?: number },
): VideoCheck[] {
  const out: VideoCheck[] = [];
  const now = o.now ?? Date.now();
  out.push(
    e.title.trim()
      ? { tone: "good", say: "It has a title." }
      : { tone: "bad", say: "No title yet." },
  );
  out.push(
    e.description.trim()
      ? { tone: "good", say: "It has a description." }
      : { tone: "warn", say: "No description yet." },
  );
  if (o.chaptersShown)
    out.push({ tone: "good", say: `YouTube will show ${o.chaptersShown} chapters.` });
  else if (e.chapters.length)
    out.push({
      tone: "warn",
      say: "YouTube won't show these chapters. It needs 3 or more, 10 seconds apart, the first at 0:00.",
    });
  else out.push({ tone: "neutral", say: "No chapters." });
  const rows = reviewCuts(e.cuts, e.words);
  const proposed = rows.filter((r) => r.cut.state === "proposed").length;
  if (proposed)
    out.push({
      tone: "warn",
      say: `${proposed} proposed cut${proposed === 1 ? " waits" : "s wait"} on Keep or Cut.`,
    });
  const flagged = rows.filter((r) => r.cut.state === "cut" && r.flags.length).length;
  if (flagged)
    out.push({
      tone: "warn",
      say:
        flagged === 1
          ? "1 cut is long or touches a word. Look at it under Cuts."
          : `${flagged} cuts are long or touch a word. Look at them under Cuts.`,
    });
  out.push(...renderCheck(e.render, e.files, e.state, o, now));
  return out;
}

function renderCheck(
  render: RenderState | null,
  files: Record<string, string>,
  state: string,
  o: { lastChange: string | null; lastRender: string | null },
  now: number,
): VideoCheck[] {
  if (render?.state === "failed")
    return [{ tone: "bad", say: "The last render failed. Its reason is below." }];
  if (render?.state === "rendering")
    return now - Date.parse(render.at) < RENDER_STALE_MS
      ? [{ tone: "neutral", say: "Rendering on the Mac now." }]
      : [{ tone: "bad", say: "The render stopped reporting. Render it again." }];
  if (render?.state === "waiting")
    return [{ tone: "neutral", say: "The render waits for the Mac." }];
  if (!files.long && !files.vertical) return [{ tone: "warn", say: "Not rendered yet." }];
  if (!RENDERABLE.includes(state)) return [];
  if (o.lastChange && (!o.lastRender || o.lastChange > o.lastRender))
    return [{ tone: "warn", say: "Changed since the last render. Render again to see it." }];
  return [{ tone: "good", say: "The preview is the latest render." }];
}

/** States he can reject from: before the upload. */
const REJECTABLE = ["added", "edited", "rendered"];

/** His no: the video leaves Waiting on you. Its files and edit stay, so Bring back undoes it. */
export async function rejectVideo(
  db: Queryable,
  id: number,
  o: { by: string; note?: string | null },
) {
  return atomic(db, async (tx) => {
    const e = await getEdit(tx, id);
    if (!REJECTABLE.includes(e.state))
      throw new Error(`it is ${e.state}; only a video not yet approved can be rejected`);
    await tx
      .update(videoEdits)
      .set({ state: "rejected", updatedAt: new Date() })
      .where(eq(videoEdits.id, id));
    const note = o.note?.trim().slice(0, VIDEO_NOTE_MAX) || null;
    const { id: run } = await openRun(tx, {
      command: "video reject",
      argv: { id, by: o.by, note },
    });
    await finishRun(tx, run, { was: e.state });
    return { run };
  });
}

/** A rejected video back: waiting on him when it has a render, else in the editor. */
export async function restoreVideo(db: Queryable, id: number, o: { by: string }) {
  return atomic(db, async (tx) => {
    const e = await getEdit(tx, id);
    if (e.state !== "rejected") throw new Error(`it is ${e.state}, not rejected`);
    const state = e.files.long || e.files.vertical ? "rendered" : "edited";
    await tx.update(videoEdits).set({ state, updatedAt: new Date() }).where(eq(videoEdits.id, id));
    const { id: run } = await openRun(tx, { command: "video restore", argv: { id, by: o.by } });
    await finishRun(tx, run, { state });
    return { run, state };
  });
}

/** Say on the pass's run that it queued a render. */
export const markRendering = (db: Queryable, run: string) =>
  db.execute(
    sql`UPDATE runs SET stats = coalesce(stats, '{}'::jsonb) || '{"rendering": true}'::jsonb WHERE id = ${run}::uuid`,
  );
