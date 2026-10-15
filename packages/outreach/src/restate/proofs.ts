/**
 * `CommentProofs` (designs/2026-10-14-comment-proof.md): each sent comment checked at 2 minutes,
 * an hour and a day (`scheduleProofs`, called by the send handlers), or now by hand. A check
 * reads through the desk (`siteProof`), keeps its shot, overwrites the item's `comment_proofs`
 * row and appends to its checks. The hour's check that is not live goes to Discord once. A used
 * daily cap on the public read keeps nothing: the check comes back once the cap resets.
 */
import * as restate from "@restatedev/restate-sdk";
import {
  capWaitMs,
  type KeepShot,
  type Proof,
  type SiteClient,
  siteProof,
} from "@wren/core/content";
import type { Notifier } from "@wren/core/notify";
import { serviceHandler } from "@wren/core/restate";
import type { Db } from "@wren/db";
import { z } from "zod";
import { HAND_ROUND, keepProof, PROOF_ROUNDS, proofTarget, warningOf } from "../proofs.js";

export const PROOFS_SERVICE = { name: "CommentProofs" } as const;

export interface ProofsDeps {
  db: Db;
  /** The desk's sites client for this context. */
  sitesFor: (ctx: restate.Context) => SiteClient;
  /** Puts a shot in the media bucket; unset, no shot is taken. */
  keep?: KeepShot;
  notifier?: Notifier;
  /** LinkedIn's signed-in reader when the item names none. */
  linkedinAccount?: string;
}

export interface ProofCheck {
  item: string;
  /** 1, 2, 3 for the 2-minute, hour and day checks; 0 (the default) by hand. */
  round?: number;
}

const CHECK = z.looseObject({
  item: z
    .string()
    .regex(/^(thread|onpost|comment):[A-Za-z0-9_]{1,40}$/)
    .describe("thread:t3_x, onpost:9 or comment:4"),
  round: z.number().int().min(0).max(3).optional(),
});

type ProofsClient = { check: (ctx: restate.Context, req: ProofCheck) => Promise<unknown> };

/** The three delayed checks for a sent item; the journal keeps them, so a retry adds none. */
export function scheduleProofs(ctx: restate.Context, item: string): void {
  const c = ctx.serviceSendClient<ProofsClient>(PROOFS_SERVICE);
  for (const r of PROOF_ROUNDS)
    c.check({ item, round: r.round }, restate.rpc.sendOpts<ProofCheck>({ delay: r.delayMs }));
}

export function makeCommentProofs(deps: ProofsDeps) {
  return restate.service({
    name: PROOFS_SERVICE.name,
    handlers: {
      /** Check one sent item now: its proof, kept. */
      check: serviceHandler(
        { input: CHECK },
        async (ctx: restate.Context, req: ProofCheck): Promise<Proof> => {
          const round = req.round ?? HAND_ROUND;
          const target = await ctx.run("target", () => proofTarget(deps.db, req.item));
          if (!target) throw new restate.TerminalError(`${req.item} was never sent`);
          const at = new Date(await ctx.date.now());
          const keep = deps.keep;
          let proof: Proof;
          try {
            proof = await siteProof({
              sites: deps.sitesFor(ctx),
              now: () => at,
              ...(keep ? { keep: (b: Uint8Array) => ctx.run("keep shot", () => keep(b)) } : {}),
              ...(deps.linkedinAccount ? { linkedinAccount: deps.linkedinAccount } : {}),
            }).check(target);
          } catch (err) {
            // The public read's daily cap is used: nothing read, nothing kept. A scheduled check
            // comes back once it resets; one by hand says when.
            const wait = capWaitMs(err);
            if (wait === null) throw err;
            if (round !== HAND_ROUND)
              ctx
                .serviceSendClient<ProofsClient>(PROOFS_SERVICE)
                .check(
                  { item: req.item, round },
                  restate.rpc.sendOpts<ProofCheck>({ delay: wait }),
                );
            return {
              state: "pending",
              checkedAt: at.toISOString(),
              url: target.url,
              shot: null,
              note: `the public read cap is used; it resets in ${Math.ceil(wait / 3_600_000)}h`,
            };
          }
          const kept = await ctx.run("keep", () =>
            keepProof(deps.db, req.item, target.platform, proof, round),
          );
          const notifier = deps.notifier;
          if (kept.warn && notifier) {
            const w = warningOf(req.item, target.platform, proof);
            await ctx.run("warn", () => notifier.notify(w.title, w.body, "warning"));
          }
          return proof;
        },
      ),
    },
  });
}

export type CommentProofsService = ReturnType<typeof makeCommentProofs>;
