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
import { ATTACH_MAX_BYTES, attachFile } from "../attach.js";
import {
  keepSlideFiles,
  paintSlides,
  type SlidePainter,
  saveSlides,
  slidesToDraw,
} from "../carousel.js";
import { clientContent, clientPlan } from "../clients.js";
import { DRAFT_STAGE, type DraftOptions, type DraftResult, draftIdea, redraft } from "../draft.js";
import { type FunnelPatch, setFunnel } from "../funnel.js";
import { addIdea, getIdea } from "../ideas.js";
import type { MediaStoreOptions } from "../media.js";
import {
  draftCarousel,
  draftPromo,
  draftThread,
  PROMO_PIECES,
  PROMO_PLATFORMS,
  type PromoPiece,
  type PromoPlatform,
  promoBase,
  videoDraftOf,
} from "../promo.js";
import { approveDrafts, editDraft, getDraft, rejectDrafts, setFields } from "../review.js";
import {
  type ContentIdea,
  FUNNEL_STAGES,
  FUNNEL_TARGETS,
  type FunnelStage,
  type FunnelTarget,
  IDEA_SOURCES,
  type IdeaSource,
} from "../schema.js";
import { slotsOf } from "../slots.js";
import { approveVideo, pickThumbnail, VIDEO_PRIVACY, type VideoPrivacy } from "../video.js";
import { type Brand, DEFAULT_BRAND } from "../voice.js";
import { type ContentPlanner, PLANNER_KEY, type PlannerSettings } from "./planner.js";

/**
 * May this client's desk draft now, and on which platforms? Its plan installed with an About, a
 * login that posts, and its `models` gate open. Read only: the portal asks it before starting one.
 */
export async function clientDrafting(main: Db, id: string) {
  const c = await clientContent(main, id, "content.planner");
  if (c.kind === "gone") return { ok: false as const, why: c.why };
  const p = clientPlan(c.client);
  if (!p.ok) return p;
  const g = await gate(main, id, "models", 1, new Date());
  return g.ok
    ? { ...p, platforms: c.platforms as Platform[] }
    : { ok: false as const, why: `models: ${g.why}` };
}

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
  /** Draws a carousel's slides (a chromium); none: slides save but don't draw here. */
  slides?: SlidePainter;
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
  vertical: z.boolean().nullish().describe("The whole cut, 9:16, instead of the long video"),
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
const FUNNEL = z.looseObject({
  viewer: PORTAL_FIELDS.viewer,
  draftId: z.string(),
  stage: z.enum(FUNNEL_STAGES).nullish().describe("Reach, trust or convert; left out: unchanged"),
  to: z.enum(FUNNEL_TARGETS).nullish().describe("Where it sends people; left out: unchanged"),
  video: z
    .string()
    .nullish()
    .describe("The YouTube draft it points at; empty clears it, left out: unchanged"),
  linked: z
    .union([z.boolean(), z.enum(["on", "off", "auto"])])
    .nullish()
    .describe("Carries its link: on, off, or auto (the platform's rule)"),
});
const PROMOTE = z.looseObject({
  viewer: PORTAL_FIELDS.viewer,
  video: z.number().int().positive().nullish().describe("The video (wren video list)"),
  draftId: z.string().nullish().describe("Or its YouTube draft"),
  platforms: z
    .array(z.enum(PROMO_PLATFORMS))
    .nullish()
    .describe(`Of ${PROMO_PLATFORMS.join(", ")}; empty = all`),
  again: z.boolean().nullish().describe("Draft again where a promo draft exists"),
  pieces: z
    .array(z.enum(PROMO_PIECES))
    .nullish()
    .describe(
      "posts (one per platform), thread (X), carousel (LinkedIn PDF and Instagram); empty = posts",
    ),
});
const SLIDES = z.looseObject({
  viewer: PORTAL_FIELDS.viewer,
  draftId: z.string(),
  slides: z
    .array(z.looseObject({ title: z.string(), lines: z.array(z.string()) }))
    .nullish()
    .describe("The whole set, 5 to 10; saved on every draft that shares it"),
  draw: z.boolean().nullish().describe("Draw the images and the PDF after"),
});
const EDIT = z.looseObject({
  viewer: PORTAL_FIELDS.viewer,
  draftId: z.string(),
  text: z.string().describe("The whole post"),
  title: z.string().nullish().describe("Left out: unchanged"),
});

export interface FunnelRequest {
  draftId: string;
  stage?: FunnelStage | null;
  to?: FunnelTarget | null;
  video?: string | null;
  linked?: boolean | "on" | "off" | "auto" | null;
  viewer?: unknown;
}

/** A form's values as a patch: left out or null is unchanged; an empty video clears it. */
export function funnelPatch(req: FunnelRequest): FunnelPatch {
  const linked =
    req.linked === "on" || req.linked === true
      ? true
      : req.linked === "off" || req.linked === false
        ? false
        : req.linked === "auto"
          ? null
          : undefined;
  return {
    ...(req.stage ? { stage: req.stage } : {}),
    ...(req.to ? { to: req.to } : {}),
    ...(req.video !== undefined && req.video !== null ? { video: req.video || null } : {}),
    ...(linked !== undefined ? { linked } : {}),
  };
}

/** Why a client's promo skips a platform: none of its logins posts there yet. */
export const NOT_CONNECTED = "no login of this client's posts here yet";

/** A refusal the person can fix (not approved yet, no such video) fails the call, never retries. */
const verdictOf = async <T>(f: () => Promise<T>): Promise<T> => {
  try {
    return await f();
  } catch (err) {
    throw new restate.TerminalError((err as Error).message, { errorCode: 409 });
  }
};

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
    const plan = await ctx.run("client", () => clientDrafting(deps.db, id));
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
      /** His yes on a rendered video, one Short or the vertical: a YouTube draft (private unless asked), posted on the next pass. */
      approveVideo: exclusiveHandler(
        { input: VIDEO },
        async (
          ctx: restate.ObjectContext,
          req: {
            id: number;
            short?: number | null;
            vertical?: boolean | null;
            privacy?: VideoPrivacy | null;
          },
        ) => {
          const { db } = await scopeOf(ctx);
          return ctx.run("approve video", () =>
            verdict(async () => [
              await approveVideo(db, req.id, {
                source: "api",
                ...(req.short ? { short: req.short } : {}),
                ...(req.vertical ? { vertical: true } : {}),
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
      /**
       * Promote a YouTube video: one draft per platform in its tone, pointing at the video, each
       * waiting in To approve. Nothing posts.
       */
      promote: exclusiveHandler(
        { input: PROMOTE },
        async (
          ctx: restate.ObjectContext,
          req: {
            video?: number | null;
            draftId?: string | null;
            platforms?: PromoPlatform[] | null;
            again?: boolean | null;
            pieces?: PromoPiece[] | null;
            viewer?: unknown;
          },
        ): Promise<DraftReport> => {
          const s = await scopeOf(ctx, true);
          const video = req.video;
          if (!req.draftId && !video)
            throw new restate.TerminalError("name a video or its YouTube draft", {
              errorCode: 400,
            });
          const base = await ctx.run("promo", () =>
            verdictOf(async () =>
              promoBase(s.db, req.draftId || (await videoDraftOf(s.db, video as number))),
            ),
          );
          const pieces: PromoPiece[] = req.pieces?.length ? req.pieces : ["posts"];
          const asked = req.platforms?.length ? req.platforms : [...PROMO_PLATFORMS];
          // A client's promos only where its own logins post; the rest say why.
          const own = s.platforms;
          const posts = pieces.includes("posts") ? asked : [];
          const platforms = own ? posts.filter((p) => own.includes(p)) : posts;
          const runId = await ctx.run("open run", async () => {
            const run = await openRun(s.db, {
              command: "content promote",
              argv: { video: base.video.id, platforms, pieces },
            });
            return run.id;
          });
          const o = { ...options(s, runId, req.again ?? false), by: byOf(req) };
          const results: DraftResult[] = posts
            .filter((p) => !platforms.includes(p))
            .map((platform) => ({ platform, ok: false, reason: NOT_CONNECTED }));
          for (const p of platforms) {
            const [r] = await ctx.run(`${DRAFT_STAGE} ${p} promo`, () =>
              stopped([p], () => draftPromo(s.db, s.llm, base, p, o).then((x) => [x])),
            );
            if (r) results.push(r);
          }
          if (pieces.includes("thread")) {
            if (own && !own.includes("x"))
              results.push({ platform: "x", ok: false, reason: NOT_CONNECTED });
            else
              results.push(
                ...(await ctx.run(`${DRAFT_STAGE} x thread`, () =>
                  stopped(["x"], () => draftThread(s.db, s.llm, base, o).then((x) => [x])),
                )),
              );
          }
          if (pieces.includes("carousel")) {
            if (own && !own.includes("linkedin") && !own.includes("instagram"))
              results.push({ platform: "linkedin", ok: false, reason: NOT_CONNECTED });
            else {
              const made = await ctx.run(`${DRAFT_STAGE} carousel`, () =>
                stopped(["linkedin", "instagram"], () => draftCarousel(s.db, s.llm, base, o)),
              );
              results.push(...made);
              // Draw it now where a browser is wired; a miss leaves Draw in the slide editor.
              const first = made.find((r) => r.ok);
              const paint = deps.slides;
              const media = deps.media;
              if (first?.ok && paint && media)
                await ctx.run("draw slides", async () => {
                  try {
                    const { slides, html } = await slidesToDraw(s.db, first.draft.id, byLine(s));
                    await keepSlideFiles(
                      s.db,
                      first.draft.id,
                      await paintSlides(slides, html, paint, media),
                    );
                    return true;
                  } catch {
                    return false;
                  }
                });
            }
          }
          await ctx.run("finish run", () =>
            finishRun(s.db, runId, {
              drafted: results.filter((r) => r.ok).length,
              skipped: results.filter((r) => !r.ok).length,
            }),
          );
          return { ideaId: base.idea.id, results, runId };
        },
      ),
      /** Where a post sits in the funnel and where it points; the link follows. */
      funnel: exclusiveHandler(
        { input: FUNNEL },
        async (ctx: restate.ObjectContext, req: FunnelRequest) => {
          const { db } = await scopeOf(ctx);
          return ctx.run("funnel", () =>
            verdict(async () => [
              await setFunnel(db, req.draftId, funnelPatch(req), { by: byOf(req) }),
            ]),
          );
        },
      ),
      /**
       * A carousel's slides: the set saved on every draft that shares it, then (`draw`) drawn to a
       * square PNG each and a PDF in the media store. Nothing uploads to a platform.
       */
      slides: exclusiveHandler(
        { input: SLIDES },
        async (
          ctx: restate.ObjectContext,
          req: {
            draftId: string;
            slides?: { title: string; lines: string[] }[] | null;
            draw?: boolean | null;
            viewer?: unknown;
          },
        ): Promise<{ done: string[] }> => {
          const s = await scopeOf(ctx);
          const set = req.slides;
          const saved = set
            ? await ctx.run("slides", () =>
                verdict(() => saveSlides(s.db, req.draftId, set, { by: byOf(req) })),
              )
            : { done: [] };
          if (!req.draw) return saved;
          const paint = deps.slides;
          const media = deps.media;
          if (!paint || !media)
            throw new restate.TerminalError("Drawing slides isn't set up here", {
              errorCode: 503,
            });
          const toDraw = await ctx.run("read slides", () =>
            verdictOf(() => slidesToDraw(s.db, req.draftId, byLine(s))),
          );
          const files = await ctx.run("draw", () =>
            verdictOf(() => paintSlides(toDraw.slides, toDraw.html, paint, media)),
          );
          return ctx.run("keep drawn", () =>
            verdict(() => keepSlideFiles(s.db, req.draftId, files)),
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
/** The line over each slide: the brand that speaks. */
const byLine = (s: Pick<Scope, "brand">) => (s.brand ?? DEFAULT_BRAND).name;

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
