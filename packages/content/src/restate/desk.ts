/**
 * `ContentDesk/default`: the loop's writes that must not run twice. Drafting
 * is paid, so each platform's draft is one journaled step; a retry after a
 * crash resumes at the next platform instead of paying again. Ideas and
 * review verdicts are plain rows: the CLI writes them straight to Postgres,
 * the console through `approve`, `edit` and `reject` here.
 */
import * as restate from "@restatedev/restate-sdk";
import { finishRun, openRun } from "@wren/core";
import type { Media, Platform } from "@wren/core/content";
import { PLATFORMS } from "@wren/core/content";
import { exclusiveHandler } from "@wren/core/restate";
import type { Db } from "@wren/db";
import type { LlmClient, Tracer } from "@wren/llm";
import { z } from "zod";
import { DRAFT_STAGE, type DraftOptions, type DraftResult, draftIdea, redraft } from "../draft.js";
import { addIdea, getIdea } from "../ideas.js";
import { approveDrafts, editDraft, getDraft, rejectDrafts } from "../review.js";
import { type ContentIdea, IDEA_SOURCES, type IdeaSource } from "../schema.js";
import type { Brand } from "../voice.js";

export const DESK_KEY = "default";

export interface ContentDeskDeps {
  db: Db;
  llm: LlmClient;
  /** Platforms drafted when a request names none: the configured channels. */
  platforms: readonly Platform[];
  /** Approved drafts take their platform's next slot on this clock (`WREN_SEND_TIMEZONE`). */
  zone: string;
  voice?: string;
  brand?: Brand;
  tracer?: Tracer | null;
}

export interface DraftRequest {
  ideaId: string;
  /** Default: every configured platform. */
  platforms?: Platform[];
  again?: boolean;
}

export type DraftReport = { ideaId: string; results: DraftResult[]; runId: string };

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
const DRAFT = z.looseObject({
  ideaId: z.string(),
  platforms: PLATFORMS_FIELD,
  again: z.boolean().nullish().describe("Draft again where a draft exists"),
});
const REDRAFT = z.looseObject({
  draftId: z.string(),
  note: z.string().describe("What to change"),
});

const IDS = z.looseObject({ ids: z.array(z.string()).describe("Draft ids") });
const EDIT = z.looseObject({
  draftId: z.string(),
  text: z.string().describe("The whole post"),
  title: z.string().nullish().describe("Left out: unchanged"),
});

/**
 * A verdict the review refuses (not waiting, over the cap) is the person's to fix, so it fails
 * the call instead of retrying. ponytail: a database blip fails it too; the person clicks again.
 */
const verdict = async (f: () => Promise<{ id: string }[]>): Promise<{ done: string[] }> => {
  try {
    return { done: (await f()).map((d) => d.id) };
  } catch (err) {
    throw new restate.TerminalError((err as Error).message, { errorCode: 409 });
  }
};

export function makeContentDesk(deps: ContentDeskDeps) {
  const options = (runId: string, again: boolean): DraftOptions => ({
    runId,
    again,
    ...(deps.voice !== undefined ? { voice: deps.voice } : {}),
    ...(deps.brand ? { brand: deps.brand } : {}),
    ...(deps.tracer ? { tracer: deps.tracer } : {}),
  });
  return restate.object({
    name: "ContentDesk",
    handlers: {
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
          const idea = await ctx.run("insert idea", () =>
            addIdea(deps.db, req.text, req.source ?? "cli", req.media ?? null),
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
          const previous = await ctx.run("read draft", () => getDraft(deps.db, req.draftId));
          const idea = await ctx.run("read idea", () => getIdea(deps.db, previous.ideaId));
          const runId = await ctx.run("open run", async () => {
            const run = await openRun(deps.db, {
              command: "content redraft",
              argv: { draft: previous.id, platform: previous.platform },
            });
            return run.id;
          });
          const { again: _, ...o } = options(runId, false);
          const result = await ctx.run(`${DRAFT_STAGE} ${previous.platform} redraft`, () =>
            redraft(deps.db, deps.llm, previous, idea, req.note, o),
          );
          await ctx.run("finish run", () =>
            finishRun(deps.db, runId, { drafted: result.ok ? 1 : 0, skipped: result.ok ? 0 : 1 }),
          );
          return { ideaId: idea.id, results: [result], runId };
        },
      ),
      /** A person's yes from the console: each draft posts at its platform's next slot. */
      approve: exclusiveHandler(
        { input: IDS },
        (ctx: restate.ObjectContext, req: { ids: string[] }) =>
          ctx.run("approve", () =>
            verdict(() => approveDrafts(deps.db, req.ids, { now: new Date(), zone: deps.zone })),
          ),
      ),
      reject: exclusiveHandler(
        { input: IDS },
        (ctx: restate.ObjectContext, req: { ids: string[] }) =>
          ctx.run("reject", () => verdict(() => rejectDrafts(deps.db, req.ids))),
      ),
      /** The person's own words; the draft waits for a fresh yes. */
      edit: exclusiveHandler(
        { input: EDIT },
        (
          ctx: restate.ObjectContext,
          req: { draftId: string; text: string; title?: string | null },
        ) =>
          ctx.run("edit", () =>
            verdict(async () => [
              await editDraft(deps.db, req.draftId, {
                text: req.text,
                ...(req.title !== undefined ? { title: req.title } : {}),
              }),
            ]),
          ),
      ),
    },
  });

  async function draft(ctx: restate.ObjectContext, req: DraftRequest): Promise<DraftReport> {
    const platforms = req.platforms ?? deps.platforms;
    for (const p of platforms)
      if (!PLATFORMS.includes(p))
        throw new restate.TerminalError(`unknown platform ${p}`, { errorCode: 400 });
    const idea = await ctx.run("read idea", () => getIdea(deps.db, req.ideaId));
    const runId = await ctx.run("open run", async () => {
      const run = await openRun(deps.db, {
        command: `content draft`,
        argv: { idea: idea.id, platforms, again: req.again ?? false },
      });
      return run.id;
    });
    const results: DraftResult[] = [];
    for (const platform of platforms) {
      const [r] = await ctx.run(`${DRAFT_STAGE} ${platform}`, () =>
        draftIdea(deps.db, deps.llm, idea, [platform], options(runId, req.again ?? false)),
      );
      if (r) results.push(r);
    }
    const stats = {
      drafted: results.filter((r) => r.ok).length,
      skipped: results.filter((r) => !r.ok).length,
    };
    await ctx.run("finish run", () => finishRun(deps.db, runId, stats));
    return { ideaId: idea.id, results, runId };
  }
}

export type ContentDesk = ReturnType<typeof makeContentDesk>;
