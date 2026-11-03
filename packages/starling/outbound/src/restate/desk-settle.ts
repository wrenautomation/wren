/**
 * `ReachDesk/settleSend`: a person's word on a send autobrowse could not call
 * (designs/2026-10-16-maybe-sent.md).
 */
import type * as restate from "@restatedev/restate-sdk";
import { byOf } from "@wren/core/ask";
import { executorEmit } from "@wren/core/executor";
import { serviceHandler } from "@wren/core/restate";
import { cadenceId } from "@wren/core/workflows";
import {
  dropItem,
  itemOf,
  markPosted,
  ReachRefusal,
  SETTLE_OUTCOMES,
  type SettleOutcome,
  unsureItem,
} from "@wren/starling-acts";
import { z } from "zod";
import { reachLead } from "../follow.js";
import { markDmPosted, reachKinds, requeueDm } from "../item-kinds.js";
import type { DeskContext } from "./desk-context.js";
import { scheduleProofs } from "./proofs.js";

/** A person's word on an unsure send (designs/2026-10-16-maybe-sent.md). */
const SETTLE_SEND = z.looseObject({
  item: z
    .string()
    .min(3)
    .max(80)
    .describe("The send's typed id: thread:, comment:, onpost:, dm:, private:"),
  outcome: z
    .enum(SETTLE_OUTCOMES)
    .describe(
      "posted: he saw it on the site; again: send it once more; dropped: it did not go out and stays out",
    ),
  by: z
    .literal("autobrowse")
    .optional()
    .describe("The sender's recheck found it on the site (WA-1012); unset: the viewer"),
});

/** ReachDesk's own sends, called again on a person's Send again. */
type DeskSends = {
  [K in "commentThread" | "answerComment" | "commentPost"]: (
    ctx: restate.Context,
    req: { id: string | number; again: true; viewer?: unknown },
  ) => Promise<unknown>;
} & {
  dmComment: (
    ctx: restate.Context,
    req: { id: number; body: string; again: true; viewer?: unknown },
  ) => Promise<unknown>;
};

/** `ContentDesk/<key>/settlePost` as the content package serves it; no import from there. */
export type PostSettle = {
  settlePost: (
    ctx: restate.ObjectContext,
    req: { id: string; outcome: SettleOutcome; by: string },
  ) => Promise<{ id: string; outcome: SettleOutcome; found: boolean }>;
};

export function settleHandlers(desk: DeskContext) {
  const { deps, terminal, nowOf, nudge } = desk;
  return {
    /**
     * Settle a send that may have gone out and autobrowse could not tell (it waits in To
     * approve): `posted` records it as sent; `again` sends it once more through its own
     * handler, under a new key; `dropped` closes the item unsent. Wren's own sends only. A
     * post of ours on our own channel (`draft:`) settles in `ContentDesk/default/settlePost`.
     */
    settleSend: serviceHandler(
      { input: SETTLE_SEND, effect: "sends" },
      async (
        ctx: restate.Context,
        req: { item: string; outcome: SettleOutcome; by?: "autobrowse"; viewer?: unknown },
      ): Promise<{ item: string; outcome: SettleOutcome }> => {
        const now = await nowOf(ctx);
        const by = req.by ?? byOf(req);
        const { kind, id, words } = await ctx.run("item", () =>
          terminal(async () => {
            const a = await unsureItem(deps.db, req.item);
            const it = itemOf(req.item);
            if (it.kind === "sdm")
              throw new ReachRefusal("a connected account's answer settles in its Inbox");
            return { ...it, words: a.words };
          }),
        );
        if (kind === "draft") {
          await ctx
            .objectClient<PostSettle>({ name: "ContentDesk" }, "default")
            .settlePost({ id, outcome: req.outcome, by });
          return { item: req.item, outcome: req.outcome };
        }
        if (req.outcome === "dropped") {
          await ctx.run("dropped", () =>
            terminal(() => dropItem(deps.db, req.item, reachKinds, { by, now })),
          );
          return { item: req.item, outcome: "dropped" };
        }
        if (req.outcome === "posted") {
          if (kind === "dm") {
            const stats = await ctx.run("posted", () =>
              terminal(() =>
                markDmPosted(deps.db, req.item, {
                  sequences: deps.sequences,
                  sender: deps.senderName,
                  by,
                  now,
                }),
              ),
            );
            // A DM's sequence step leaves its node, as the sender's would.
            for (const s of stats.stepped)
              executorEmit(ctx, {
                client: null,
                workflow: cadenceId(s.sequence),
                from: `s${s.step}.sent`,
                events: [reachLead(s.contactId)],
              });
            return { item: req.item, outcome: "posted" };
          }
          await ctx.run("posted", () =>
            terminal(() => markPosted(deps.db, req.item, reachKinds, { by, now })),
          );
          if (kind !== "private") scheduleProofs(ctx, req.item);
          return { item: req.item, outcome: "posted" };
        }
        if (kind === "dm") {
          await ctx.run("requeue", () => terminal(() => requeueDm(deps.db, Number(id), now)));
          nudge(ctx);
          return { item: req.item, outcome: "again" };
        }
        const desk = ctx.serviceClient<DeskSends>({ name: "ReachDesk" });
        const again = { again: true as const, viewer: req.viewer };
        if (kind === "thread") await desk.commentThread({ id, ...again });
        else if (kind === "comment") await desk.answerComment({ id: Number(id), ...again });
        else if (kind === "private")
          await desk.dmComment({ id: Number(id), body: words, ...again });
        else await desk.commentPost({ id: Number(id), ...again });
        return { item: req.item, outcome: "again" };
      },
    ),
  };
}
