/**
 * `VideoDesk`: a video edited from its page (designs/2026-10-06-video-editor.md, steps 4-5). `set`
 * writes fields, `cut` cuts or keeps a span, `words` fixes a misheard word, `undo` puts back the
 * newest change: each one studio's `setEdit` (or `setWords`), a `runs` row with what it replaced. `ask` hands his words and the edit to the
 * desk's read-only `claude`; Wren checks the patch it answers and writes it. `render` queues the
 * Mac's `studio.render` (`wren video render <id> --cut` there); while the Mac is off it waits in
 * Restate. Nothing renders here and nothing uploads. `edit` is the editing agent's whole pass
 * (designs/2026-10-13-video-review.md): word fixes, fields, cuts, notes, then a render when it
 * changed something; `reject` and `restore` are his no and its undo.
 */
import * as restate from "@restatedev/restate-sdk";
import { finishRun, openRun } from "@wren/core";
import { byOf, CLAUDE, type ClaudeService } from "@wren/core/ask";
import { PORTAL_FIELDS, serviceHandler } from "@wren/core/restate";
import { runs } from "@wren/core/schema";
import { livePrompt } from "@wren/core/templates/defaults";
import type { Db } from "@wren/db";
import { getEdit, setCut, setEdit, setRender, setWords } from "@wren/studio/edit";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
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
  render: (ctx: restate.Context, req: { id: number }) => Promise<{ ms: number }>;
};

const ID = { id: z.number().int().positive(), viewer: PORTAL_FIELDS.viewer };
type One = { id: number; viewer?: unknown };
type Asked = { id: number; by: string; message: string };
type Passed = { id: number; by: string; note: string | null };
type Self = {
  answer: (ctx: restate.Context, req: { run: string }) => Promise<void>;
  editing: (ctx: restate.Context, req: { run: string }) => Promise<void>;
  rendering: (ctx: restate.Context, req: { id: number }) => Promise<void>;
};

/** A refusal is the person's to fix: it fails the call instead of retrying. */
const refuse = (err: unknown, code = 409) =>
  new restate.TerminalError((err as Error).message, { errorCode: code });
/** A bad patch says which field and why, in words. */
const told = <T>(p: Promise<T>) =>
  p.catch((err) => {
    throw refuse(err instanceof z.ZodError ? new Error(z.prettifyError(err)) : err);
  });

export function makeVideoDesk(db: Db) {
  return restate.service({
    name: VIDEO_DESK.name,
    handlers: {
      /** Fields of the edit, as the page saves them: title, description, tags and the rest. */
      set: serviceHandler(
        {
          input: z.looseObject({
            ...ID,
            patch: z.record(z.string(), z.unknown()).describe("The fields to write"),
          }),
        },
        async (ctx: restate.Context, req: One & { patch: unknown }) =>
          ctx.run("set", () =>
            told(setEdit(db, req.id, req.patch, { by: byOf(req) }).then(({ run }) => ({ run }))),
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
                ({ run }) => ({ run }),
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
                const { run, n } = await setWords(db, req.id, change, { by: byOf(req) });
                return { run, n };
              })(),
            ),
          ),
      ),

      /** Put back what the newest change replaced. */
      undo: serviceHandler({ input: z.looseObject(ID) }, async (ctx: restate.Context, req: One) =>
        ctx.run("undo", () => told(undoVideo(db, req.id, byOf(req)).then(({ run }) => ({ run })))),
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

      /** Queue a render on the Mac: cut, render, previews to S3. Its state shows on the row. */
      render: serviceHandler(
        { input: z.looseObject(ID) },
        async (ctx: restate.Context, req: One) => {
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
          ctx.serviceSendClient<Self>(VIDEO_DESK).rendering({ id: req.id });
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
        async (ctx: restate.Context, req: { id: number }) => {
          try {
            await ctx.serviceClient<StudioService>(STUDIO).render({ id: req.id });
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
            ctx.run("save", () => finishRun(db, req.run, { error: error.slice(0, 500) }));
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
          const render = await ctx.run("save", async () => {
            const e = await getEdit(db, asked.id);
            const meta = { ms: out.ms, model: out.model, prompt: asked.version };
            const done = await applyPass(db, e, pass, { run: req.run, stats: meta });
            if (!done.changed) return false;
            const now = await getEdit(db, asked.id);
            if (renderRefusal(now)) return false;
            await setRender(db, now.id, {
              state: "waiting",
              at: new Date().toISOString(),
              by: "agent",
            });
            await markRendering(db, req.run);
            return true;
          });
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
            ctx.run("save", () => finishRun(db, req.run, { error: error.slice(0, 500) }));
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
