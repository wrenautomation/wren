/** ContentDesk handlers that propose a replacement post and settle it. */
import type * as restate from "@restatedev/restate-sdk";
import { byOf } from "@wren/core/ask";
import type { Platform, PostPatch } from "@wren/core/content";
import { clientOfKey, exclusiveHandler, PORTAL_FIELDS } from "@wren/core/restate";
import { z } from "zod";
import { askSwap, planSwap, skipSwaps, startSwap } from "../analytics/variants.js";
import { VARIANT_FIELDS, type VariantField } from "../schema.js";
import { type ContentDeskContext, verdictOf } from "./desk-context.js";

const SWAP = z.looseObject({
  draftId: z.string().describe("A published post's draft id"),
  field: z.enum(VARIANT_FIELDS).describe("What changes: title, thumbnail or hook"),
  value: z.string().min(1).describe("The new title, hook line, or the stored thumbnail file"),
  why: z.string().nullish().describe("What the swap tests, in a few words"),
  viewer: PORTAL_FIELDS.viewer,
});

const SWAP_IDS = z.looseObject({
  ids: z.array(z.number().int().positive()).min(1).max(50).describe("Swap ids (post_variants)"),
  viewer: PORTAL_FIELDS.viewer,
});

/** The `Content` service's swap, as the worker serves it. */
type ContentUpdate = {
  update: (
    ctx: restate.Context,
    req: { platform: Platform; id: string; patch: PostPatch; client?: string | null },
  ) => Promise<void>;
};

export function swapsHandlers(desk: ContentDeskContext) {
  const { scopeOf } = desk;
  return {
    /**
     * A swap on a live post's title, thumbnail or hook (designs/2026-10-07-content-analytics.md):
     * kept as asked, it waits in To approve. Nothing reaches the platform here.
     */
    swap: exclusiveHandler(
      { input: SWAP },
      async (
        ctx: restate.ObjectContext,
        req: {
          draftId: string;
          field: VariantField;
          value: string;
          why?: string | null;
          viewer?: unknown;
        },
      ): Promise<{ id: number }> => {
        const { db } = await scopeOf(ctx);
        const now = new Date(await ctx.date.now());
        const v = await ctx.run("ask swap", () =>
          verdictOf(() => askSwap(db, { ...req, by: byOf(req) }, now)),
        );
        return { id: v.id };
      },
    ),
    /** His yes on swaps: each goes to the platform, then its window starts. */
    swapApprove: exclusiveHandler(
      { input: SWAP_IDS, effect: "posts" },
      async (
        ctx: restate.ObjectContext,
        req: { ids: number[]; viewer?: unknown },
      ): Promise<{ done: number[] }> => {
        const { db } = await scopeOf(ctx);
        const client = clientOfKey(ctx.key)?.client ?? null;
        const content = ctx.serviceClient<ContentUpdate>({ name: "Content" });
        const done: number[] = [];
        for (const id of req.ids) {
          const plan = await ctx.run(`plan swap ${id}`, () => verdictOf(() => planSwap(db, id)));
          await content.update({
            platform: plan.platform,
            id: plan.publishedId,
            patch: plan.patch,
            ...(client ? { client } : {}),
          });
          const now = new Date(await ctx.date.now());
          await ctx.run(`start swap ${id}`, () => startSwap(db, id, byOf(req), now));
          done.push(id);
        }
        return { done };
      },
    ),
    /** His no on swaps: they never go out. */
    swapSkip: exclusiveHandler(
      { input: SWAP_IDS },
      async (
        ctx: restate.ObjectContext,
        req: { ids: number[]; viewer?: unknown },
      ): Promise<{ done: number[] }> => {
        const { db } = await scopeOf(ctx);
        const now = new Date(await ctx.date.now());
        return {
          done: await ctx.run("skip swaps", () => skipSwaps(db, req.ids, byOf(req), now)),
        };
      },
    ),
  };
}
