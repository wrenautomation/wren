/**
 * The two executor steps of a shape workflow (designs/2026-10-19-business-map.md). `journey.move`
 * maps a cause to a person's journey and moves it along the shortest flow path to the node, or
 * opens one there from a source. `journey.stage` is the arrival: the timeline line, the node's
 * research, the trigger fire, the deal or the signing. Both are idempotent: Restate may run a
 * step again, and a repeated cause finds the journey already moved.
 */
import { createHash } from "node:crypto";
import type { ExecutorEvent, Step } from "@wren/core/executor";
import { profileRollups } from "@wren/core/people-map-schema";
import { profileEvents } from "@wren/core/profiles-schema";
import { atomic, type Db } from "@wren/db";
import { desc, eq } from "drizzle-orm";
import { attributionOf, withAdCampaign } from "./attribution.js";
import { type CauseFacts, entryOf, MANUAL, opensAt, sourceEdge } from "./entry.js";
import { openJourney, ownerOf, personOf, textOf, versionOf } from "./journeys.js";
import {
  type Crossing,
  DROPPED,
  edgesOf,
  isEnd,
  nodeOf,
  passedThrough,
  pathOf,
  type ShapeBody,
} from "./model.js";
import { signDeal } from "./moves.js";
import { icpOf, type Researcher, requestResearch } from "./research.js";
import { instances, offerVersions, pipelineDeals } from "./schema.js";
import { liveTerms } from "./store.js";
import { JOURNEY_PORT, MOVE_STEP, parseShapeFlow, STAGE_STEP } from "./workflow.js";

const CAUSE_KINDS = [
  "touch",
  "payment",
  "booking",
  "reply",
  "document",
  "form",
  // A journey's own move, heard by a trigger.journey node (kept under its old name).
  "funnel",
  "group",
  "sourced",
  "manual",
  "import",
  "version",
] as const;
type CauseKind = (typeof CAUSE_KINDS)[number];

/** Why a journey moved: its kind, the cause's own id, and when. */
interface Cause {
  kind: CauseKind;
  ref: string;
  at: string;
}

const KIND_OF_EVENT: Partial<Record<ExecutorEvent["kind"], CauseKind>> = {
  reply: "reply",
  call: "booking",
  invoice: "payment",
  document: "document",
  form: "form",
  journey: "funnel",
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The cause an executor event stands for: the one its data names, else by the event's kind. */
export function causeOf(e: ExecutorEvent, now: Date): Cause {
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
  const source = textOf(data.source);
  // A group's entered event carries its id as `segment`.
  const group = textOf(data.group) ?? textOf(data.segment);
  if (entry) f.entry = entry;
  if (channel) f.channel = channel;
  if (campaign) f.campaign = campaign;
  if (source) f.source = source;
  if (group) f.group = group;
  return f;
}

interface JourneyStepDeps {
  /** The workspace database: Wren's for `null`, else that client's. */
  db(client: string | null): Db;
  now?(): Date;
  /** Runs a node's `research` on arrival. Unset: the level is carried and nothing runs. */
  researcher?: Researcher;
}

/** `profile_events.source_id` is 64 characters: a journey and a node fit as a hash. */
const lineId = (journey: string, node: string) =>
  createHash("sha256").update(`${journey}:${node}`).digest("hex").slice(0, 40);

/**
 * The offer a node's research reads the ICP of: the nearest offer node at or below it, else the
 * latest one on the trail. Null when the shape has none on this person's way.
 */
function offerFor(body: ShapeBody, node: string, trail: readonly Crossing[]): string | null {
  const seen = new Set([node]);
  let level = [node];
  while (level.length > 0) {
    for (const id of level) {
      const n = nodeOf(body, id);
      if (n?.kind === "offer") return n.offer;
    }
    const next: string[] = [];
    for (const id of level) {
      for (const e of body.edges) {
        if (e.kind !== "flow" || e.from !== id || seen.has(e.to)) continue;
        seen.add(e.to);
        next.push(e.to);
      }
    }
    level = next;
  }
  for (const c of [...trail].reverse()) {
    const n = nodeOf(body, c.to);
    if (n?.kind === "offer") return n.offer;
  }
  return null;
}

/** A cause's facts less the entry it names. */
const unnamed = (f: CauseFacts): CauseFacts => {
  const { entry: _entry, ...rest } = f;
  return rest;
};

/** The two steps, to register by name in the executor's `steps`. */
export function journeySteps(d: JourneyStepDeps): Record<string, Step> {
  const now = () => d.now?.() ?? new Date();

  const move: Step = async (port, e, at) => {
    const db = d.db(at.client);
    const flow = parseShapeFlow(at.workflow);
    const to = textOf(at.with.to);
    if (!flow || !to) return [];
    const loaded = await versionOf(db, flow.version);
    if (!loaded) return [];
    const { body } = loaded;
    const target = nodeOf(body, to);
    if (!target || target.kind === "source") return [];
    const profile = await personOf(db, e.data);
    if (profile === null) return [];
    const cause = causeOf(e, now());
    const facts = factsOf(e.data);
    // A form's own touches: the page it came from and the visitor's first touch.
    const seen = attributionOf(e.data);
    // The row that added the person to a sourced list.
    const row = textOf(e.data.row);
    const stamp = now().toISOString();
    const forced = isRecord(e.data.forced) ? textOf(e.data.forced.reason) : undefined;
    const loop = isRecord(e.data.loop)
      ? { journey: textOf(e.data.loop.journey), edge: textOf(e.data.loop.edge) }
      : null;

    const done = await atomic(db, async (tx) => {
      const j = await openJourney(tx, profile);
      if (loop) {
        // A loop edge: close the journey it left and open a new one at `to`.
        if (!loop.journey || !loop.edge || flow.version !== loaded.newest) return null;
        const [old] = await tx.select().from(instances).where(eq(instances.id, loop.journey));
        const edge = body.edges.find((x) => x.id === loop.edge && x.kind === "loop");
        if (!old || old.profileId !== profile || old.version !== flow.version || !old.node)
          return null;
        if (!edge || edge.from !== old.node || edge.to !== to) return null;
        if (j && j.id !== old.id) return null;
        if (old.status === "open") {
          await tx
            .update(instances)
            .set({ status: "dropped", dropReason: `loop ${edge.id}`, closedAt: now() })
            .where(eq(instances.id, old.id));
        } else if (old.status === "done") {
          return null;
        }
        const crossing: Crossing = { edge: edge.id, from: old.node, to, at: stamp };
        const [made] = await tx
          .insert(instances)
          .values({
            profileId: profile,
            version: flow.version,
            node: to,
            trail: [crossing],
            entry: old.entry,
            owner: old.owner,
            entryRef: { subject: e.subject, cause, loop: old.id },
            openedAt: now(),
            movedAt: now(),
          })
          .returning();
        if (!made) return null;
        return {
          journey: made.id,
          from: old.node,
          edges: [edge.id],
          skipped: [] as string[],
          loop: { journey: old.id, node: old.node, edge: edge.id },
        };
      }
      if (j) {
        // Another version owns this journey: its own node moves it.
        if (j.version !== flow.version || j.node === null) return null;
        if (j.node === to) {
          // A repeat of a move that crashed before it was kept. Say it again from its last
          // crossings (they share one time); the stage node refuses a second arrival.
          const last = j.trail.at(-1);
          const same = j.trail.filter((c) => c.at === last?.at);
          return {
            journey: j.id,
            from: same[0]?.from ?? null,
            edges: same.flatMap((c) => (c.edge ? [c.edge] : [])),
            skipped: same.slice(0, -1).map((c) => c.to),
          };
        }
        // Never twice at one node: a trail that holds `to` means the move goes back.
        if (j.trail.some((c) => c.to === to)) return null;
        const path = pathOf(body, j.node, to, { loops: false });
        let crossings: Crossing[];
        let edges: string[];
        let skipped: string[];
        if (path) {
          crossings = edgesOf(body, path).map((x) => ({
            edge: x.id,
            from: x.from,
            to: x.to,
            at: stamp,
          }));
          edges = path;
          skipped = passedThrough(body, path);
        } else if (forced) {
          crossings = [{ edge: null, from: j.node, to, at: stamp }];
          edges = [];
          skipped = [];
        } else {
          return null;
        }
        await tx
          .update(instances)
          .set({ node: to, trail: [...j.trail, ...crossings], movedAt: now() })
          .where(eq(instances.id, j.id));
        return { journey: j.id, from: j.node, edges, skipped };
      }
      // Only the newest version opens journeys, and only from a cause a source into `to` takes.
      if (flow.version !== loaded.newest) return null;
      if (!opensAt(body, to, port === JOURNEY_PORT, facts)) return null;
      const [touch] = await tx
        .select({ channel: profileRollups.firstChannel })
        .from(profileRollups)
        .where(eq(profileRollups.profileId, profile))
        .limit(1);
      // Where the person came from: what the cause names, else what its page says. A paid touch
      // adds the ad campaign's id. The first touch is the visitor's own, else the rollup's channel.
      const came = await withAdCampaign(tx, { ...seen.cause, ...facts });
      const first = seen.first ? await withAdCampaign(tx, seen.first) : null;
      // A named source with no edge to `to` cannot open it: choose as if none were named.
      const named = came.entry && sourceEdge(body, came.entry, to) ? came : unnamed(came);
      const src = entryOf(
        body,
        named,
        first ?? (touch?.channel ? { channel: touch.channel } : null),
        to,
      );
      const edge = src ? sourceEdge(body, src.id, to) : undefined;
      const crossing: Crossing = {
        edge: edge?.id ?? null,
        from: src?.id ?? null,
        to,
        at: stamp,
      };
      const [made] = await tx
        .insert(instances)
        .values({
          profileId: profile,
          version: flow.version,
          node: to,
          trail: [crossing],
          entry: src?.id ?? MANUAL,
          // A hand open is the opener's to work until someone else takes it.
          owner: cause.kind === "manual" ? ownerOf(cause.ref) : null,
          entryRef: {
            subject: e.subject,
            cause,
            ...came,
            ...(first ? { first } : {}),
            ...(row ? { row } : {}),
          },
          openedAt: now(),
          movedAt: now(),
        })
        .returning();
      if (!made) return null;
      return {
        journey: made.id,
        from: null,
        edges: edge ? [edge.id] : [],
        skipped: [] as string[],
      };
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
            version: flow.version,
            from: done.from,
            to,
            edges: done.edges,
            skipped: done.skipped,
            ...(forced && done.edges.length === 0 && done.from
              ? { forced: { reason: forced } }
              : {}),
            ...("loop" in done && done.loop ? { loop: done.loop } : {}),
            cause,
          },
        },
      },
    ];
  };

  const stage: Step = async (_port, e, at) => {
    const db = d.db(at.client);
    const flow = parseShapeFlow(at.workflow);
    const key = textOf(at.with.node);
    const journey = textOf(e.data.journey);
    if (!flow || !key || !journey) return [];
    const profile = Number(e.data.profile);
    const version = Number(e.data.version) || flow.version;
    const loaded = await versionOf(db, version);
    if (!loaded || !Number.isInteger(profile)) return [];
    const { body } = loaded;
    const dropped = key === DROPPED;
    const where = dropped ? textOf(e.data.node) : key;
    const node = where ? nodeOf(body, where) : undefined;
    const label = node?.name ?? where ?? key;
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
      if (dropped || !node) return "none" as const;
      // A node with no way on ends the journey; it never reopens.
      if (isEnd(body, key)) {
        await tx
          .update(instances)
          .set({ status: "done", closedAt: now() })
          .where(eq(instances.id, journey));
      }
      if (node.kind !== "offer") return "none" as const;
      const [offer] = await tx
        .select({ number: offerVersions.number })
        .from(offerVersions)
        .where(eq(offerVersions.offer, node.offer))
        .orderBy(desc(offerVersions.number))
        .limit(1);
      if (!offer) return "no-offer" as const;
      await tx
        .insert(pipelineDeals)
        .values({
          journey,
          node: node.id,
          profileId: profile,
          offer: node.offer,
          offerVersion: offer.number,
          signedAt: now(),
        })
        .onConflictDoNothing();
      return "deal" as const;
    });
    if (made === "no-offer" && node?.kind === "offer")
      console.warn(`journey ${journey}: no offer version for ${node.offer}, so no deal yet`);

    // Reaching a plan node signs the journey's deal under the plan's terms.
    if (!dropped && node?.kind === "plan") {
      try {
        const [deal] = await db
          .select()
          .from(pipelineDeals)
          .where(eq(pipelineDeals.journey, journey))
          .orderBy(desc(pipelineDeals.signedAt))
          .limit(1);
        if (!deal) {
          console.warn(`journey ${journey}: no deal to sign at ${key}`);
        } else if (deal.termsVersion === null) {
          if (await liveTerms(db, deal.offer, node.terms, now()))
            await signDeal(db, { deal: deal.id, plan: node.terms, now: now() });
          else console.warn(`journey ${journey}: no live ${node.terms} terms for ${deal.offer}`);
        }
      } catch (err) {
        console.warn(`journey ${journey}: signing at ${key} failed: ${String(err)}`);
      }
    }

    const level =
      node && (node.kind === "step" || node.kind === "offer") ? node.research : undefined;
    if (d.researcher && !dropped && (level === "light" || level === "full")) {
      // Never blocks the arrival: a failed ask is logged and the journey goes on.
      try {
        const trail = await db
          .select({ trail: instances.trail })
          .from(instances)
          .where(eq(instances.id, journey))
          .limit(1);
        const offer = offerFor(body, key, trail[0]?.trail ?? []);
        if (offer) {
          await requestResearch(
            db,
            d.researcher,
            {
              client: at.client,
              profile,
              journey,
              stage: key,
              level,
              offer,
              icp: await icpOf(db, offer),
            },
            now(),
          );
        } else {
          console.warn(`journey ${journey}: no offer for the research at ${key}`);
        }
      } catch (err) {
        console.warn(`journey ${journey}: research at ${key} failed: ${String(err)}`);
      }
    }

    const told = (id: string, kind: "entered" | "skipped" | "dropped", about = journey) =>
      at.fire?.({
        facts: {
          trigger: "trigger.journey",
          node: id,
          change: kind,
          // Entering an offer node wins a deal: webhooks hear `deal.won` as well as the move.
          ...(kind === "entered" && nodeOf(body, id)?.kind === "offer"
            ? { sale: true as const }
            : {}),
        },
        event: {
          subject: `journey:${about}`,
          kind: "journey",
          // To a workflow that hears it, the cause is this journey.
          data: {
            journey: about,
            profile,
            node: id,
            // Webhooks heard `stage` before the shape; it is the node id for one more release.
            stage: id,
            version,
            change: kind,
            cause: { kind: "funnel", ref: about, at: now().toISOString() },
          },
        },
      });
    if (dropped) {
      if (where) told(where, "dropped");
    } else {
      told(key, change);
      for (const s of skipped) told(s, "skipped");
      // A loop reopen: the journey it closed drops as well.
      const looped = isRecord(e.data.loop) ? e.data.loop : null;
      const old = looped ? textOf(looped.journey) : undefined;
      const oldNode = looped ? textOf(looped.node) : undefined;
      if (old && oldNode) {
        await db
          .insert(profileEvents)
          .values({
            profileId: profile,
            kind: "journey",
            channel: "journey",
            at: now(),
            summary: `Dropped from ${body.name} at ${nodeOf(body, oldNode)?.name ?? oldNode}`,
            body: `loop ${textOf(looped?.edge) ?? ""}`.trim(),
            source: "journeys",
            sourceId: lineId(old, DROPPED),
          })
          .onConflictDoNothing();
        told(oldNode, "dropped", old);
      }
    }
    return [];
  };

  return { [MOVE_STEP]: move, [STAGE_STEP]: stage };
}
