/**
 * Collected money (designs/2026-10-18-journeys.md, "Causes"): `pipeline.money` hears every
 * payment change and `pipeline.collect` folds it into the deal it names. Paid adds, refunded
 * subtracts, the rest is ignored. Each change lands once: its timeline line is the claim, and
 * the fold runs in the same transaction as the claim.
 */
import { createHash } from "node:crypto";
import type { Port } from "@wren/core/components";
import { UUID } from "@wren/core/ids";
import { profileEvents } from "@wren/core/profiles-schema";
import type { Step } from "@wren/core/spine";
import { defineWorkflow, type Workflow } from "@wren/core/workflows";
import { atomic, type Db } from "@wren/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { personOf, textOf } from "./journeys.js";
import { pipelineDeals } from "./schema.js";

export const COLLECT_STEP = "pipeline.collect";
const MONEY_WORKFLOW_ID = "pipeline.money";

const money: Port = { id: "payments", label: "payments", kind: "invoice" };

/** In every workspace: each paid and refunded change into the collect step. */
export const MONEY_WORKFLOW: Workflow = defineWorkflow({
  id: MONEY_WORKFLOW_ID,
  name: "Collected money",
  blurb: "Adds each payment to its deal's collected total, and takes refunds off.",
  icon: "board",
  for: "client",
  stage: "follow",
  nodes: [
    { id: "paid", uses: "trigger.payment", with: { on: "paid" } },
    { id: "refunded", uses: "trigger.payment", with: { on: "refunded" } },
    {
      id: "collect",
      own: {
        name: "Collect",
        blurb: "Folds a payment into the deal it names.",
        icon: "board",
        in: [money],
        out: [],
        run: COLLECT_STEP,
      },
    },
  ],
  wires: [
    { from: "paid.out", to: "collect.payments", via: "events" },
    { from: "refunded.out", to: "collect.payments", via: "events" },
  ],
});

const whole = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : 0;
};

/** What a payment change does to collected cents: paid adds, refunded takes off, else zero. */
export function collectedDelta(data: Record<string, unknown>): number {
  if (data.change === "paid") return whole(data.amount_cents);
  if (data.change === "refunded") return -whole(data.refunded_cents);
  return 0;
}

/** `profile_events.source_id` is 64 characters: a subject fits as a hash. */
const lineId = (subject: string) => createHash("sha256").update(subject).digest("hex").slice(0, 40);

interface CollectDeps {
  /** The workspace database: Wren's for `null`, else that client's. */
  db(client: string | null): Db;
  now?(): Date;
}

const dollars = (cents: number, currency: string) =>
  `${(Math.abs(cents) / 100).toFixed(2)} ${currency}`;

/** `pipeline.collect`, to register by name in the spine's `steps`. */
export function collectSteps(d: CollectDeps): Record<string, Step> {
  const collect: Step = async (_port, e, at) => {
    const delta = collectedDelta(e.data);
    if (delta === 0) return [];
    const db = d.db(at.client);
    const named = textOf(e.data.deal);
    const offer = textOf(e.data.offer);
    const currency = (textOf(e.data.currency) ?? "USD").toUpperCase();
    await atomic(db, async (tx) => {
      let deal: { id: string; profileId: number; currency: string } | undefined;
      if (named) {
        // A deal named but unknown or malformed is nobody's: no guess.
        if (!UUID.test(named)) return;
        [deal] = await tx
          .select({
            id: pipelineDeals.id,
            profileId: pipelineDeals.profileId,
            currency: pipelineDeals.currency,
          })
          .from(pipelineDeals)
          .where(eq(pipelineDeals.id, named))
          .for("update");
      } else {
        const profile = await personOf(tx, e.data);
        if (profile === null) return;
        [deal] = await tx
          .select({
            id: pipelineDeals.id,
            profileId: pipelineDeals.profileId,
            currency: pipelineDeals.currency,
          })
          .from(pipelineDeals)
          .where(
            and(
              eq(pipelineDeals.profileId, profile),
              eq(pipelineDeals.status, "open"),
              ...(offer ? [eq(pipelineDeals.offer, offer)] : []),
            ),
          )
          .orderBy(desc(pipelineDeals.signedAt))
          .limit(1)
          .for("update");
      }
      if (!deal || deal.currency !== currency) return;
      const claim = await tx
        .insert(profileEvents)
        .values({
          profileId: deal.profileId,
          kind: "journey",
          channel: "journey",
          at: d.now?.() ?? new Date(),
          summary:
            delta > 0
              ? `Collected ${dollars(delta, currency)}`
              : `Refunded ${dollars(delta, currency)}`,
          source: "collected",
          sourceId: lineId(e.subject),
        })
        .onConflictDoNothing()
        .returning({ id: profileEvents.id });
      if (!claim.length) return;
      await tx
        .update(pipelineDeals)
        .set({ collectedCents: sql`greatest(0, ${pipelineDeals.collectedCents} + ${delta})` })
        .where(eq(pipelineDeals.id, deal.id));
    });
    return [];
  };
  return { [COLLECT_STEP]: collect };
}
