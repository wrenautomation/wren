/** ContentDesk handlers for the formats beyond a post: stories, carousels and slides. */
import * as restate from "@restatedev/restate-sdk";
import { byOf } from "@wren/core/ask";
import { exclusiveHandler, PORTAL_FIELDS, sharedHandler } from "@wren/core/restate";
import { z } from "zod";
import {
  CAROUSEL_PLATFORMS,
  type CarouselPlatform,
  keepSlideFiles,
  paintSlides,
  saveSlides,
  slidesToDraw,
  writeCarousel,
} from "../carousel.js";
import { type SlidesSaved, slidesSaved } from "../shape-view.js";
import { STORY_PLATFORMS, type StoryPlatform, storyClips, writeStory } from "../story.js";
import {
  byLine,
  type ContentDeskContext,
  NONE,
  verdict,
  verdictOf,
  verdictSaved,
  WRITE_GO,
  type WriteGo,
  written,
} from "./desk-context.js";

const STORY = z.looseObject({
  platforms: z.array(z.enum(STORY_PLATFORMS)).min(1).describe("Where the story goes"),
  photo: z
    .object({ name: z.string().min(1), data: z.string().min(1) })
    .nullish()
    .describe("A JPG or PNG as base64, up to 2 MB"),
  clip: z.string().nullish().describe("A Reel draft's id: its stored video"),
  go: z.enum(WRITE_GO).nullish().describe("draft (default), slot or now"),
});

const CAROUSEL = z.looseObject({
  slides: z
    .array(z.looseObject({ title: z.string(), lines: z.array(z.string()) }))
    .min(1)
    .describe("5 to 10 slides, a title and a few short lines each"),
  text: z.string().min(1).describe("The caption: Instagram's, and LinkedIn's post words"),
  platforms: z.array(z.enum(CAROUSEL_PLATFORMS)).min(1).describe("Where the carousel goes"),
  go: z.enum(WRITE_GO).nullish().describe("draft (default), slot or now"),
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

export function formatsHandlers(desk: ContentDeskContext) {
  const { deps, scopeOf, goOn } = desk;
  return {
    /** A story on Instagram and the Page from a photo or a clip; Write's draft, slot or now. */
    story: exclusiveHandler(
      { input: STORY },
      async (
        ctx: restate.ObjectContext,
        req: {
          platforms: StoryPlatform[];
          photo?: { name: string; data: string } | null;
          clip?: string | null;
          go?: WriteGo | null;
          viewer?: unknown;
        },
      ) => {
        const s = await scopeOf(ctx);
        const made = await ctx.run("story", () =>
          verdictOf(() =>
            writeStory(s.db, deps.media ?? null, {
              platforms: req.platforms,
              photo: req.photo ?? null,
              clip: req.clip ?? null,
            }),
          ),
        );
        const out = [{ ideaId: made.ideaId, results: made.results.map(written) }];
        await goOn(ctx, s.db, out, req.go ?? "draft", byOf(req));
        return { posts: out };
      },
    ),
    /**
     * A carousel he wrote (Marketing → Write): the slide set on a draft per platform, drawn
     * where a browser is wired (a miss leaves Draw in the slide editor), then Write's draft,
     * slot or now. An undrawn carousel can't be approved, so it waits as a draft.
     */
    carousel: exclusiveHandler(
      { input: CAROUSEL },
      async (
        ctx: restate.ObjectContext,
        req: {
          slides: { title: string; lines: string[] }[];
          text: string;
          platforms: CarouselPlatform[];
          go?: WriteGo | null;
          viewer?: unknown;
        },
      ) => {
        const s = await scopeOf(ctx);
        const by = byOf(req);
        const made = await ctx.run("carousel", () =>
          verdictOf(() =>
            writeCarousel(s.db, {
              slides: req.slides,
              text: req.text,
              platforms: req.platforms,
              by,
            }),
          ),
        );
        const first = made.results.find((r) => r.ok);
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
        const out = [{ ideaId: made.ideaId, results: made.results.map(written) }];
        await goOn(ctx, s.db, out, req.go ?? "draft", by);
        return { posts: out };
      },
    ),
    /** Clips a story can share: stored Reels, newest first. */
    storyClips: sharedHandler({ input: NONE }, async (ctx: restate.ObjectSharedContext) => {
      const { db } = await scopeOf(ctx);
      return { clips: await ctx.run("clips", () => storyClips(db)) };
    }),
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
      ): Promise<{ done: string[]; saved?: SlidesSaved }> => {
        const s = await scopeOf(ctx);
        const set = req.slides;
        const saved = set
          ? await ctx.run("slides", () =>
              verdictSaved(
                () => saveSlides(s.db, req.draftId, set, { by: byOf(req) }),
                (rows) => slidesSaved(req.draftId, rows),
              ),
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
        return ctx.run("keep drawn", () => verdict(() => keepSlideFiles(s.db, req.draftId, files)));
      },
    ),
  };
}
