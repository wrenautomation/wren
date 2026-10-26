/**
 * Limits over the code's defaults (designs/2026-10-26-limits.md). Code names each limit and its
 * default (`LimitDef`); the `limits` table in main overrides one limit at a time. A row with no
 * client is Wren-wide: the new default for Wren and every client. A client's row holds for that
 * client alone, and only where the spend is the client's own (`scope: "client"`). A limit on a
 * pool every client shares, or on a part only Wren runs, takes the Wren-wide row only.
 */
import type { Db, Queryable } from "@wren/db";
import { and, eq, isNull, or } from "drizzle-orm";
import type { Bucket } from "./buckets.js";
import { limits } from "./limits-schema.js";

/**
 * `client`: spent in each client's own database, so a client may have its own.
 * `shared`: one pool for Wren and every client. `wren`: only Wren runs it.
 */
export type LimitScope = "client" | "shared" | "wren";

export interface LimitDef {
  /** `<area>.<part>`: `research.triggers`. */
  name: string;
  /** What one unit is, for a person: "news searches". */
  unit: string;
  /** Why the default is what it is: the outside cap it sits under. */
  why: string;
  perDay: number;
  /** The most spent at once; null for a daily count (`googleLeft`). */
  burst: number | null;
  scope: LimitScope;
}

export interface Limit {
  perDay: number;
  burst: number | null;
}

export type LimitSource = "default" | "wren" | "client";

/** One limit as it holds for one owner, and where each value comes from. */
export interface LimitView {
  def: LimitDef;
  wren: Limit | null;
  client: Limit | null;
  holds: Limit;
  from: LimitSource;
}

const limitOfRow = (r: { perDay: number; burst: number | null }): Limit => ({
  perDay: r.perDay,
  burst: r.burst,
});

function holds(def: LimitDef, wren: Limit | null, client: Limit | null) {
  if (client && def.scope === "client") return { holds: client, from: "client" as const };
  if (wren) return { holds: wren, from: "wren" as const };
  return { holds: { perDay: def.perDay, burst: def.burst }, from: "default" as const };
}

/** The limit that holds for `client` (null: Wren). */
export async function limitOf(
  main: Queryable,
  client: string | null,
  def: LimitDef,
): Promise<Limit> {
  const rows = await main
    .select({ client: limits.client, perDay: limits.perDay, burst: limits.burst })
    .from(limits)
    .where(
      and(
        eq(limits.name, def.name),
        client === null
          ? isNull(limits.client)
          : or(isNull(limits.client), eq(limits.client, client)),
      ),
    );
  const wren = rows.find((r) => r.client === null);
  const own = rows.find((r) => r.client !== null);
  return holds(def, wren ? limitOfRow(wren) : null, own ? limitOfRow(own) : null).holds;
}

/** A token bucket's limit for `client`. */
export async function bucketOf(
  main: Queryable,
  client: string | null,
  def: LimitDef,
): Promise<Bucket> {
  const l = await limitOf(main, client, def);
  return { perDay: l.perDay, burst: l.burst ?? l.perDay };
}

/** Every limit as it holds for `client` (null: Wren-wide), in the order of `defs`. */
export async function limitsView(
  main: Queryable,
  client: string | null,
  defs: readonly LimitDef[],
): Promise<LimitView[]> {
  const rows = await main
    .select({
      client: limits.client,
      name: limits.name,
      perDay: limits.perDay,
      burst: limits.burst,
    })
    .from(limits)
    .where(
      client === null
        ? isNull(limits.client)
        : or(isNull(limits.client), eq(limits.client, client)),
    );
  return defs.map((def) => {
    const w = rows.find((r) => r.name === def.name && r.client === null);
    const c = rows.find((r) => r.name === def.name && r.client !== null);
    const wren = w ? limitOfRow(w) : null;
    const own = c ? limitOfRow(c) : null;
    return { def, wren, client: own, ...holds(def, wren, own) };
  });
}

const limitDef = (defs: readonly LimitDef[], name: string): LimitDef => {
  const def = defs.find((d) => d.name === name);
  if (!def) throw new Error(`no limit named ${name}`);
  return def;
};

function checkOwner(def: LimitDef, client: string | null) {
  if (client === null || def.scope === "client") return;
  throw new Error(
    def.scope === "shared"
      ? `${def.name} is one pool for Wren and every client: set it Wren-wide`
      : `${def.name} runs for Wren only: set it Wren-wide`,
  );
}

/**
 * Set one limit for `client` (null: Wren-wide). A bucket with no `burst` keeps the default's
 * share of a day; a daily count takes none.
 */
export async function setLimit(
  main: Db,
  defs: readonly LimitDef[],
  o: { client: string | null; name: string; perDay: number; burst?: number | null; by: string },
): Promise<{ before: Limit | null; after: Limit }> {
  const def = limitDef(defs, o.name);
  checkOwner(def, o.client);
  if (!Number.isInteger(o.perDay) || o.perDay < 0)
    throw new Error("a day: a whole number, 0 or more");
  if (def.burst === null && o.burst != null)
    throw new Error(`${def.name} is a daily count: no burst`);
  const burst =
    def.burst === null
      ? null
      : (o.burst ??
        Math.max(1, Math.min(o.perDay, Math.round((def.burst / def.perDay) * o.perDay))));
  if (burst !== null && (!Number.isInteger(burst) || burst < 1))
    throw new Error("burst: a whole number, 1 or more");
  const before = await ownRow(main, o.client, def.name);
  await main
    .insert(limits)
    .values({ client: o.client, name: def.name, perDay: o.perDay, burst, updatedBy: o.by })
    .onConflictDoUpdate({
      target: [limits.client, limits.name],
      set: { perDay: o.perDay, burst, updatedBy: o.by, updatedAt: new Date() },
    });
  return { before, after: { perDay: o.perDay, burst } };
}

/** Drop one limit's row: `client`'s own, or the Wren-wide one (null). */
export async function unsetLimit(
  main: Db,
  defs: readonly LimitDef[],
  o: { client: string | null; name: string },
): Promise<{ before: Limit | null }> {
  const def = limitDef(defs, o.name);
  checkOwner(def, o.client);
  const before = await ownRow(main, o.client, def.name);
  await main.delete(limits).where(and(eq(limits.name, def.name), ownerIs(o.client)));
  return { before };
}

const ownerIs = (client: string | null) =>
  client === null ? isNull(limits.client) : eq(limits.client, client);

async function ownRow(main: Queryable, client: string | null, name: string): Promise<Limit | null> {
  const [r] = await main
    .select({ perDay: limits.perDay, burst: limits.burst })
    .from(limits)
    .where(and(eq(limits.name, name), ownerIs(client)));
  return r ? limitOfRow(r) : null;
}
