/**
 * Experiments on a real Postgres (`../../src/experiment-store.ts`): a site flag gets a draft,
 * Start puts even shares on the edge, a decision settles it, Ship sends everyone the winner,
 * and the record reads each variant's days. Synthetic logins and counts throughout.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addOperator, operators } from "../../src/clients/index.js";
import { consoleApi } from "../../src/console.js";
import {
  experimentRecord,
  liveExperiments,
  saveDecision,
  variantCounts,
  writeFlagDays,
} from "../../src/experiment-store.js";
import { addFlag } from "../../src/flag-store.js";
import type { FlagDef } from "../../src/flags.js";
import type { PortalRefusal } from "../../src/portal.js";
import { flagExperiments, flags } from "../../src/schema.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

let pushed: FlagDef[][] = [];
const edge = async (all: readonly FlagDef[]) => {
  pushed.push([...all]);
};
const by = "ada@example.test";
beforeEach(async () => {
  pushed = [];
  await truncate(pg.db, ["flag_days", "flag_experiments", "flags", "operators"]);
  await addOperator(pg.db, by);
  await addOperator(pg.db, "otto@example.test");
  await pg.db
    .update(operators)
    .set({ role: "operator" })
    .where(eq(operators.email, "otto@example.test"));
  await addFlag(
    pg.db,
    { key: "hero", about: "the hero line", surface: "site", variants: "a,b" },
    by,
  );
  await addFlag(pg.db, { key: "voice", surface: "portal" }, by);
});

const api = () => consoleApi({ main: pg.db, views: [], edge });
const ADMIN = { email: by, operator: true, team: { role: "admin", clients: null } };
const OPERATOR = {
  email: "otto@example.test",
  operator: true,
  team: { role: "operator", clients: null },
};
const refused = async (p: Promise<unknown>, status: number) => {
  const err = (await p.catch((e: unknown) => e)) as PortalRefusal;
  expect(err.status).toBe(status);
};
const hero = (all: readonly FlagDef[] | undefined) => all?.find((f) => f.key === "hero");
const state = async () =>
  (await pg.db.select().from(flagExperiments).where(eq(flagExperiments.flag, "hero")))[0];

describe("experiments", () => {
  it("adds a draft only on a site flag, once, and only for manage", async () => {
    await refused(api().experimentAdd({ viewer: ADMIN as never, flag: "voice" }), 400);
    await refused(api().experimentAdd({ viewer: ADMIN as never, flag: "nope" }), 404);
    await refused(api().experimentAdd({ viewer: OPERATOR as never, flag: "hero" }), 403);
    await api().experimentAdd({ viewer: ADMIN as never, flag: "hero", goal: "calls" });
    await refused(api().experimentAdd({ viewer: ADMIN as never, flag: "hero" }), 409);
    expect(await state()).toMatchObject({ state: "draft", goal: "calls" });
    expect(pushed).toEqual([]);
    await refused(api().experimentStart({ viewer: OPERATOR as never, ids: ["hero"] }), 403);
  });

  it("starts with even shares on the edge, settles, ships the winner", async () => {
    await api().experimentAdd({ viewer: ADMIN as never, flag: "hero" });
    expect(await api().experimentStart({ viewer: ADMIN as never, ids: ["hero"] })).toEqual({
      done: ["hero"],
    });
    expect(hero(pushed.at(-1))?.rules).toEqual([{ variant: "a", percent: 50 }, { variant: "b" }]);
    expect(pushed.at(-1)?.some((f) => f.key === "voice")).toBe(false);
    expect((await liveExperiments(pg.db)).map((l) => l.e.flag)).toEqual(["hero"]);

    await saveDecision(pg.db, "hero", {
      shares: { a: 0.1, b: 0.9 },
      pBest: { a: 0.03, b: 0.97 },
      retired: [],
      best: "b",
      settled: true,
    });
    expect(await state()).toMatchObject({ state: "settled", best: "b" });
    expect(await liveExperiments(pg.db)).toEqual([]);

    await api().experimentShip({ viewer: ADMIN as never, ids: ["hero"] });
    expect(await state()).toMatchObject({ state: "shipped", winner: "b", endedBy: by });
    const [flag] = await pg.db.select().from(flags).where(eq(flags.key, "hero"));
    expect(flag?.rules).toEqual([{ variant: "b" }]);
    expect(hero(pushed.at(-1))?.rules).toEqual([{ variant: "b" }]);
  });

  it("stops back to the flag's rules; removes only what isn't live", async () => {
    await api().experimentAdd({ viewer: ADMIN as never, flag: "hero" });
    await api().experimentStart({ viewer: ADMIN as never, ids: ["hero"] });
    expect(await api().experimentRemove({ viewer: ADMIN as never, ids: ["hero"] })).toEqual({
      done: [],
    });
    await api().experimentStop({ viewer: ADMIN as never, ids: ["hero"] });
    expect(await state()).toMatchObject({ state: "stopped" });
    expect(hero(pushed.at(-1))?.rules).toEqual([]);
    expect(await api().experimentRemove({ viewer: ADMIN as never, ids: ["hero"] })).toEqual({
      done: ["hero"],
    });
    expect(await state()).toBeUndefined();
  });

  it("upserts days and reads each variant's funnel on the record", async () => {
    await api().experimentAdd({ viewer: ADMIN as never, flag: "hero" });
    const day = (variant: string, channel: string, visitors: number, forms: number) => ({
      flag: "hero",
      day: "2026-10-01",
      variant,
      channel,
      visitors,
      forms,
      calls: 0,
      paid: 0,
    });
    await writeFlagDays(pg.db, [day("a", "direct", 3, 0), day("b", "direct", 4, 1)]);
    await writeFlagDays(pg.db, [day("a", "direct", 5, 1), day("b", "search", 2, 1)]);
    expect(await variantCounts(pg.db, "hero", null)).toEqual([
      { variant: "a", visitors: 5, forms: 1, calls: 0, paid: 0 },
      { variant: "b", visitors: 6, forms: 2, calls: 0, paid: 0 },
    ]);
    expect(await variantCounts(pg.db, "hero", "2026-10-02")).toEqual([]);

    const [row] = (await experimentRecord().rows?.(pg.db)) ?? [];
    expect(row).toMatchObject({
      flag: "hero",
      about: "the hero line",
      state: "draft",
      shares: "",
      visitors: 11,
      goals: 3,
      funnel: "a: 5 visitors, 1 forms, 0 calls, 0 paid\nb: 6 visitors, 2 forms, 0 calls, 0 paid",
    });
  });
});
