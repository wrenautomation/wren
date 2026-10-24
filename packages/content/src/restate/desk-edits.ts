/** ContentDesk handlers that change a draft in place: fields, promotion, funnel, attachments, text. */
import * as restate from "@restatedev/restate-sdk";
import { finishRun, openRun } from "@wren/core";
import { byOf } from "@wren/core/ask";
import { SHAPES } from "@wren/core/content/shapes";
import { exclusiveHandler, PORTAL_FIELDS } from "@wren/core/restate";
import { z } from "zod";
import { ATTACH_MAX_BYTES, attachFile } from "../attach.js";
import { keepSlideFiles, paintSlides, slidesToDraw } from "../carousel.js";
import { DRAFT_STAGE, type DraftResult } from "../draft.js";
import { type FunnelPatch, setFunnel } from "../funnel.js";
import { aboutDraft } from "../platforms.js";
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
import { editDraft, getDraft, setFields } from "../review.js";
import { FUNNEL_STAGES, FUNNEL_TARGETS, type FunnelStage, type FunnelTarget } from "../schema.js";
import { fieldsSaved } from "../shape-view.js";
import {
  byLine,
  type ContentDeskContext,
  type DraftReport,
  stopped,
  verdict,
  verdictOf,
  verdictSaved,
} from "./desk-context.js";

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
  page: z
    .string()
    .nullish()
    .describe("The Sites page it points at (Wren's); empty clears it, left out: unchanged"),
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
  page?: string | null;
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
    ...(req.page !== undefined && req.page !== null ? { page: req.page || null } : {}),
    ...(linked !== undefined ? { linked } : {}),
  };
}

/** Why a client's promo skips a platform: none of its logins posts there yet. */
export const NOT_CONNECTED = "no login of this client's posts here yet";

export function editsHandlers(desk: ContentDeskContext) {
  const { deps, options, scopeOf } = desk;
  return {
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
          verdictSaved(
            async () => {
              const d = await getDraft(db, req.draftId);
              for (const [k, v] of Object.entries(req.patch)) {
                const f = SHAPES[d.platform].fields.find((x) => x.key === k);
                if ((f?.input === "image" || f?.input === "captions") && v !== null && v !== "")
                  throw new Error(aboutDraft(d, `${f.label} takes a file. Use Upload beside it`));
              }
              return [await setFields(db, req.draftId, req.patch, { by: byOf(req) })];
            },
            ([row]) => (row ? fieldsSaved(row) : null),
          ),
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
  };
}
