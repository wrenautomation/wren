/**
 * Time limits on a loop pass's calls, against a real Restate and Postgres: a call that never
 * answers is cut at its limit and cancelled, its unit skipped; three in a row hold the unit in
 * `unit_holds`; a group (platform) that never answers is left out, its units never blamed; with
 * `oneHost`, a host that stops mid-pass ends the pass's calls, no unit blamed. A pass that throws
 * is kept as a failed one and the chain goes on.
 */

import { ingressOf } from "@wren/config";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import * as restate from "@wren/runtime";
import * as clients from "@wren/runtime/clients";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hold, holdsOn, personHold, releaseSubjects, settle } from "../../src/checks.js";
import { pauseJob, readLoopHold, resumeJob } from "../../src/job-pauses.js";
import { CallTimeout, limitStage, type TimedOut, unitLimits } from "../../src/restate/limits.js";
import {
  makeLoopObject,
  type PassOutcome,
  setLastPass,
  setLoopHoldReader,
} from "../../src/restate/loop.js";
import { startTestRuntime, type TestRuntime } from "../../src/testing.js";

const LIMIT_MS = 1000;

/** `slow…` never answers; anything else answers at once. */
const echo = restate.service({
  name: "Echo",
  handlers: {
    say: async (ctx: restate.Context, word: string): Promise<string> => {
      if (word.startsWith("slow")) await ctx.awakeable<string>().promise;
      return word;
    },
  },
});
type EchoApi = { say: (ctx: restate.Context, word: string) => Promise<string> };

/** Each key's units, in order; group `g` unless `group:unit`. */
const UNITS: Record<string, string[]> = {
  /** The group answers, so `slow1`'s timeouts are its own. */
  own: ["fast1", "slow1"],
  /** Nothing answers: the group is down, no unit is blamed. */
  down: ["slow1", "slow2", "slow3"],
  /** `oneHost`: `a` answers, then the host stops: both groups' later units left out, none blamed. */
  host: ["a:fast1", "a:slow1", "b:slow2", "b:fast2", "a:fast3"],
  /** A person's holds: `<kind> <subject>` units, as ReachInboxRead names them. */
  person: ["replies a", "replies b", "invites a"],
};

type Stats = { said: string[]; timedOut: string[]; skipped: string[] };

let pg: TestPostgres;
const limited = makeLoopObject<Stats>("Limited", async (ctx: restate.ObjectContext) => {
  const limits = await unitLimits(ctx, pg.db, "Limited", { oneHost: ctx.key === "host" });
  const stats: Stats = { said: [], timedOut: [], skipped: [] };
  for (const named of UNITS[ctx.key] ?? []) {
    const [g, u] = named.includes(":") ? (named.split(":") as [string, string]) : ["g", named];
    if (limits.skip(u, g)) {
      stats.skipped.push(u);
      continue;
    }
    try {
      const p = ctx.serviceClient<EchoApi>({ name: "Echo" }).say(u);
      stats.said.push(await limits.within(u, p, { ms: LIMIT_MS, call: "Echo/say", group: g }));
    } catch (err) {
      if (!(err instanceof CallTimeout)) throw err;
      stats.timedOut.push(u);
    }
  }
  const outcome: PassOutcome<Stats> = {
    stats,
    error: null,
    failures: 0,
    delayMs: 3_600_000,
    now: new Date(await ctx.date.now()).toISOString(),
  };
  await setLastPass(ctx, outcome);
  return outcome;
});

/** A pass that throws: terminal on key `terminal`, plain otherwise. */
const throws = makeLoopObject("Throws", async (ctx: restate.ObjectContext) => {
  await ctx.run("step", () => "ok");
  if (ctx.key === "terminal") throw new restate.TerminalError("[429] cap used");
  throw new Error("replayed failure");
});

let env: TestRuntime;
const ingress = () => clients.connect(ingressOf({ apiUrl: env.baseUrl() }));
const admin = () => env.admin.query;
/** One pass now, as its loop state keeps it (`timeouts` rides there, for LoopRevive). */
const sync = async (key: string): Promise<PassOutcome<Stats>> => {
  const o = ingress().objectClient<typeof limited>({ name: "Limited" }, key);
  await o.sync();
  return (await o.status()).last as PassOutcome<Stats>;
};

beforeAll(async () => {
  pg = await startTestPostgres();
  env = await startTestRuntime({ services: [echo, limited, throws] });
});
afterAll(async () => {
  setLoopHoldReader(null);
  await env?.stop();
  await pg?.stop();
});

async function until<T>(read: () => Promise<T>, ok: (t: T) => boolean): Promise<T> {
  for (let i = 0; ; i++) {
    const t = await read();
    if (ok(t) || i > 100) return t;
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe("unitLimits", () => {
  it("cuts a call at its limit, cancels it, and holds the unit after three in a row", async () => {
    const first = await sync("own");
    expect(first.stats).toEqual({ said: ["fast1"], timedOut: ["slow1"], skipped: [] });
    expect(first.timeouts).toEqual<TimedOut[]>([{ call: "Echo/say", unit: "slow1", ms: LIMIT_MS }]);
    // Cancelled, not left waiting.
    const open = await until(
      () =>
        admin()(
          `SELECT id FROM sys_invocation WHERE target_service_name = 'Echo' AND status <> 'completed'`,
        ),
      (rows) => rows.length === 0,
    );
    expect(open).toEqual([]);

    await sync("own");
    const third = await sync("own");
    expect(third.timeouts?.[0]).toMatchObject({ unit: "slow1", held: true });
    expect(await holdsOn(pg.db, limitStage("Limited", "own"))).toEqual({
      held: ["slow1"],
      due: [],
    });

    const fourth = await sync("own");
    expect(fourth.stats).toEqual({ said: ["fast1"], timedOut: [], skipped: ["slow1"] });
    expect(fourth.timeouts).toBeUndefined();
  });

  it("its one retry after the hold: an answer settles it, a timeout waits for a person", async () => {
    const stage = limitStage("Limited", "own");
    await pg.db.execute(sql`update unit_holds set until = now() where stage = ${stage}`);
    expect((await holdsOn(pg.db, stage)).due).toEqual(["slow1"]);
    const retry = await sync("own");
    expect(retry.stats?.timedOut).toEqual(["slow1"]);
    expect(retry.timeouts?.[0]?.held).toBe(true);
    const [row] = await pg.db.execute<{ forever: boolean }>(
      sql`select until = 'infinity'::timestamptz forever from unit_holds where stage = ${stage}`,
    );
    expect(row?.forever).toBe(true);
  });

  it("leaves a group out when nothing in it answers, and blames no unit", async () => {
    for (let i = 0; i < 3; i++) {
      const pass = await sync("down");
      expect(pass.stats).toEqual({ said: [], timedOut: ["slow1", "slow2"], skipped: ["slow3"] });
    }
    expect(await holdsOn(pg.db, limitStage("Limited", "down"))).toEqual({ held: [], due: [] });
  });

  it("oneHost: two timeouts in a row end the pass's calls, though a group answered first", async () => {
    for (let i = 0; i < 3; i++) {
      const pass = await sync("host");
      expect(pass.stats).toEqual({
        said: ["fast1"],
        timedOut: ["slow1", "slow2"],
        skipped: ["fast2", "fast3"],
      });
      expect(pass.timeouts?.some((t) => t.held)).toBe(false);
    }
    expect(await holdsOn(pg.db, limitStage("Limited", "host"))).toEqual({ held: [], due: [] });
  });
});

describe("a pass that throws", () => {
  it.each([
    ["terminal", "[429] cap used"],
    ["plain", "replayed failure"],
  ])("%s: kept as a failed pass, the next one queued", async (key, error) => {
    const t = ingress().objectClient<typeof throws>({ name: "Throws" }, key);
    await t.start();
    const s = await until(
      async () => await t.status(),
      (s) => s.last !== null,
    );
    expect(s.running).toBe(true);
    expect(s.last).toMatchObject({ stats: null, failures: 1 });
    expect(s.last?.error).toContain(error);
    const next = await until(
      () =>
        admin()(
          `SELECT id FROM sys_invocation WHERE target_service_name = 'Throws' AND target_service_key = '${key}' AND status = 'scheduled'`,
        ),
      (rows) => rows.length === 1,
    );
    expect(next).toHaveLength(1);
  });
});

describe("a person's holds (wren jobs pause)", () => {
  const stage = limitStage("Limited", "person");

  it('--unit "replies *" skips every replies unit and the rest of the pass runs', async () => {
    await personHold(pg.db, { stage, subject: "replies *", why: "inbox reads off", by: "cli" });
    const held = await sync("person");
    expect(held.stats).toEqual({
      said: ["invites a"],
      timedOut: [],
      skipped: ["replies a", "replies b"],
    });
    await releaseSubjects(pg.db, stage, ["replies *"], "cli");
    expect((await sync("person")).stats?.said).toEqual(["replies a", "replies b", "invites a"]);
  });

  it("wins over a system hold at once, and a settle never ends it", async () => {
    await hold(pg.db, { stage, subject: "invites a", reason: "3 timeouts" });
    await personHold(pg.db, { stage, subject: "invites a", why: "stop invites", by: "cli" });
    await settle(pg.db, stage, ["invites a"]);
    const [row] = await pg.db.execute<{ forever: boolean; held_by: string }>(
      sql`select until = 'infinity'::timestamptz forever, held_by from unit_holds
          where stage = ${stage} and subject = 'invites a' and released_at is null`,
    );
    expect(row).toEqual({ forever: true, held_by: "cli" });
    expect((await sync("person")).stats?.skipped).toEqual(["invites a"]);
    await releaseSubjects(pg.db, stage, ["invites a"], "cli");
  });

  it("a held loop runs no pass and keeps its chain; resume runs it again", async () => {
    setLoopHoldReader((service, key) => readLoopHold(pg.db, service, key));
    await pauseJob(pg.db, { job: "Limited", why: "all keys off", by: "cli" });
    const held = await sync("person");
    expect(held.stats).toBeNull();
    expect(held.paused).toBe("held by cli: all keys off");
    expect(held.delayMs).toBe(10 * 60_000);
    await resumeJob(pg.db, "Limited", "cli");

    await pauseJob(pg.db, { job: "Limited/person", why: "one key", by: "cli", forMs: 60_000 });
    const timed = await sync("person");
    expect(timed.paused).toBe("held by cli: one key");
    expect(timed.delayMs).toBeLessThanOrEqual(60_000);
    expect((await sync("own")).paused).toBeUndefined();
    await resumeJob(pg.db, "Limited/person", "cli");
    expect((await sync("person")).stats?.said).toEqual(["replies a", "replies b", "invites a"]);
  });
});
