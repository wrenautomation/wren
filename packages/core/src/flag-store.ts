/**
 * Flags in the database (designs/2026-10-06-flags-experiments-surveys-heatmaps.md §2): the
 * `loops.flag` record with edits (History, Undo, Ask Claude), add and remove, evaluation for a
 * login, and the push of site flags to the lander's edge on every change. A running experiment's
 * shares stand in for its flag's rules there (`./experiment-store.ts`).
 */
import type { Queryable } from "@wren/db";
import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  evaluateFlags,
  type FlagDef,
  type FlagSubject,
  formatRules,
  parseRules,
  SURFACES,
  type Surface,
  shareRules,
} from "./flags.js";
import { PortalRefusal } from "./portal.js";
import {
  date,
  defineRecord,
  prose,
  type RecordType,
  status,
  text,
  type Values,
} from "./records.js";
import { flagExperiments, flags } from "./schema.js";

export const FLAG = "loops.flag";

/** Sends the lander every flag it reads, the whole set each time (lander `POST /api/edge`). */
export type EdgePush = (flags: readonly FlagDef[]) => Promise<void>;

const KEY = /^[a-z][a-z0-9_.-]{0,59}$/;
const VARIANT = /^[a-z][a-z0-9_-]{0,39}$/;

const variantsOf = (v: unknown): string[] =>
  (Array.isArray(v) ? v : String(v ?? "").split(",")).map((x) => String(x).trim()).filter(Boolean);

const FlagIn = z.object({
  key: z
    .string()
    .trim()
    .regex(KEY, "a key is lower case: letters, digits, dot, dash or underscore"),
  about: z.string().trim().max(500).default(""),
  surface: z.enum(SURFACES).default("portal"),
  /** Comma between each; on/off when left out. */
  variants: z.union([z.string(), z.array(z.string())]).optional(),
});
export type FlagInput = z.input<typeof FlagIn>;

const def = (r: typeof flags.$inferSelect): FlagDef & { surface: Surface } => ({
  key: r.key,
  variants: r.variants,
  rules: r.rules,
  fallback: r.fallback,
  killed: r.killed,
  surface: r.surface,
});

export async function flagDefs(db: Queryable): Promise<(FlagDef & { surface: Surface })[]> {
  return (await db.select().from(flags).orderBy(asc(flags.key))).map(def);
}

/** Every portal flag's variant for one login at one client. */
export async function flagsFor(db: Queryable, s: FlagSubject): Promise<Record<string, string>> {
  const all = await flagDefs(db);
  return evaluateFlags(
    all.filter((f) => f.surface !== "site"),
    s,
  );
}

/** Push the site's flags; a failed push is logged, never fails the change (the next one resends). */
export async function pushEdge(db: Queryable, push: EdgePush | undefined): Promise<void> {
  if (!push) return;
  const testing = new Map(
    (
      await db
        .select({ flag: flagExperiments.flag, shares: flagExperiments.shares })
        .from(flagExperiments)
        .where(inArray(flagExperiments.state, ["running", "settled"]))
    ).map((e) => [e.flag, e.shares]),
  );
  const site = (await flagDefs(db))
    .filter((f) => f.surface !== "portal")
    .map(({ surface: _, ...f }) => {
      const shares = testing.get(f.key);
      return shares ? { ...f, rules: shareRules(f.variants, shares) } : f;
    });
  try {
    await push(site);
  } catch (err) {
    console.warn(`flags: edge push failed: ${(err as Error).message}`);
  }
}

export async function addFlag(
  db: Queryable,
  input: FlagInput,
  by: string,
  push?: EdgePush,
): Promise<{ key: string }> {
  const got = FlagIn.safeParse(input);
  if (!got.success) throw new PortalRefusal(got.error.issues[0]?.message ?? "check the flag", 400);
  const variants = got.data.variants === undefined ? ["off", "on"] : variantsOf(got.data.variants);
  if (variants.length < 2 || variants.length > 10 || !variants.every((v) => VARIANT.test(v)))
    throw new PortalRefusal("2 to 10 variants, lower case, comma between each", 400);
  if (new Set(variants).size !== variants.length) throw new PortalRefusal("each variant once", 400);
  const [row] = await db
    .insert(flags)
    .values({
      key: got.data.key,
      about: got.data.about,
      surface: got.data.surface,
      variants,
      fallback: variants[0] ?? "off",
      createdBy: by,
    })
    .onConflictDoNothing()
    .returning({ key: flags.key });
  if (!row) throw new PortalRefusal(`there's already a flag ${got.data.key}`, 409);
  if (got.data.surface !== "portal") await pushEdge(db, push);
  return row;
}

export async function removeFlags(
  db: Queryable,
  keys: readonly string[],
  push?: EdgePush,
): Promise<string[]> {
  if (!keys.length) return [];
  const gone = await db
    .delete(flags)
    .where(inArray(flags.key, [...keys]))
    .returning({ key: flags.key, surface: flags.surface });
  if (gone.some((g) => g.surface !== "portal")) await pushEdge(db, push);
  return gone.map((g) => g.key);
}

const SURFACE = {
  portal: { label: "Portal", tone: "neutral" },
  site: { label: "Site", tone: "neutral" },
  both: { label: "Both", tone: "neutral" },
} as const;
const STATE = {
  live: { label: "Live", tone: "good" },
  killed: { label: "Killed", tone: "bad" },
} as const;

const FlagPatch = z
  .object({
    about: z.string().max(500),
    rules: z.string().max(5000),
    fallback: z.string(),
    state: z.enum(["live", "killed"]),
    surface: z.enum(SURFACES),
  })
  .partial()
  .strict();

const one = async (db: Queryable, key: string) =>
  (await db.select().from(flags).where(eq(flags.key, key)).limit(1))[0] ?? null;

/** Flags as records: rules in words, one per line, edited in place. */
export function flagRecord(push?: EdgePush): RecordType {
  return defineRecord({
    id: FLAG,
    app: "loops",
    channel: null,
    name: { one: "flag", many: "flags" },
    rows: async (db) =>
      (await db.select().from(flags).orderBy(asc(flags.key))).map((r) => ({
        id: r.key,
        key: r.key,
        about: r.about,
        variants: r.variants.join(", "),
        rules: formatRules(r.rules),
        fallback: r.fallback,
        state: r.killed ? "killed" : "live",
        surface: r.surface,
        updated_at: r.updatedAt.toISOString(),
      })),
    key: "id",
    title: "key",
    subtitle: "about",
    fields: {
      key: text("Key"),
      about: text("What it's for"),
      surface: status(SURFACE, "Read by"),
      state: status(STATE, "State"),
      variants: text("Variants"),
      rules: prose("Rules"),
      fallback: text("Otherwise"),
      updatedAt: date("Changed"),
    },
    views: [{ id: "all", label: "All", sort: "key", at: "updatedAt" }],
    actions: ["loops.flagAdd", "loops.flagRemove"],
    edits: {
      fields: ["about", "rules", "fallback", "state", "surface"],
      patch: FlagPatch as unknown as z.ZodType<Values>,
      about:
        "a feature flag: rules one per line, `variant: condition; condition`, first match wins. " +
        "Conditions: roles <list>, clients <ids>, people <emails>, <n>%, or everyone. Killed, " +
        "everyone gets the fallback",
      read: async (db, id) => {
        const r = await one(db, id);
        if (!r) return null;
        return {
          about: r.about,
          rules: formatRules(r.rules),
          fallback: r.fallback,
          state: r.killed ? "killed" : "live",
          surface: r.surface,
        };
      },
      check: async (patch, _now, db, id) => {
        const r = await one(db, id);
        if (!r) return "no such flag";
        if (typeof patch.rules === "string") {
          const got = parseRules(patch.rules, r.variants);
          if ("error" in got) return got.error;
        }
        if (typeof patch.fallback === "string" && !r.variants.includes(patch.fallback))
          return `the fallback is one of ${r.variants.join(", ")}`;
        return null;
      },
      write: async (db, id, patch) => {
        const r = await one(db, id);
        if (!r) throw new PortalRefusal("no such flag", 404);
        const set: Partial<typeof flags.$inferInsert> = { updatedAt: new Date() };
        if (typeof patch.about === "string") set.about = patch.about.trim();
        if (typeof patch.rules === "string") {
          const got = parseRules(patch.rules, r.variants);
          if ("error" in got) throw new PortalRefusal(got.error, 400);
          set.rules = got.rules;
        }
        if (typeof patch.fallback === "string") set.fallback = patch.fallback;
        if (patch.state === "live" || patch.state === "killed")
          set.killed = patch.state === "killed";
        if (typeof patch.surface === "string") set.surface = patch.surface as Surface;
        await db.update(flags).set(set).where(eq(flags.key, r.key));
        // Read back through the same transaction: the edge gets the flag as saved.
        if (r.surface !== "portal" || (set.surface && set.surface !== "portal"))
          await pushEdge(db, push);
      },
      needs: "manage",
    },
  });
}

/** The lander's `POST /api/edge`, from its base URL and the shared token. */
export function siteEdge(baseUrl: string, token: string, fetcher: typeof fetch = fetch): EdgePush {
  return async (all) => {
    const r = await fetcher(`${baseUrl.replace(/\/$/, "")}/api/edge`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ flags: all }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`the edge answered ${r.status}`);
  };
}
