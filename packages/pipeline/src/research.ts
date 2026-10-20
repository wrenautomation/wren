/**
 * Research on arrival (designs/2026-10-19-business-map.md, `StepNode.research`). A journey that reaches
 * a node with `light` or `full` asks once for research on its person, against the offer's `icp`.
 * One `journey_research` row per journey and node is the claim: a repeat of the step finds it and
 * asks nothing new, except to start a `full` run that was queued but not yet started.
 *
 * The reads are injected (`Researcher`), so this package imports nothing of @wren/research. The
 * worker supplies them from the existing research code. Free sources only: `light` reads what the
 * workspace already holds; `full` is the person-research run that exists today.
 *
 * `light` also scores the person's fit to the offer's ICP (`icp.ts`): the structured fields in code
 * with the read, then, when the worker injects a model, the plain-word rules, after the read has
 * committed. The score lands in `result.fit`. A model that fails leaves the code score.
 */
import { createHash } from "node:crypto";
import { profileEvents } from "@wren/core/profiles-schema";
import { atomic, type Db, type Queryable } from "@wren/db";
import type { Icp } from "@wren/offers";
import { and, desc, eq, sql } from "drizzle-orm";
import { type Fit, type FitModel, type FitTraits, needsModel, scoreFit } from "./icp.js";
import { journeyResearch, offerVersions } from "./schema.js";

export type { Fit, FitModel, FitTraits } from "./icp.js";

export type ResearchLevel = "light" | "full";

/** What a researcher is asked, once per journey and node. */
export interface ResearchAsk {
  /** The workspace: null for Wren's own. */
  client: string | null;
  profile: number;
  journey: string;
  /** The node id. The column keeps its old name, `stage`. */
  stage: string;
  level: ResearchLevel;
  offer: string;
  /** The offer's ideal customer profile, as context. Null when the offer has none. */
  icp: Icp | null;
}

/** How a `full` run was handed on. */
export interface Started {
  state: "started" | "skipped";
  /** The run's `profile_lookups` row. */
  lookupId?: number;
  /** Why it was skipped. */
  note?: string;
}

/** What `light` returns: the reads, and the `traits` they gathered for the fit score. */
export type LightRead = Record<string, unknown> & { traits?: FitTraits };

export interface Researcher {
  /** Free reads of what the workspace already holds. No network. */
  light(db: Queryable, ask: ResearchAsk): Promise<LightRead>;
  /** Queues and starts the long run, without waiting for it. Never blocks the node. */
  full(ask: ResearchAsk): Promise<Started>;
  /** Judges the ICP's plain-word rules (`who`, `must`, `not`). Null or absent: those stay unknown. */
  model?: FitModel | null;
}

const lineOf = (journey: string, stage: string) =>
  createHash("sha256").update(`${journey}:research:${stage}`).digest("hex").slice(0, 40);

/** The newest version of the offer's ICP, or null. */
export async function icpOf(db: Queryable, offer: string): Promise<Icp | null> {
  const [v] = await db
    .select({ body: offerVersions.body })
    .from(offerVersions)
    .where(eq(offerVersions.offer, offer))
    .orderBy(desc(offerVersions.number))
    .limit(1);
  return v?.body?.icp ?? null;
}

const SUMMARY = {
  read: "Research read",
  queued: "Research asked",
  started: "Research started",
  skipped: "Research skipped",
} as const;

/**
 * Ask for the node's research, once. Returns what was asked now: `none` for a repeat.
 * A failure of the long run never stops the journey; the row stays `queued` for the next repeat.
 */
export async function requestResearch(
  db: Db,
  researcher: Researcher,
  ask: ResearchAsk,
  now: Date,
): Promise<"light" | "full" | "none"> {
  const claim = await atomic(db, async (tx) => {
    const [made] = await tx
      .insert(journeyResearch)
      .values({
        journey: ask.journey,
        stage: ask.stage,
        profileId: ask.profile,
        level: ask.level,
        icp: ask.icp,
        requestedAt: now,
      })
      .onConflictDoNothing()
      .returning({ journey: journeyResearch.journey });
    if (!made) {
      const [had] = await tx
        .select({ state: journeyResearch.state })
        .from(journeyResearch)
        .where(and(eq(journeyResearch.journey, ask.journey), eq(journeyResearch.stage, ask.stage)));
      return { fresh: false, queued: had?.state === "queued" };
    }
    const read = ask.level === "light" ? await researcher.light(tx, ask) : null;
    // The code part of the fit: pure, no network, so it stays inside the claim.
    const fit = read && ask.icp ? await scoreFit(ask.icp, read.traits ?? {}) : null;
    const result = read ? { ...read, ...(fit ? { fit } : {}) } : null;
    const state = ask.level === "light" ? "read" : "queued";
    if (result) {
      await tx
        .update(journeyResearch)
        .set({ state, result })
        .where(and(eq(journeyResearch.journey, ask.journey), eq(journeyResearch.stage, ask.stage)));
    }
    await tx
      .insert(profileEvents)
      .values({
        profileId: ask.profile,
        kind: "journey",
        channel: "journey",
        at: now,
        summary: `${SUMMARY[state]} (${ask.level}) at ${ask.stage}`,
        source: "journeys",
        sourceId: lineOf(ask.journey, ask.stage),
      })
      .onConflictDoNothing();
    return { fresh: true, queued: state === "queued", traits: read?.traits ?? {} };
  });
  // The model judges the plain-word rules after the claim. The step does not wait for it.
  if (claim.fresh && ask.level === "light" && ask.icp && researcher.model && needsModel(ask.icp)) {
    void refineFit(db, researcher.model, ask, ask.icp, claim.traits ?? {});
  }
  if (!claim.queued) return claim.fresh ? "light" : "none";

  try {
    const out = await researcher.full(ask);
    await db
      .update(journeyResearch)
      .set({ state: out.state, lookupId: out.lookupId ?? null, note: out.note ?? null })
      .where(and(eq(journeyResearch.journey, ask.journey), eq(journeyResearch.stage, ask.stage)));
  } catch (err) {
    console.warn(`journey ${ask.journey}: research at ${ask.stage} not started: ${String(err)}`);
  }
  return "full";
}

/**
 * Asks the model about the plain-word rules and stores the fuller score in the row's
 * `result.fit`. Never throws: a model error keeps the code score (and its reason), a failed write
 * is logged. The row's other reads stay as they were.
 */
export async function refineFit(
  db: Db,
  model: FitModel,
  ask: Pick<ResearchAsk, "journey" | "stage">,
  icp: Icp,
  traits: FitTraits,
): Promise<Fit | null> {
  try {
    const fit = await scoreFit(icp, traits, model);
    await db
      .update(journeyResearch)
      .set({
        result: sql`coalesce(${journeyResearch.result}, '{}'::jsonb) || ${JSON.stringify({ fit })}::jsonb`,
      })
      .where(and(eq(journeyResearch.journey, ask.journey), eq(journeyResearch.stage, ask.stage)));
    return fit;
  } catch (err) {
    console.warn(`journey ${ask.journey}: fit at ${ask.stage} not refined: ${String(err)}`);
    return null;
  }
}
