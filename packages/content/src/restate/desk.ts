/**
 * `ContentDesk/default`: the loop's writes that must not run twice. Drafting
 * is paid, so each platform's draft is one journaled step; a retry after a
 * crash resumes at the next platform instead of paying again. Ideas and
 * review verdicts are plain rows: the CLI writes them straight to Postgres,
 * the console through `approve`, `edit` and `reject` here.
 *
 * `ContentDesk/<client>/desk`: the same over a client's own database. Its drafts speak as the
 * client (its plan's About and voice), on its own `models` vendor; they wait in its To approve.
 */
import * as restate from "@restatedev/restate-sdk";
import { finishRun, openRun } from "@wren/core";
import { byOf } from "@wren/core/ask";
import type { Media, Platform } from "@wren/core/content";
import { PLATFORMS } from "@wren/core/content";
import { SHAPES } from "@wren/core/content/shapes";
import { REJECT_REASONS, rejectWhy } from "@wren/core/draft-record";
import { isVendorStop, meteredModel } from "@wren/core/metered";
import { clientOfKey, exclusiveHandler, PORTAL_FIELDS } from "@wren/core/restate";
import { gate } from "@wren/core/vendors";
import type { Db } from "@wren/db";
import type { LlmClient, Tracer } from "@wren/llm";
import { z } from "zod";
import { clientContent, clientPlan } from "../clients.js";
import { DRAFT_STAGE, type DraftOptions, type DraftResult, draftIdea, redraft } from "../draft.js";
import { addIdea, getIdea } from "../ideas.js";
import { ATTACH_MAX_BYTES, attachFile } from "../attach.js";
import type { MediaStoreOptions } from "../media.js";
import { approveDrafts, editDraft, getDraft, rejectDrafts, setFields } from "../review.js";
import { type ContentIdea, IDEA_SOURCES, type IdeaSource } from "../schema.js";
import { slotsOf } from "../slots.js";
import { approveVideo, pickThumbnail, VIDEO_PRIVACY, type VideoPrivacy } from "../video.js";
import type { Brand } from "../voice.js";
import { type ContentPlanner, PLANNER_KEY, type PlannerSettings } from "./planner.js";

export const DESK_KEY = "default";
/** A client's desk is `ContentDesk/<client>/desk`. */
export const DESK_UNIT = "desk";

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
  /** The media store a field's file goes to (thumbnail, cover); none: `attach` refuses. */
  media?: MediaStoreOptions;
  /** A client's desk: its database and the model its drafts run on. None: a client's key fails. */
  clients?: { clientDb: (client: string) => Db; llm: LlmClient | null };
}

/** One desk call's database, model and words: Wren's, or a client's. */
interface Scope {
  db: Db;
  llm: LlmClient;
  voice?: string;
  brand?: Brand;
  /** A client's: the platforms its logins post on, drafted when a request names none. */
  platforms?: Platform[];
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

const VIDEO = z.looseObject({
  id: z.number().int().positive().describe("The video (wren video list)"),
  short: z
    .number()
    .int()
    .positive()
    .nullish()
    .describe("A Short, 1 for the first; none: the long video"),
  privacy: z.enum(VIDEO_PRIVACY).nullish().describe("Who sees the upload; none: private"),
});
const THUMBNAIL = z.looseObject({
  id: z.number().int().positive(),
  n: z.number().int().positive().describe("Which rendered thumbnail, 1 for the first"),
});

const IDS = z.looseObject({
  ids: z.array(z.string()).describe("Draft ids"),
  viewer: PORTAL_FIELDS.viewer,
});
const REJECT = z.looseObject({
  ids: z.array(z.string()).describe("Draft ids"),
  reason: z.enum(REJECT_REASONS).nullish().describe("Why, as a quick pick"),
  note: z.string().nullish().describe("Why, in a few words"),
  viewer: PORTAL_FIELDS.viewer,
});
const FIELDS = z.looseObject({
  viewer: PORTAL_FIELDS.viewer,
  draftId: z.string(),
  patch: z
    .record(z.string(), z.unknown())
    .describe("Fields of the draft's platform shape; null unsets one"),
});
const ATTACH = z.looseObject({
  viewer: PORTAL_FIELDS.viewer,
  draftId: z.string(),
  field: z.string().describe("The file's field: thumbnail, captions, cover"),
  name: z.string().describe("The file's name; its extension names the type"),
  data: z
    .string()
    .max(Math.ceil((ATTACH_MAX_BYTES * 4) / 3) + 4)
    .describe("The bytes, base64"),
});
const EDIT = z.looseObject({
  viewer: PORTAL_FIELDS.viewer,
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
  const options = (s: Scope, runId: string, again: boolean): DraftOptions => ({
    runId,
    again,
    ...(s.voice !== undefined ? { voice: s.voice } : {}),
    ...(s.brand ? { brand: s.brand } : {}),
    ...(deps.tracer ? { tracer: deps.tracer } : {}),
  });
  const wren: Scope = {
    db: deps.db,
    llm: deps.llm,
    ...(deps.voice !== undefined ? { voice: deps.voice } : {}),
    ...(deps.brand ? { brand: deps.brand } : {}),
  };
  /**
   * Who this call is for. A client's drafts need its About and its `models` gate open (asked once
   * a call); a verdict needs only its database.
   */
  const scopeOf = async (ctx: restate.ObjectContext, drafts = false): Promise<Scope> => {
    const owner = clientOfKey(ctx.key);
    if (!owner) return wren;
    const clients = deps.clients;
    if (!clients) throw new restate.TerminalError("no client databases here", { errorCode: 404 });
    const id = owner.client;
    const db = clients.clientDb(id);
    if (!drafts) return { db, llm: deps.llm };
    const plan = await ctx.run("client", async () => {
      const c = await clientContent(deps.db, id, "content.planner");
      if (c.kind === "gone") return { ok: false as const, why: c.why };
      const p = clientPlan(c.client);
      if (!p.ok) return p;
      const g = await gate(deps.db, id, "models", 1, new Date());
      return g.ok
        ? { ...p, platforms: c.platforms as Platform[] }
        : { ok: false as const, why: `models: ${g.why}` };
    });
    if (!plan.ok || !clients.llm)
      throw new restate.TerminalError(plan.ok ? "no model here" : plan.why, { errorCode: 409 });
    return {
      db,
      llm: meteredModel(clients.llm, {
        main: deps.db,
        client: id,
        part: "content.planner",
        now: () => new Date(),
      }),
      voice: plan.voice,
      brand: plan.brand,
      platforms: plan.platforms,
    };
  };
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
      /** A person's yes from the console: each draft posts at its platform's next slot. */
      approve: exclusiveHandler(
        { input: IDS },
        async (ctx: restate.ObjectContext, req: { ids: string[]; viewer?: unknown }) => {
          const { db } = await scopeOf(ctx);
          // Wren's posts land on the planner's slots; a client's on the defaults.
          const planned = clientOfKey(ctx.key)
            ? null
            : (
                await ctx
                  .objectClient<ContentPlanner>({ name: "ContentPlanner" }, PLANNER_KEY)
                  .status()
              ).settings;
          const slots = slotsOf((planned as PlannerSettings | null)?.slots);
          return ctx.run("approve", () =>
            verdict(() =>
              approveDrafts(db, req.ids, {
                now: new Date(),
                zone: deps.zone,
                slots,
                by: byOf(req),
              }),
            ),
          );
        },
      ),
      /** His yes on a rendered video or one Short: a YouTube draft (private unless asked), posted on the next pass. */
      approveVideo: exclusiveHandler(
        { input: VIDEO },
        async (
          ctx: restate.ObjectContext,
          req: { id: number; short?: number | null; privacy?: VideoPrivacy | null },
        ) => {
          const { db } = await scopeOf(ctx);
          return ctx.run("approve video", () =>
            verdict(async () => [
              await approveVideo(db, req.id, {
                source: "api",
                ...(req.short ? { short: req.short } : {}),
                ...(req.privacy ? { privacy: req.privacy } : {}),
              }),
            ]),
          );
        },
      ),
      pickThumbnail: exclusiveHandler(
        { input: THUMBNAIL },
        async (ctx: restate.ObjectContext, req: { id: number; n: number }) => {
          const { db } = await scopeOf(ctx);
          return ctx.run("pick thumbnail", () =>
            verdict(async () => {
              await pickThumbnail(db, req.id, req.n);
              return [{ id: String(req.id) }];
            }),
          );
        },
      ),
      /** No, with an optional quick pick and note: the draft record keeps why. */
      reject: exclusiveHandler(
        { input: REJECT },
        async (
          ctx: restate.ObjectContext,
          req: { ids: string[]; reason?: string | null; note?: string | null; viewer?: unknown },
        ) => {
          const { db } = await scopeOf(ctx);
          return ctx.run("reject", () =>
            verdict(() => rejectDrafts(db, req.ids, { by: byOf(req), ...rejectWhy(req) })),
          );
        },
      ),
      /**
       * The draft's fields, checked against its platform's shape; the draft record keeps each
       * change. A file field only unsets here: `attach` sets it.
       */
      fields: exclusiveHandler(
        { input: FIELDS },
        async (
          ctx: restate.ObjectContext,
          req: { draftId: string; patch: Record<string, unknown>; viewer?: unknown },
        ) => {
          const { db } = await scopeOf(ctx);
          return ctx.run("fields", () =>
            verdict(async () => {
              const d = await getDraft(db, req.draftId);
              for (const [k, v] of Object.entries(req.patch)) {
                const f = SHAPES[d.platform].fields.find((x) => x.key === k);
                if ((f?.input === "image" || f?.input === "captions") && v !== null && v !== "")
                  throw new Error(`${f.label}: upload a file`);
              }
              return [await setFields(db, req.draftId, req.patch, { by: byOf(req) })];
            }),
          );
        },
      ),
      /** A file on a field (thumbnail, subtitles, cover): to the media store, then the field. */
      attach: exclusiveHandler(
        { input: ATTACH },
        async (
          ctx: restate.ObjectContext,
          req: { draftId: string; field: string; name: string; data: string; viewer?: unknown },
        ) => {
          const media = deps.media;
          if (!media) throw new restate.TerminalError("no media store here", { errorCode: 503 });
          const { db } = await scopeOf(ctx);
          return ctx.run("attach", () =>
            verdict(async () => [await attachFile(db, media, req, { by: byOf(req) })]),
          );
        },
      ),
      /** The person's own words; the draft waits for a fresh yes. */
      edit: exclusiveHandler(
        { input: EDIT },
        async (
          ctx: restate.ObjectContext,
          req: { draftId: string; text: string; title?: string | null; viewer?: unknown },
        ) => {
          const { db } = await scopeOf(ctx);
          return ctx.run("edit", () =>
            verdict(async () => [
              await editDraft(
                db,
                req.draftId,
                { text: req.text, ...(req.title !== undefined ? { title: req.title } : {}) },
                { by: byOf(req) },
              ),
            ]),
          );
        },
      ),
    },
  });

  async function draft(ctx: restate.ObjectContext, req: DraftRequest): Promise<DraftReport> {
    for (const p of req.platforms ?? [])
      if (!PLATFORMS.includes(p))
        throw new restate.TerminalError(`unknown platform ${p}`, { errorCode: 400 });
    const s = await scopeOf(ctx, true);
    // A client's drafts only where its own logins post.
    const own = s.platforms;
    const platforms = own
      ? (req.platforms ?? own).filter((p) => own.includes(p))
      : (req.platforms ?? deps.platforms);
    const idea = await ctx.run("read idea", () => getIdea(s.db, req.ideaId));
    const runId = await ctx.run("open run", async () => {
      const run = await openRun(s.db, {
        command: `content draft`,
        argv: { idea: idea.id, platforms, again: req.again ?? false },
      });
      return run.id;
    });
    const results: DraftResult[] = [];
    for (const platform of platforms) {
      const [r] = await ctx.run(`${DRAFT_STAGE} ${platform}`, () =>
        stopped([platform], () =>
          draftIdea(s.db, s.llm, idea, [platform], options(s, runId, req.again ?? false)),
        ),
      );
      if (r) results.push(r);
    }
    const stats = {
      drafted: results.filter((r) => r.ok).length,
      skipped: results.filter((r) => !r.ok).length,
    };
    await ctx.run("finish run", () => finishRun(s.db, runId, stats));
    return { ideaId: idea.id, results, runId };
  }
}

/** A client's vendor gate said no mid-call: those platforms weren't drafted, and say why. */
async function stopped(
  platforms: readonly Platform[],
  work: () => Promise<DraftResult[]>,
): Promise<DraftResult[]> {
  try {
    return await work();
  } catch (err) {
    if (!isVendorStop(err)) throw err;
    return platforms.map((platform) => ({ platform, ok: false, reason: `models: ${err.why}` }));
  }
}

export type ContentDesk = ReturnType<typeof makeContentDesk>;
