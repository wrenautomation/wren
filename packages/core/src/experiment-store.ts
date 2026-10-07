/**
 * Experiments in the database (designs/2026-10-06-flags-experiments-surveys-heatmaps.md §3): a
 * site flag with a goal, the `marketing.experiment` record, and its buttons. Starting one puts
 * it live on the public site, so Start and Ship are William's (`manage` at Wren). SearchWatch
 * rolls up `flag_days` and moves the shares (`@wren/channel-search` experiments); the edge serves
 * them in place of the flag's rules (`./flag-store.ts` pushEdge).
 */
import type { Queryable } from "@wren/db";
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { type EdgePush, pushEdge } from "./flag-store.js";
import { EXPERIMENT_GOALS, type ExperimentGoal } from "./flags.js";
import { PortalRefusal } from "./portal.js";
import {
  date,
  defineRecord,
  number,
  prose,
  type RecordType,
  type State,
  status,
  text,
} from "./records.js";
import { type FlagExperiment, flagDays, flagExperiments, flags } from "./schema.js";

export const EXPERIMENT = "marketing.experiment";

const ExperimentIn = z.object({
  flag: z.string().trim().min(1, "say which flag"),
  goal: z.enum(EXPERIMENT_GOALS).default("forms"),
});
export type ExperimentInput = z.input<typeof ExperimentIn>;

/** A variant's visitors and what they went on to, since the experiment started. */
export interface VariantCounts {
  variant: string;
  visitors: number;
  forms: number;
  calls: number;
  paid: number;
}

/** A new experiment, in draft: nothing changes on the site until Start. */
export async function addExperiment(
  db: Queryable,
  input: ExperimentInput,
  by: string,
): Promise<{ flag: string }> {
  const got = ExperimentIn.safeParse(input);
  if (!got.success) throw new PortalRefusal(got.error.issues[0]?.message ?? "check it", 400);
  const [f] = await db.select().from(flags).where(eq(flags.key, got.data.flag)).limit(1);
  if (!f) throw new PortalRefusal(`no flag ${got.data.flag}`, 404);
  if (f.surface === "portal")
    throw new PortalRefusal("an experiment runs on the site: set the flag to Site or Both", 400);
  const [row] = await db
    .insert(flagExperiments)
    .values({ flag: f.key, goal: got.data.goal, createdBy: by })
    .onConflictDoNothing()
    .returning({ flag: flagExperiments.flag });
  if (!row) throw new PortalRefusal(`${f.key} already has an experiment`, 409);
  return row;
}

const even = (variants: readonly string[]) =>
  Object.fromEntries(variants.map((v) => [v, 1 / variants.length]));

/** Draft or stopped → running, every variant an even share. William's yes. */
export async function startExperiments(
  db: Queryable,
  keys: readonly string[],
  by: string,
  push?: EdgePush,
): Promise<string[]> {
  const rows = await db
    .select({ flag: flagExperiments.flag, variants: flags.variants })
    .from(flagExperiments)
    .innerJoin(flags, eq(flags.key, flagExperiments.flag))
    .where(
      and(
        inArray(flagExperiments.flag, [...keys]),
        inArray(flagExperiments.state, ["draft", "stopped"]),
      ),
    );
  const now = new Date();
  for (const r of rows)
    await db
      .update(flagExperiments)
      .set({
        state: "running",
        shares: even(r.variants),
        pBest: {},
        retired: [],
        best: null,
        winner: null,
        startedAt: now,
        startedBy: by,
        endedAt: null,
        endedBy: null,
        updatedAt: now,
      })
      .where(eq(flagExperiments.flag, r.flag));
  if (rows.length) await pushEdge(db, push);
  return rows.map((r) => r.flag);
}

/** Running or settled → shipped: the flag goes to the winner for everyone. William's yes. */
export async function shipExperiments(
  db: Queryable,
  keys: readonly string[],
  by: string,
  push?: EdgePush,
): Promise<string[]> {
  const rows = await db
    .select()
    .from(flagExperiments)
    .where(
      and(
        inArray(flagExperiments.flag, [...keys]),
        inArray(flagExperiments.state, ["running", "settled"]),
      ),
    );
  const now = new Date();
  const done: string[] = [];
  for (const e of rows) {
    const winner = e.best ?? leader(e.shares);
    if (!winner) continue;
    await db
      .update(flags)
      .set({ rules: [{ variant: winner }], killed: false, updatedAt: now })
      .where(eq(flags.key, e.flag));
    await db
      .update(flagExperiments)
      .set({ state: "shipped", winner, endedAt: now, endedBy: by, updatedAt: now })
      .where(eq(flagExperiments.flag, e.flag));
    done.push(e.flag);
  }
  if (done.length) await pushEdge(db, push);
  return done;
}

/** Running or settled → stopped: the flag's own rules again. */
export async function stopExperiments(
  db: Queryable,
  keys: readonly string[],
  by: string,
  push?: EdgePush,
): Promise<string[]> {
  const now = new Date();
  const done = await db
    .update(flagExperiments)
    .set({ state: "stopped", endedAt: now, endedBy: by, updatedAt: now })
    .where(
      and(
        inArray(flagExperiments.flag, [...keys]),
        inArray(flagExperiments.state, ["running", "settled"]),
      ),
    )
    .returning({ flag: flagExperiments.flag });
  if (done.length) await pushEdge(db, push);
  return done.map((d) => d.flag);
}

/** Removes experiments that aren't live; the flag and its days stay. */
export async function removeExperiments(db: Queryable, keys: readonly string[]): Promise<string[]> {
  const gone = await db
    .delete(flagExperiments)
    .where(
      and(
        inArray(flagExperiments.flag, [...keys]),
        inArray(flagExperiments.state, ["draft", "stopped", "shipped"]),
      ),
    )
    .returning({ flag: flagExperiments.flag });
  return gone.map((g) => g.flag);
}

const leader = (shares: Readonly<Record<string, number>>) =>
  Object.entries(shares).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

/** Each variant's counts from `flag_days`, every channel, from `since` (a day) on. */
export async function variantCounts(
  db: Queryable,
  flag: string,
  since: string | null,
): Promise<VariantCounts[]> {
  const rows = await db
    .select({
      variant: flagDays.variant,
      visitors: sql<number>`sum(${flagDays.visitors})::int`,
      forms: sql<number>`sum(${flagDays.forms})::int`,
      calls: sql<number>`sum(${flagDays.calls})::int`,
      paid: sql<number>`sum(${flagDays.paid})::int`,
    })
    .from(flagDays)
    .where(and(eq(flagDays.flag, flag), since ? gte(flagDays.day, since) : undefined))
    .groupBy(flagDays.variant)
    .orderBy(asc(flagDays.variant));
  return rows;
}

/** The experiments the bandit moves each pass. */
export const liveExperiments = (db: Queryable) =>
  db
    .select({ e: flagExperiments, variants: flags.variants })
    .from(flagExperiments)
    .innerJoin(flags, eq(flags.key, flagExperiments.flag))
    .where(eq(flagExperiments.state, "running"));

/** One pass's decision for one experiment. Settled holds its shares until Ship or Stop. */
export async function saveDecision(
  db: Queryable,
  flag: string,
  d: Pick<FlagExperiment, "shares" | "pBest" | "retired" | "best"> & { settled: boolean },
): Promise<void> {
  const now = new Date();
  await db
    .update(flagExperiments)
    .set({
      shares: d.shares,
      pBest: d.pBest,
      retired: d.retired,
      best: d.best,
      decidedAt: now,
      updatedAt: now,
      ...(d.settled ? { state: "settled" as const } : {}),
    })
    .where(and(eq(flagExperiments.flag, flag), eq(flagExperiments.state, "running")));
}

const GOAL: Record<ExperimentGoal, State> = {
  forms: { label: "Forms", tone: "neutral" },
  calls: { label: "Calls", tone: "neutral" },
  paid: { label: "Paid", tone: "neutral" },
};
const STATE: Record<FlagExperiment["state"], State> = {
  draft: { label: "Draft", tone: "neutral" },
  running: { label: "Running", tone: "good" },
  settled: { label: "Settled", tone: "good" },
  shipped: { label: "Shipped", tone: "neutral" },
  stopped: { label: "Stopped", tone: "warn" },
};

const pct = (n: number | undefined) => `${Math.round((n ?? 0) * 100)}%`;
const byVariant = (variants: readonly string[], m: Readonly<Record<string, number>>) =>
  variants.map((v) => `${v} ${pct(m[v])}`).join(" · ");

/** Experiments as records: shares, P(best) and each variant's funnel, with Start, Ship, Stop. */
export function experimentRecord(): RecordType {
  return defineRecord({
    id: EXPERIMENT,
    name: { one: "experiment", many: "experiments" },
    rows: async (db) => {
      const all = await db
        .select({ e: flagExperiments, about: flags.about, variants: flags.variants })
        .from(flagExperiments)
        .innerJoin(flags, eq(flags.key, flagExperiments.flag))
        .orderBy(asc(flagExperiments.flag));
      return Promise.all(
        all.map(async ({ e, about, variants }) => {
          const since = e.startedAt ? e.startedAt.toISOString().slice(0, 10) : null;
          const counts = await variantCounts(db, e.flag, since);
          const of = (v: string) => counts.find((c) => c.variant === v);
          const goals = counts.reduce((t, c) => t + c[e.goal], 0);
          return {
            id: e.flag,
            flag: e.flag,
            about,
            goal: e.goal,
            state: e.state,
            shares: e.state === "draft" ? "" : byVariant(variants, e.shares),
            p_best: Object.keys(e.pBest).length ? byVariant(variants, e.pBest) : "",
            best: e.winner ?? e.best ?? "",
            visitors: counts.reduce((t, c) => t + c.visitors, 0),
            goals,
            funnel: variants
              .map((v) => {
                const c = of(v);
                const out = e.retired.includes(v) ? " (dropped)" : "";
                return `${v}: ${c?.visitors ?? 0} visitors, ${c?.forms ?? 0} forms, ${c?.calls ?? 0} calls, ${c?.paid ?? 0} paid${out}`;
              })
              .join("\n"),
            started_at: e.startedAt?.toISOString() ?? null,
            updated_at: e.updatedAt.toISOString(),
          };
        }),
      );
    },
    key: "id",
    title: "flag",
    subtitle: "about",
    fields: {
      flag: text("Flag"),
      about: text("What it tests"),
      goal: status(GOAL, "Goal"),
      state: status(STATE, "State"),
      shares: text("Shares"),
      pBest: text("P(best)"),
      best: text("Best"),
      visitors: number("Visitors"),
      goals: number("Goals"),
      funnel: prose("Each variant"),
      startedAt: date("Started"),
      updatedAt: date("Changed"),
    },
    views: [
      { id: "all", label: "All", sort: "flag", at: "updatedAt" },
      { id: "running", label: "Running", where: { state: "running" }, sort: "flag" },
    ],
    actions: [
      "marketing.experimentAdd",
      "marketing.experimentStart",
      "marketing.experimentShip",
      "marketing.experimentStop",
      "marketing.experimentRemove",
    ],
  });
}

/** Upserts day rows (the whole history is re-read each pass). Returns rows written. */
export async function writeFlagDays(
  db: Queryable,
  rows: readonly Omit<typeof flagDays.$inferInsert, "syncedAt">[],
): Promise<number> {
  const x = (c: string) => sql.raw(`excluded.${c}`);
  for (let i = 0; i < rows.length; i += 1000)
    await db
      .insert(flagDays)
      .values(rows.slice(i, i + 1000))
      .onConflictDoUpdate({
        target: [flagDays.flag, flagDays.day, flagDays.variant, flagDays.channel],
        set: {
          visitors: x("visitors"),
          forms: x("forms"),
          calls: x("calls"),
          paid: x("paid"),
          syncedAt: sql`now()`,
        },
      });
  return rows.length;
}
