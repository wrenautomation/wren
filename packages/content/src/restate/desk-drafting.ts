/** ContentDesk handlers that add, draft, redraft and write posts. */
import * as restate from "@restatedev/restate-sdk";
import { finishRun, openRun } from "@wren/core";
import { byOf } from "@wren/core/ask";
import type { Media, Platform } from "@wren/core/content";
import { PLATFORMS } from "@wren/core/content";
import { clientOfKey, exclusiveHandler, sharedHandler } from "@wren/core/restate";
import { z } from "zod";
import { checkDraft, type DraftCheck } from "../check.js";
import { DRAFT_STAGE, type DraftResult, redraft } from "../draft.js";
import { addIdea, getIdea } from "../ideas.js";
import { FROM, refFrom, splitPosts, waitingIdeas, writeOwn } from "../own.js";
import { getDraft } from "../review.js";
import { type ContentIdea, IDEA_SOURCES, type IdeaSource } from "../schema.js";
import { IDEA_ANGLES, type IdeaAngle } from "../write.js";
import {
  type ContentDeskContext,
  type DraftReport,
  type DraftRequest,
  NONE,
  stopped,
  WRITE_GO,
  type WriteGo,
  type WriteResult,
  written,
} from "./desk-context.js";

const PLATFORMS_FIELD = z
  .array(z.string())
  .nullish()
  .describe(`Of ${PLATFORMS.join(", ")}; empty = every configured one`);

const ADD = z.looseObject({
  text: z.string().describe("The idea"),
  media: z
    .looseObject({ kind: z.string(), source: z.string(), title: z.string().nullish() })
    .nullish()
    .describe("An image or a video: a URL or an s3:// object"),
  draft: z.boolean().nullish().describe("Off keeps the idea undrafted"),
  platforms: PLATFORMS_FIELD,
  source: z.enum(IDEA_SOURCES).nullish().describe("Who wrote it; cli unless said"),
});

const WRITE = z.looseObject({
  text: z.string().min(1).describe("One post, or several with a line of --- between them"),
  title: z.string().nullish().describe("Reddit's title; else the first line"),
  platforms: z.array(z.enum(PLATFORMS)).min(1).describe("Where each post goes"),
  adapt: z.boolean().nullish().describe("The model writes each platform's version from the words"),
  thread: z
    .boolean()
    .nullish()
    .describe("The text is one X thread, its posts split by a line of ---; X only"),
  go: z
    .enum(WRITE_GO)
    .nullish()
    .describe("draft: wait for a yes (default); slot: post at each next slot; now: next pass"),
  from: z
    .string()
    .regex(FROM)
    .nullish()
    .describe("What it's about, video:<id>: the post hangs under that video in Pieces"),
  line: z.string().max(64).nullish().describe("The offer line it serves: a line id in the shape"),
  angle: z.enum(IDEA_ANGLES).nullish().describe("How it argues"),
  media: z
    .object({
      kind: z.enum(["image", "video"]),
      source: z.string().min(1),
      title: z.string().optional(),
    })
    .nullish()
    .describe("The file a platform that needs one posts (TikTok's video): s3://, or a URL"),
});

const DRAFT = z.looseObject({
  ideaId: z.string(),
  platforms: PLATFORMS_FIELD,
  again: z.boolean().nullish().describe("Draft again where a draft exists"),
});

const REDRAFT = z.looseObject({
  draftId: z.string(),
  note: z.string().describe("What to change"),
});

const CHECK = z.looseObject({ draftId: z.string() });

export function draftingHandlers(desk: ContentDeskContext) {
  const { options, scopeOf, goOn, draft } = desk;
  return {
    /** Add an idea and draft it in one go: the everyday path. */
    add: exclusiveHandler(
      { input: ADD },
      async (
        ctx: restate.ObjectContext,
        req: {
          text: string;
          media?: Media | null;
          draft?: boolean;
          platforms?: Platform[];
          /** Who wrote it: the person (`cli`, default), the API, or `AdsWatch` (`ads`). */
          source?: IdeaSource;
        },
      ): Promise<{ idea: ContentIdea; drafts: DraftReport | null }> => {
        const { db } = await scopeOf(ctx);
        const idea = await ctx.run("insert idea", () =>
          addIdea(db, req.text, req.source ?? "cli", req.media ?? null),
        );
        if (req.draft === false) return { idea, drafts: null };
        const drafts = await draft(ctx, {
          ideaId: idea.id,
          ...(req.platforms ? { platforms: req.platforms } : {}),
        });
        return { idea, drafts };
      },
    ),
    draft: exclusiveHandler(
      { input: DRAFT },
      async (ctx: restate.ObjectContext, req: DraftRequest): Promise<DraftReport> =>
        draft(ctx, req),
    ),
    /** Rewrite one draft from the person's note; the old row is rejected as superseded. */
    redraft: exclusiveHandler(
      { input: REDRAFT },
      async (
        ctx: restate.ObjectContext,
        req: { draftId: string; note: string },
      ): Promise<DraftReport> => {
        const s = await scopeOf(ctx, true);
        const previous = await ctx.run("read draft", () => getDraft(s.db, req.draftId));
        const idea = await ctx.run("read idea", () => getIdea(s.db, previous.ideaId));
        const runId = await ctx.run("open run", async () => {
          const run = await openRun(s.db, {
            command: "content redraft",
            argv: { draft: previous.id, platform: previous.platform },
          });
          return run.id;
        });
        const { again: _, ...o } = options(s, runId, false);
        const result = await ctx.run(`${DRAFT_STAGE} ${previous.platform} redraft`, () =>
          stopped([previous.platform], () =>
            redraft(s.db, s.llm, previous, idea, req.note, o).then((r) => [r]),
          ).then((r) => r[0] as DraftResult),
        );
        await ctx.run("finish run", () =>
          finishRun(s.db, runId, { drafted: result.ok ? 1 : 0, skipped: result.ok ? 0 : 1 }),
        );
        return { ideaId: idea.id, results: [result], runId };
      },
    ),
    /**
     * Check one draft against its platform's SOP and save the result on it. Wren's desk only:
     * the standard and his calls live in Wren's Learn. Shared: it writes the draft's check
     * column only, so drafting on the desk never waits on it.
     */
    check: sharedHandler(
      { input: CHECK },
      async (
        ctx: restate.ObjectSharedContext,
        req: { draftId: string },
      ): Promise<{ check: DraftCheck | null; why: string | null }> => {
        if (clientOfKey(ctx.key))
          throw new restate.TerminalError("The SOP check is Wren's only for now.", {
            errorCode: 400,
          });
        const s = await scopeOf(ctx);
        const check = await ctx.run("check", () =>
          checkDraft(
            s.db,
            s.llm,
            req.draftId,
            desk.deps.tracer ? { tracer: desk.deps.tracer } : {},
          ),
        );
        return { check, why: check ? null : "The models are stopped; ask again later." };
      },
    ),
    /** Write's board: the drafts that wait on a yes, grouped by idea. Read only. */
    waiting: sharedHandler({ input: NONE }, async (ctx: restate.ObjectSharedContext) => {
      const { db } = await scopeOf(ctx);
      return { ideas: await ctx.run("read", () => waitingIdeas(db)) };
    }),
    /**
     * Posts in the person's words (Marketing → Write), one or a batch, on each platform picked:
     * as written, or each platform's version from the model. Then a draft each, or a yes.
     */
    write: exclusiveHandler(
      { input: WRITE },
      async (
        ctx: restate.ObjectContext,
        req: {
          text: string;
          title?: string | null;
          platforms: Platform[];
          adapt?: boolean | null;
          thread?: boolean | null;
          go?: WriteGo | null;
          from?: string | null;
          media?: Media | null;
          line?: string | null;
          angle?: IdeaAngle | null;
          viewer?: unknown;
        },
      ) => {
        const s = await scopeOf(ctx);
        const by = byOf(req);
        const mark = { line: req.line ?? null, angle: req.angle ?? null };
        // A thread is one post whose parts the `---` lines split.
        const posts = req.thread ? [req.text.trim()].filter(Boolean) : splitPosts(req.text);
        if (posts.length === 0)
          throw new restate.TerminalError("Nothing to post.", { errorCode: 400 });
        if (posts.length > 1 && req.title)
          throw new restate.TerminalError("A title fits one post, not a batch.", {
            errorCode: 400,
          });
        const out: { ideaId: string; results: WriteResult[] }[] = [];
        for (const [n, text] of posts.entries()) {
          const made =
            req.adapt && !req.thread
              ? await (async () => {
                  const idea = await ctx.run(`idea ${n}`, () =>
                    addIdea(s.db, text, "cli", null, refFrom(req.from), mark),
                  );
                  const r = await draft(ctx, { ideaId: idea.id, platforms: req.platforms });
                  return { ideaId: idea.id, results: r.results };
                })()
              : await ctx.run(`write ${n}`, async () => {
                  const r = await writeOwn(s.db, {
                    text,
                    title: req.title ?? null,
                    platforms: req.platforms,
                    by,
                    from: req.from ?? null,
                    media: req.media ?? null,
                    mark,
                    ...(req.thread ? { thread: true } : {}),
                  });
                  return { ideaId: r.idea.id, results: r.results };
                });
          out.push({ ideaId: made.ideaId, results: made.results.map(written) });
        }
        await goOn(ctx, s.db, out, req.go ?? "draft", by);
        return { posts: out };
      },
    ),
  };
}
