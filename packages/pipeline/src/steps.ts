/**
 * The two spine steps of a funnel workflow (designs/2026-10-18-journeys.md, "Journeys on the
 * spine"). `journey.move` maps a cause to a person's journey and moves it. `journey.stage` is the
 * stage arrival: the timeline line, the stage's research, the trigger fire, the deal. Both are idempotent: Restate may
 * run a step again, and a repeated cause finds the journey already moved.
 */
import { createHash } from "node:crypto";
import { profileRollups } from "@wren/core/people-map-schema";
import { profileEvents } from "@wren/core/profiles-schema";
import type { SpineEvent, Step } from "@wren/core/spine";
import { atomic, type Db } from "@wren/db";
import { desc, eq } from "drizzle-orm";
import { type CauseFacts, entryOf, opensAt } from "./entry.js";
import { openJourney, personOf, saleStageOf, textOf, versionOf } from "./journeys.js";
import { DROPPED } from "./model.js";
import { icpOf, type Researcher, requestResearch } from "./research.js";
import { journeys, offerVersions, pipelineDeals } from "./schema.js";
import { nextStage } from "./stages.js";
import { JOURNEY_PORT, MOVE_STEP, parseFunnelFlow, STAGE_STEP } from "./workflow.js";

export const CAUSE_KINDS = [
  "touch",
  "payment",
  "booking",
  "reply",
  "document",
  "form",
  "funnel",
  "group",
  "sourced",
  "manual",
  "import",
  "version",
] as const;
export type CauseKind = (typeof CAUSE_KINDS)[number];

/** Why a journey moved: its kind, the cause's own id, and when. */
export interface Cause {
  kind: CauseKind;
  ref: string;
  at: string;
}

const KIND_OF_EVENT: Partial<Record<SpineEvent["kind"], CauseKind>> = {
  reply: "reply",
  call: "booking",
  invoice: "payment",
  document: "document",
  form: "form",
  journey: "funnel",
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The cause a spine event stands for: the one its data names, else by the event's kind. */
export function causeOf(e: SpineEvent, now: Date): Cause {
  const named = isRecord(e.data.cause) ? e.data.cause : {};
  // A person entering a group: the group is the proof.
  const group = e.data.change === "entered" ? textOf(e.data.segment) : undefined;
  const kind =
    CAUSE_KINDS.find((k) => k === named.kind) ??
    (group ? "group" : KIND_OF_EVENT[e.kind]) ??
    "touch";
  return {
    kind,
    ref: textOf(named.ref) ?? textOf(e.data.ref) ?? group ?? e.subject,
    at: textOf(named.at) ?? now.toISOString(),
  };
}

/** What a cause says about where the person came from, for `entryOf`. */
export function factsOf(data: Record<string, unknown>): CauseFacts {
  const f: CauseFacts = {};
  const entry = textOf(data.entry);
  const channel = textOf(data.channel) ?? textOf(data.platform);
  const campaign = textOf(data.campaign);
  const funnel = textOf(data.funnel);
  const stage = textOf(data.stage);
  const source = textOf(data.source);
  // A group's entered event carries its id as `segment`.
  const group = textOf(data.group) ?? textOf(data.segment);
  if (entry) f.entry = entry;
  if (channel) f.channel = channel;
  if (campaign) f.campaign = campaign;
  if (funnel) f.funnel = funnel;
  if (stage) f.stage = stage;
  if (source) f.source = source;
  if (group) f.group = group;
  return f;
}

export interface JourneyStepDeps {
  /** The workspace database: Wren's for `null`, else that client's. */
  db(client: string | null): Db;
  now?(): Date;
  /** Runs a stage's `research` on arrival. Unset: the level is carried and nothing runs. */
  researcher?: Researcher;
}

/** `profile_events.source_id` is 64 characters: a journey and a stage fit as a hash. */
const lineId = (journey: string, stage: string) =>
  createHash("sha256").update(`${journey}:${stage}`).digest("hex").slice(0, 40);

/** The two steps, to register by name in the spine's `steps`. */
export function journeySteps(d: JourneyStepDeps): Record<string, Step> {
  const now = () => d.now?.() ?? new Date();

  const move: Step = async (port, e, at) => {
    const db = d.db(at.client);
    const flow = parseFunnelFlow(at.workflow);
    const to = textOf(at.with.to);
    if (!flow || !to) return [];
    const funnel = await versionOf(db, flow.funnel, flow.version);
    if (!funnel) return [];
    const { body } = funnel;
    const stages = body.stages.map((s) => s.key);
    if (!stages.includes(to)) return [];
    const profile = await personOf(db, e.data);
    if (profile === null) return [];
    const cause = causeOf(e, now());
    const facts = factsOf(e.data);
    // The row that added the person to a sourced list.
    const row = textOf(e.data.row);

    const done = await atomic(db, async (tx) => {
      let j = await openJourney(tx, profile, flow.funnel);
      let from: string | null = null;
      let skipped: string[] = [];
      if (j) {
        // Another version of the funnel owns this journey: its own node moves it.
        if (j.version !== flow.version) return null;
        if (j.stage !== to) {
          const step = nextStage(body.stages, j.stage, to, j.status);
          if (!step) return null;
          from = j.stage;
          skipped = step.skipped;
          await tx.update(journeys).set({ stage: to, movedAt: now() }).where(eq(journeys.id, j.id));
        }
        // Already at `to`: a repeat of a move that crashed before it was kept. Say it again;
        // the stage node refuses a second arrival.
      } else {
        // Only the live newest version opens journeys, and only from a cause an entry at `to` takes.
        if (flow.version !== funnel.newest || funnel.status !== "live") return null;
        if (!opensAt(body, to, port === JOURNEY_PORT, facts)) return null;
        const [touch] = await tx
          .select({ channel: profileRollups.firstChannel })
          .from(profileRollups)
          .where(eq(profileRollups.profileId, profile))
          .limit(1);
        const entry = entryOf(
          { ...body, entries: body.entries.filter((x) => (x.to ?? stages[0]) === to) },
          facts,
          touch?.channel ? { channel: touch.channel } : null,
        );
        const [made] = await tx
          .insert(journeys)
          .values({
            profileId: profile,
            funnel: flow.funnel,
            version: flow.version,
            stage: to,
            entry: entry.id,
            entryRef: { subject: e.subject, cause, ...facts, ...(row ? { row } : {}) },
            openedAt: now(),
            movedAt: now(),
          })
          .onConflictDoNothing()
          .returning();
        // Another call opened one first: join it.
        j = made ?? (await openJourney(tx, profile, flow.funnel));
        if (!j || j.version !== flow.version) return null;
        if (!made && j.stage !== to) return null;
      }
      return { journey: j.id, from, skipped };
    });
    if (!done) return [];
    return [
      {
        port: "moved",
        event: {
          subject: `journey:${done.journey}`,
          kind: "journey",
          data: {
            journey: done.journey,
            profile,
            funnel: flow.funnel,
            version: flow.version,
            from: done.from,
            to,
            skipped: done.skipped,
            cause,
          },
        },
      },
    ];
  };

  const stage: Step = async (_port, e, at) => {
    const db = d.db(at.client);
    const flow = parseFunnelFlow(at.workflow);
    const key = textOf(at.with.stage);
    const journey = textOf(e.data.journey);
    if (!flow || !key || !journey) return [];
    const profile = Number(e.data.profile);
    const version = Number(e.data.version) || flow.version;
    const loaded = await versionOf(db, flow.funnel, version);
    if (!loaded || !Number.isInteger(profile)) return [];
    const { body } = loaded;
    const dropped = key === DROPPED;
    const where = dropped ? textOf(e.data.stage) : key;
    const label = body.stages.find((s) => s.key === where)?.label ?? where ?? key;
    const change = dropped ? "dropped" : "entered";
    const skipped = Array.isArray(e.data.skipped) ? e.data.skipped.map(String) : [];

    const made = await atomic(db, async (tx) => {
      await tx
        .insert(profileEvents)
        .values({
          profileId: profile,
          kind: "journey",
          channel: "journey",
          at: now(),
          summary: dropped ? `Dropped from ${body.name} at ${label}` : `${label} in ${body.name}`,
          body: dropped ? (textOf(e.data.reason) ?? null) : null,
          source: "journeys",
          sourceId: lineId(journey, key),
        })
        .onConflictDoNothing();
      if (dropped) return false;
      const last = body.stages.at(-1)?.key;
      // The last stage ends the journey; it never reopens.
      if (key === last) {
        await tx
          .update(journeys)
          .set({ status: "done", closedAt: now() })
          .where(eq(journeys.id, journey));
      }
      if (key !== saleStageOf(body)) return false;
      const [offer] = await tx
        .select({ number: offerVersions.number })
        .from(offerVersions)
        .where(eq(offerVersions.offer, body.offer))
        .orderBy(desc(offerVersions.number))
        .limit(1);
      if (!offer) return null;
      await tx
        .insert(pipelineDeals)
        .values({
          journey,
          profileId: profile,
          offer: body.offer,
          offerVersion: offer.number,
          signedAt: now(),
        })
        .onConflictDoNothing({ target: pipelineDeals.journey });
      return true;
    });
    if (made === null)
      console.warn(`journey ${journey}: no offer version for ${body.offer}, so no deal yet`);

    const level = textOf(at.with.research);
    if (d.researcher && !dropped && (level === "light" || level === "full")) {
      // Never blocks the arrival: a failed ask is logged and the journey goes on.
      try {
        await requestResearch(
          db,
          d.researcher,
          {
            client: at.client,
            profile,
            journey,
            stage: key,
            level,
            offer: body.offer,
            icp: await icpOf(db, body.offer),
          },
          now(),
        );
      } catch (err) {
        console.warn(`journey ${journey}: research at ${key} failed: ${String(err)}`);
      }
    }

    const told = (stageKey: string, kind: "entered" | "skipped" | "dropped") =>
      at.fire?.({
        facts: {
          trigger: "trigger.journey",
          funnel: flow.funnel,
          stage: stageKey,
          change: kind,
          // Entering the sale stage wins a deal: webhooks hear `deal.won` as well as the move.
          ...(kind === "entered" && stageKey === saleStageOf(body) ? { sale: true as const } : {}),
        },
        event: {
          subject: `journey:${journey}`,
          kind: "journey",
          // To a funnel that hears it, the cause is this journey.
          data: {
            journey,
            profile,
            funnel: flow.funnel,
            version,
            stage: stageKey,
            change: kind,
            cause: { kind: "funnel", ref: journey, at: now().toISOString() },
          },
        },
      });
    if (dropped) {
      if (where) told(where, "dropped");
    } else {
      told(key, change);
      for (const s of skipped) told(s, "skipped");
    }
    return [];
  };

  return { [MOVE_STEP]: move, [STAGE_STEP]: stage };
}
