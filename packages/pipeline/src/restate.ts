/**
 * `Journeys`: the hand and agent moves on a journey (designs/2026-10-19-business-map.md). `open`
 * and `move` send the shape workflow's `in.<node>` input through `Spine/emit`, cause `manual`,
 * so the workflow's own `journey.move` step writes the row: no second write path. `drop` closes the row (`dropJourney`) and tells the spine. `assign` sets who
 * works a journey, a column the spine never reads. `rebuild` recomputes a row from its events.
 *
 * `client` is the workspace: null is Wren's. `by` is the operator, kept as the cause's `ref`.
 */
import * as restate from "@restatedev/restate-sdk";
import { serviceHandler } from "@wren/core/restate";
import { SPINE, type SpineService } from "@wren/core/spine";
import type { Db } from "@wren/db";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { dropJourney } from "./journeys.js";
import {
  assignJourney,
  type Emit,
  idOf,
  moveEmit,
  openEmit,
  personByKey,
  rebuildJourney,
} from "./moves.js";
import { journeys } from "./schema.js";
import { Refused } from "./store.js";

export const JOURNEYS = { name: "Journeys" } as const;

interface JourneysDeps {
  /** A workspace's database: Wren's for `null`. */
  db(client: string | null): Db;
}

const WHO = {
  client: z.string().nullish().describe("The client's id; left out is Wren's own workspace"),
  by: z.string().min(1).describe("The operator, as an email or a name"),
};

export interface OpenRequest {
  client?: string | null;
  /** A profile id, an email, a phone (+...) or kind:value. */
  person: string;
  /** A node a live source feeds; the first when left out. */
  at?: string;
  /** A source node id, to name how they came; found from their first touch when left out. */
  entry?: string;
  by: string;
}
export interface MoveRequest {
  client?: string | null;
  journey: string;
  /** A node id of the journey's shape version. */
  to: string;
  by: string;
  /** Why, when no edge path leads there: the move is forced. */
  reason?: string;
}
export interface DropRequest {
  client?: string | null;
  journey: string;
  reason: string;
  by: string;
}
export interface AssignRequest {
  client?: string | null;
  journey: string;
  /** A team member's email; null (or left out) gives it to nobody. */
  to?: string | null;
  by: string;
}
export interface RebuildRequest {
  client?: string | null;
  journey: string;
}

export type JourneysApi = {
  open: (ctx: restate.Context, req: OpenRequest) => Promise<{ journey: string; node: string }>;
  move: (
    ctx: restate.Context,
    req: MoveRequest,
  ) => Promise<{ journey: string; from: string; to: string; status: string }>;
  drop: (ctx: restate.Context, req: DropRequest) => Promise<{ journey: string; node: string }>;
  assign: (
    ctx: restate.Context,
    req: AssignRequest,
  ) => Promise<{ journey: string; owner: string | null }>;
  rebuild: (ctx: restate.Context, req: RebuildRequest) => Promise<unknown>;
};

/** A refusal is final: Restate must not retry it. */
const run = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Refused) throw new restate.TerminalError(err.message, { errorCode: 400 });
    throw err;
  }
};

export function makeJourneys(deps: JourneysDeps) {
  const emit = (ctx: restate.Context, client: string | null, e: Emit) =>
    ctx.serviceClient<SpineService>(SPINE).emit({ client, ...e });
  const fail = (msg: string): never => {
    throw new restate.TerminalError(msg, { errorCode: 400 });
  };

  return restate.service({
    name: JOURNEYS.name,
    handlers: {
      open: serviceHandler(
        {
          input: z.looseObject({
            ...WHO,
            person: z.string().describe("A profile id, an email, a phone (+...) or kind:value"),
            at: z.string().optional().describe("A node a live source feeds; the first if left out"),
            entry: z.string().optional().describe("A source node id"),
          }),
        },
        async (ctx: restate.Context, req: OpenRequest) => {
          const client = req.client ?? null;
          const db = deps.db(client);
          const e = await ctx.run("open", () => run(() => openEmit(db, req)));
          await emit(ctx, client, e);
          const done = await ctx.run("read", async () => {
            const profile = await personByKey(db, req.person);
            if (profile === null) return null;
            const [j] = await db
              .select({ id: journeys.id, node: journeys.node })
              .from(journeys)
              .where(and(eq(journeys.profileId, profile), eq(journeys.status, "open")))
              .limit(1);
            return j ?? null;
          });
          if (!done?.node)
            return fail("Nothing opened. The shape did not take the person at that node.");
          return { journey: done.id, node: done.node };
        },
      ),
      move: serviceHandler(
        {
          input: z.looseObject({
            ...WHO,
            journey: z.string().describe("The journey's id"),
            to: z.string().describe("A node id of its shape version"),
            reason: z.string().optional().describe("Why, when no edge path leads there"),
          }),
        },
        async (ctx: restate.Context, req: MoveRequest) => {
          const client = req.client ?? null;
          const db = deps.db(client);
          const plan = await ctx.run("move", () =>
            run(async () => {
              const { journey, ...e } = await moveEmit(db, req);
              return { was: journey.node, ...e };
            }),
          );
          const { was, ...e } = plan;
          await emit(ctx, client, e);
          const now = await ctx.run("read", async () => {
            const [j] = await db
              .select({ node: journeys.node, status: journeys.status })
              .from(journeys)
              .where(eq(journeys.id, req.journey))
              .limit(1);
            // A loop closes the journey and opens its successor: the answer is the new one.
            const [next] = await db
              .select({ id: journeys.id, status: journeys.status })
              .from(journeys)
              .where(sql`${journeys.entryRef}->>'loop' = ${req.journey}`)
              .limit(1);
            return j ? { ...j, next: next ?? null } : null;
          });
          if (now?.next)
            return { journey: now.next.id, from: was, to: req.to, status: now.next.status };
          if (!now || (now.node !== req.to && now.status === "open"))
            return fail("Nothing moved. The shape did not take that move.");
          return { journey: req.journey, from: was, to: req.to, status: now.status };
        },
      ),
      drop: serviceHandler(
        {
          input: z.looseObject({
            ...WHO,
            journey: z.string().describe("The journey's id"),
            reason: z.string().min(1).describe("Why it ends here"),
          }),
        },
        async (ctx: restate.Context, req: DropRequest) => {
          const client = req.client ?? null;
          const dropped = await ctx.run("drop", () =>
            run(async () => {
              const out = await dropJourney(deps.db(client), {
                journey: idOf(req.journey, "journey"),
                reason: req.reason,
                by: req.by,
              });
              if (!out) throw new Refused(["That journey is not open."]);
              return out;
            }),
          );
          await emit(ctx, client, dropped);
          return { journey: req.journey, node: String(dropped.events[0]?.data.node ?? "") };
        },
      ),
      assign: serviceHandler(
        {
          input: z.looseObject({
            ...WHO,
            journey: z.string().describe("The journey's id"),
            to: z
              .string()
              .nullish()
              .describe("A team member's email; left out or null clears the owner"),
          }),
        },
        (ctx: restate.Context, req: AssignRequest) =>
          ctx.run("assign", () =>
            run(() =>
              assignJourney(deps.db(req.client ?? null), deps.db(null), {
                client: req.client ?? null,
                journey: req.journey,
                to: req.to ?? null,
              }),
            ),
          ),
      ),
      rebuild: serviceHandler(
        {
          input: z.looseObject({
            client: WHO.client,
            journey: z.string().describe("The journey's id"),
          }),
        },
        (ctx: restate.Context, req: RebuildRequest) =>
          ctx.run("rebuild", () =>
            run(() => rebuildJourney(deps.db(req.client ?? null), req.journey)),
          ),
      ),
    },
  });
}
export type JourneysService = ReturnType<typeof makeJourneys>;
