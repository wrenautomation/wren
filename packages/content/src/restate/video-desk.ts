/**
 * `VideoDesk`: a video edited from its page (designs/2026-10-06-video-editor.md, steps 4-5). `set`
 * writes fields, `cut` cuts or keeps a span, `words` fixes a misheard word, `undo` puts back the
 * newest change: each one studio's `setEdit` (or `setWords`), a `runs` row with what it replaced. `ask` hands his words and the edit to the
 * desk's read-only `claude`; Wren checks the patch it answers and writes it. `render` queues the
 * Mac's `studio.render` (`wren video render <id> --cut` there); while the Mac is off it waits in
 * Restate. Nothing renders here and nothing uploads. `edit` is the editing agent's whole pass
 * (designs/2026-10-13-video-review.md): word fixes, fields, cuts, notes, then a render when it
 * changed something; `reject` and `restore` are his no and its undo. `propose` is a change said in a
 * sentence on the storyboard (designs/2026-10-15-storyboard.md); Apply is `set` with its patch.
 */
import * as restate from "@restatedev/restate-sdk";
import { finishRun, openRun } from "@wren/core";
import { byOf, CLAUDE, type ClaudeService } from "@wren/core/ask";
import { terminalOf } from "@wren/core/portal";
import { PortalRefusal } from "@wren/core/refusal";
import { PORTAL_FIELDS, serviceHandler } from "@wren/core/restate";
import { runs } from "@wren/core/schema";
import { livePrompt } from "@wren/core/templates/defaults";
import { atomic, type Db } from "@wren/db";
import { CHANGE, proposeChange } from "@wren/studio/change";
import {
  getEdit,
  setCut,
  setEdit,
  setLine,
  setRender,
  setStress,
  setWords,
} from "@wren/studio/edit";
import { FPS } from "@wren/studio/finish";
import { RENDER_PARTS } from "@wren/studio/hash";
import { punctuate, unpunctuated } from "@wren/studio/punctuate";
import type { VideoEdit } from "@wren/studio/schema";
import {
  proposeStress,
  type StressModel,
  stressCandidates,
  withFallback,
} from "@wren/studio/stress";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { swapShortMedia, videoView } from "../video.js";
import {
  applyAnswer,
  undoVideo,
  VIDEO_ASK,
  VIDEO_ASK_MAX,
  VIDEO_ASK_REF,
  videoAnswerOf,
  videoPrompt,
} from "../video-ask.js";
import {
  applyPass,
  editPrompt,
  markRendering,
  passOf,
  rejectVideo,
  renderRefusal,
  restoreVideo,
  VIDEO_EDIT,
  VIDEO_EDIT_REF,
  VIDEO_NOTE_MAX,
  videoName,
  videoState,
} from "../video-edit.js";

export const VIDEO_DESK = { name: "VideoDesk" } as const;
/** The Mac's render, as autobrowse's desk serves it; no import from that repo. */
export const STUDIO = { name: "studio" } as const;
export type StudioService = {
  render: (
    ctx: restate.Context,
    req: { id: number; only?: string; again?: boolean },
  ) => Promise<{ ms: number }>;
};

const ID = { id: z.number().int().positive(), viewer: PORTAL_FIELDS.viewer };
type One = { id: number; viewer?: unknown };
type Asked = { id: number; by: string; message: string };
type Passed = { id: number; by: string; note: string | null };
type Self = {
  answer: (ctx: restate.Context, req: { run: string }) => Promise<void>;
  editing: (ctx: restate.Context, req: { run: string }) => Promise<void>;
  rendering: (
    ctx: restate.Context,
    req: { id: number; only?: string; again?: boolean },
  ) => Promise<void>;
};

/** A refusal is the person's to fix: it fails the call instead of retrying (a conflict keeps its code). */
const refuse = (err: unknown, code = 409) =>
  err instanceof PortalRefusal
    ? terminalOf(err)
    : new restate.TerminalError((err as Error).message, { errorCode: code });
/** A bad patch says which field and why, in words. */
const told = <T>(p: Promise<T>) =>
  p.catch((err) => {
    throw refuse(err instanceof z.ZodError ? new Error(z.prettifyError(err)) : err);
  });

/** The model behind Propose stressed words and Add punctuation: the worker's (prod: the gateway). */
export type VideoModel = StressModel & { name: string };

export function makeVideoDesk(db: Db, o: { llm?: VideoModel | null } = {}) {
  /** The model, or why there's none: the CLI's `--llm` here is the worker's own. */
  const model = () => {
    if (!o.llm) throw new Error("No model is set up for this here.");
    return withFallback(o.llm, null);
  };
  /** A change's answer: its run, and the page's view of the edit now, so the page patches in place. */
  const answered = async (run: string, edit: VideoEdit) => ({
    run,
    view: await videoView(db, edit),
  });
  return restate.service({
    name: VIDEO_DESK.name,
    handlers: {
      /**
       * Fields of the edit, as the page saves them: title, description, tags and the rest. With
       * `expect` (the fields as the page opened them), one that moved since refuses (409 conflict).
       */
      set: serviceHandler(
        {
          input: z.looseObject({
            ...ID,
            patch: z.record(z.string(), z.unknown()).describe("The fields to write"),
            expect: z
              .record(z.string(), z.unknown())
              .optional()
              .describe("The fields as they were when the page opened them"),
            proposal: z
              .string()
              .max(64)
              .optional()
              .describe("The `video propose` run this applies, when it does"),
          }),
        },
        async (
          ctx: restate.Context,
          req: One & { patch: unknown; expect?: Record<string, unknown>; proposal?: string },
        ) =>
          ctx.run("set", () =>
            told(
              setEdit(db, req.id, req.patch, {
                by: byOf(req),
                // His hand on the page locks what it moved; an applied proposal was the model's idea.
                lock: !req.proposal,
                ...(req.expect ? { expect: req.expect } : {}),
                ...(req.proposal ? { stats: { proposal: req.proposal } } : {}),
              }).then(({ run, edit }) => answered(run, edit)),
            ),
          ),
      ),

      /**
       * A change said in a sentence, on the storyboard (designs/2026-10-15-storyboard.md): the
       * model's patch, checked as `set` checks it, and the board as it would be after. Nothing is
       * saved but a `video propose` run; Apply sends the patch to `set` with its `expect`.
       */
      propose: serviceHandler(
        {
          input: z.looseObject({
            ...ID,
            sentence: z.string().min(1).max(CHANGE.maxChars).describe("What to change"),
            beat: z.string().max(40).nullish().describe("The frame it was said on, by key"),
          }),
        },
        async (ctx: restate.Context, req: One & { sentence: string; beat?: string | null }) =>
          ctx.run("propose", () =>
            told(
              proposeChange(db, req.id, req.sentence, model(), {
                by: byOf(req),
                beat: req.beat ?? null,
              }),
            ),
          ),
      ),

      /** One caption line's words rewritten (`at`: their indexes; `was`: the line as he saw it). */
      line: serviceHandler(
        {
          input: z.looseObject({
            ...ID,
            at: z.array(z.number().int().nonnegative()).min(1).max(40),
            text: z.string().max(400),
            was: z.string().max(400),
          }),
        },
        async (ctx: restate.Context, req: One & { at: number[]; text: string; was: string }) =>
          ctx.run("line", () =>
            told(
              setLine(db, req.id, { at: req.at, text: req.text, was: req.was }, byOf(req)).then(
                ({ run, edit }) => answered(run, edit),
              ),
            ),
          ),
      ),

      /** Cut or keep a span: a proposal by its ends, or words picked in the transcript. */
      cut: serviceHandler(
        {
          input: z.looseObject({
            ...ID,
            from: z.number().nonnegative(),
            to: z.number().positive(),
            state: z.enum(["cut", "kept"]),
          }),
        },
        async (
          ctx: restate.Context,
          req: One & { from: number; to: number; state: "cut" | "kept" },
        ) =>
          ctx.run("cut", () =>
            told(
              setCut(db, req.id, { from: req.from, to: req.to }, req.state, byOf(req)).then(
                ({ run, edit }) => answered(run, edit),
              ),
            ),
          ),
      ),

      /** Fix a misheard word: every match of `wrong`, or the one word at `at` seconds. */
      words: serviceHandler(
        {
          input: z.looseObject({
            ...ID,
            wrong: z.string().nullish().describe("Fix every match of this"),
            right: z.string().nullish().describe("to this"),
            at: z.number().nonnegative().nullish().describe("Or the one word said at this second"),
            text: z.string().nullish().describe("its new text"),
          }),
        },
        async (
          ctx: restate.Context,
          req: One & {
            wrong?: string | null;
            right?: string | null;
            at?: number | null;
            text?: string | null;
          },
        ) =>
          ctx.run("words", () =>
            told(
              (async () => {
                const change =
                  req.wrong && req.right
                    ? { wrong: req.wrong, right: req.right }
                    : req.at != null && req.text
                      ? { at: req.at, text: req.text }
                      : null;
                if (!change) throw new Error("Say the wrong word and the right one.");
                const { run, n, edit } = await setWords(db, req.id, change, { by: byOf(req) });
                return { ...(await answered(run, edit)), n };
              })(),
            ),
          ),
      ),

      /**
       * The model proposes the stressed words (`wren video stress` with no --add/--drop): the
       * whole list replaced, a `video stress` run holding the one before, so Undo puts it back.
       */
      stress: serviceHandler({ input: z.looseObject(ID) }, async (ctx: restate.Context, req: One) =>
        ctx.run("stress", () =>
          told(
            (async () => {
              const e = await getEdit(db, req.id);
              const llm = model();
              const p = await proposeStress(llm, stressCandidates(e, FPS));
              const r = await setStress(db, e.id, p.stress, {
                by: byOf(req),
                stats: { asked: p.asked, offered: p.offered, model: llm.answered.join(", ") },
              });
              return { ...(await answered(r.run, r.edit)), n: p.stress.length };
            })(),
          ),
        ),
      ),

      /**
       * A transcript with no sentence ends punctuated by the model (`wren video words
       * --punctuate`): text only, never times, one `video words` run.
       */
      punctuate: serviceHandler(
        { input: z.looseObject(ID) },
        async (ctx: restate.Context, req: One) =>
          ctx.run("punctuate", () =>
            told(
              (async () => {
                const e = await getEdit(db, req.id);
                if (!unpunctuated(e.words))
                  throw new Error("The transcript has punctuation already.");
                const p = await punctuate(model(), e.words);
                const r = await setWords(
                  db,
                  e.id,
                  { words: p.words },
                  { by: byOf(req), command: "video words" },
                );
                return { ...(await answered(r.run, r.edit)), n: p.changed };
              })(),
            ),
          ),
      ),

      /**
       * After a render: each approved Short draft not out yet points at the new file (`wren video
       * swap`); slot, words and approval stay. `short` narrows it to one.
       */
      swap: serviceHandler(
        {
          input: z.looseObject({
            ...ID,
            short: z.number().int().positive().nullish().describe("Only this Short, 1 the first"),
          }),
        },
        async (ctx: restate.Context, req: One & { short?: number | null }) =>
          ctx.run("swap", () =>
            told(
              swapShortMedia(db, req.id, {
                by: byOf(req),
                ...(req.short ? { short: req.short } : {}),
              }).then((r) => ({
                run: r.run,
                swapped: r.swapped.length,
                missing: r.missing.length,
              })),
            ),
          ),
      ),

      /** Put back what the newest change replaced. */
      undo: serviceHandler({ input: z.looseObject(ID) }, async (ctx: restate.Context, req: One) =>
        ctx.run("undo", () =>
          told(undoVideo(db, req.id, byOf(req)).then(({ run, edit }) => answered(run, edit))),
        ),
      ),

      /** Open the ask's row and hand it to `answer`; the page polls its turns. */
      ask: serviceHandler(
        { input: z.looseObject({ ...ID, message: z.string().describe("What to change, or ask") }) },
        async (ctx: restate.Context, req: One & { message: string }) => {
          const message = typeof req.message === "string" ? req.message.trim() : "";
          if (!message) throw new restate.TerminalError("say what to change", { errorCode: 400 });
          if (message.length > VIDEO_ASK_MAX)
            throw new restate.TerminalError(`keep it under ${VIDEO_ASK_MAX} characters`, {
              errorCode: 400,
            });
          const run = await ctx.run("open run", async () => {
            await told(getEdit(db, req.id));
            const argv: Asked = { id: req.id, by: byOf(req), message };
            return (await openRun(db, { command: VIDEO_ASK, argv, model: "claude-code:sonnet" }))
              .id;
          });
          ctx.serviceSendClient<Self>(VIDEO_DESK).answer({ run });
          return { run };
        },
      ),

      /**
       * Queue a render on the Mac: cut, render what changed, previews to S3. Its state shows on
       * the row. `only` narrows it to one format, the Shorts or the thumbnails; `again` renders
       * every output again, whatever its hash says.
       */
      render: serviceHandler(
        {
          input: z.looseObject({
            ...ID,
            only: z.enum(RENDER_PARTS).optional(),
            again: z.boolean().optional().describe("Render every output again, changed or not"),
          }),
        },
        async (ctx: restate.Context, req: One & { only?: string; again?: boolean }) => {
          await ctx.run("queue", () =>
            told(
              (async () => {
                const e = await getEdit(db, req.id);
                const no = renderRefusal(e);
                if (no) throw new Error(`${videoName(e)} ${no.replace(/^it /, "")}.`);
                await setRender(db, e.id, {
                  state: "waiting",
                  at: new Date().toISOString(),
                  by: byOf(req),
                });
              })(),
            ),
          );
          ctx.serviceSendClient<Self>(VIDEO_DESK).rendering({
            id: req.id,
            ...(req.only ? { only: req.only } : {}),
            ...(req.again ? { again: true } : {}),
          });
          return { queued: true };
        },
      ),

      /**
       * The editing agent's pass: on a new recording (the Mac's `wren video watch`), on his click,
       * or with his note when he asks for changes. Its row is the page's; `editing` does the work.
       */
      edit: serviceHandler(
        {
          input: z.looseObject({
            ...ID,
            note: z.string().nullish().describe("What to change; blank: the agent's own pass"),
          }),
        },
        async (ctx: restate.Context, req: One & { note?: string | null }) => {
          const note = typeof req.note === "string" ? req.note.trim() : "";
          if (note.length > VIDEO_NOTE_MAX)
            throw new restate.TerminalError(`keep it under ${VIDEO_NOTE_MAX} characters`, {
              errorCode: 400,
            });
          const run = await ctx.run("open run", async () => {
            const e = await told(getEdit(db, req.id));
            if (e.state === "rejected" || e.state === "approved" || e.state === "uploaded")
              throw refuse(
                new Error(
                  `${videoName(e)} is ${videoState(e.state)}, so the editing agent can't change it. It edits a video before Approve.`,
                ),
              );
            const argv: Passed = { id: req.id, by: byOf(req), note: note || null };
            return (await openRun(db, { command: VIDEO_EDIT, argv, model: "claude-code:sonnet" }))
              .id;
          });
          ctx.serviceSendClient<Self>(VIDEO_DESK).editing({ run });
          return { run };
        },
      ),

      /** His no: out of Waiting on you, files kept. */
      reject: serviceHandler(
        {
          input: z.looseObject({
            ...ID,
            note: z.string().nullish().describe("Why, for the record"),
          }),
        },
        async (ctx: restate.Context, req: One & { note?: string | null }) =>
          ctx.run("reject", () =>
            told(rejectVideo(db, req.id, { by: byOf(req), note: req.note ?? null })),
          ),
      ),

      /** A rejected video back where it was. */
      restore: serviceHandler(
        { input: z.looseObject(ID) },
        async (ctx: restate.Context, req: One) =>
          ctx.run("restore", () => told(restoreVideo(db, req.id, { by: byOf(req) }))),
      ),

      // Only `render` sends it: waits on the Mac, and says why when the render fails.
      rendering: restate.handlers.handler(
        { ingressPrivate: true },
        async (ctx: restate.Context, req: { id: number; only?: string; again?: boolean }) => {
          try {
            await ctx.serviceClient<StudioService>(STUDIO).render({
              id: req.id,
              ...(req.only ? { only: req.only } : {}),
              ...(req.again ? { again: true } : {}),
            });
          } catch (err) {
            if (!(err instanceof restate.TerminalError)) throw err;
            const why = err.message.slice(-500);
            await ctx.run("failed", async () => {
              // The CLI's own reason, when it got that far, says it best.
              const e = await getEdit(db, req.id);
              if (e.render?.state !== "failed")
                await setRender(db, req.id, { state: "failed", at: new Date().toISOString(), why });
            });
          }
        },
      ),

      // Only `edit` sends it: ask, write what came back, render when it changed something.
      editing: restate.handlers.handler(
        { ingressPrivate: true },
        async (ctx: restate.Context, req: { run: string }) => {
          const asked = await ctx.run("read", async () => {
            const [row] = await db
              .select({ argv: runs.argv, finishedAt: runs.finishedAt })
              .from(runs)
              .where(and(eq(runs.id, req.run), eq(runs.command, VIDEO_EDIT)));
            if (!row || row.finishedAt) return null;
            const a = row.argv as Passed;
            const e = await getEdit(db, a.id).catch(() => null);
            const live = await livePrompt(db, VIDEO_EDIT_REF);
            return { ...a, prompt: e ? editPrompt(e, a, live) : null, version: live.version };
          });
          if (!asked) return;
          const fail = (error: string) =>
            ctx.run("save", () => finishRun(db, req.run, { error: error.slice(0, 5000) }));
          if (!asked.prompt) return void (await fail("the video is gone"));
          let out: Awaited<ReturnType<ClaudeService["ask"]>>;
          try {
            out = await ctx.serviceClient<ClaudeService>(CLAUDE).ask({
              ...asked.prompt,
              dir: "wren",
              also: [],
            });
          } catch (err) {
            if (!(err instanceof restate.TerminalError)) throw err;
            return void (await fail(err.message));
          }
          const pass = passOf(out.answer);
          // One transaction: the run never reads done before it says it queued the render.
          const render = await ctx.run("save", () =>
            atomic(db, async (tx) => {
              const e = await getEdit(tx, asked.id);
              const meta = { ms: out.ms, model: out.model, prompt: asked.version };
              const done = await applyPass(tx, e, pass, { run: req.run, stats: meta });
              if (!done.changed) return false;
              const now = await getEdit(tx, asked.id);
              if (renderRefusal(now)) return false;
              await setRender(tx, now.id, {
                state: "waiting",
                at: new Date().toISOString(),
                by: "agent",
              });
              await markRendering(tx, req.run);
              return true;
            }),
          );
          if (render) ctx.serviceSendClient<Self>(VIDEO_DESK).rendering({ id: asked.id });
        },
      ),

      // Only `ask` sends it.
      answer: restate.handlers.handler(
        { ingressPrivate: true },
        async (ctx: restate.Context, req: { run: string }) => {
          const asked = await ctx.run("read", async () => {
            const [row] = await db
              .select({ argv: runs.argv, finishedAt: runs.finishedAt })
              .from(runs)
              .where(and(eq(runs.id, req.run), eq(runs.command, VIDEO_ASK)));
            if (!row || row.finishedAt) return null;
            const a = row.argv as Asked;
            const e = await getEdit(db, a.id).catch(() => null);
            const live = await livePrompt(db, VIDEO_ASK_REF);
            return { ...a, prompt: e ? videoPrompt(e, a, live) : null, version: live.version };
          });
          if (!asked) return;
          const fail = (error: string) =>
            ctx.run("save", () => finishRun(db, req.run, { error: error.slice(0, 5000) }));
          if (!asked.prompt) return void (await fail("the video is gone"));
          let out: Awaited<ReturnType<ClaudeService["ask"]>>;
          try {
            out = await ctx.serviceClient<ClaudeService>(CLAUDE).ask({
              ...asked.prompt,
              dir: "wren",
              also: [],
            });
          } catch (err) {
            if (!(err instanceof restate.TerminalError)) throw err;
            return void (await fail(err.message));
          }
          const { reply, patch } = videoAnswerOf(out.answer);
          const meta = { reply, ms: out.ms, model: out.model, prompt: asked.version };
          await ctx.run("save", async () => {
            if (!patch) return finishRun(db, req.run, meta);
            // Read again: he may have edited while Claude worked.
            const e = await getEdit(db, asked.id);
            await applyAnswer(db, e, patch, { by: asked.by, run: req.run, stats: meta }).catch(
              (err: Error) =>
                finishRun(db, req.run, { ...meta, error: `Not written: ${err.message}` }),
            );
          });
        },
      ),
    },
  });
}
