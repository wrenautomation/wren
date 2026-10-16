/**
 * TokenRenewal's limit (designs/2026-10-16-loop-watchdog.md), on a real Restate and Postgres: a
 * `sites/renew` that answers is a pass with its counts; one that never answers is cut at the
 * limit, left running (it writes tokens), kept in `last.timeouts`, and the loop goes on to ask
 * again. Synthetic site names only.
 */
import * as restate from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf } from "@wren/config";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { restateAdmin } from "../../src/console.js";
import { makeTokenRenewal, RENEWAL_COMMAND, type RenewReport } from "../../src/content/renewal.js";
import { runs } from "../../src/schema.js";
import { startTestRestate } from "../../src/testing.js";

const LIMIT_MS = 1_000;
const DAY_MS = 86_400_000;
/** While set, `renew` never answers. */
let hang = false;
const sites = restate.service({
  name: "sites",
  handlers: {
    renew: async (ctx: restate.Context): Promise<RenewReport> => {
      if (hang) await ctx.awakeable<void>().promise;
      return {
        lines: ["example-site: renewed"],
        results: [
          { site: "example-site", step: "renew", ok: true },
          { site: "other-site", step: "probe", ok: true },
        ],
        next: null,
      };
    },
  },
});

let pg: TestPostgres;
let env: RestateTestEnvironment;
beforeAll(async () => {
  pg = await startTestPostgres();
  env = await startTestRestate({
    services: [sites, makeTokenRenewal({ db: pg.db, limitMs: LIMIT_MS })],
    alwaysReplay: true,
  });
}, 180_000);
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});

const renewal = () =>
  clients
    .connect(ingressOf({ restateIngressUrl: env.baseUrl() }))
    .objectClient<ReturnType<typeof makeTokenRenewal>>({ name: "TokenRenewal" }, "box");
const open = () =>
  restateAdmin(env.adminAPIBaseUrl())(
    `SELECT id FROM sys_invocation WHERE target_service_name = 'sites' AND status <> 'completed'`,
  );

describe("TokenRenewal's limit", () => {
  it("an answer is a pass with its counts, and the next one a day on", async () => {
    const out = await renewal().sync();
    expect(out).toMatchObject({ error: null, failures: 0, delayMs: DAY_MS });
    expect(out.stats).toMatchObject({ renewed: 2, failed: 0, lines: ["example-site: renewed"] });
    expect((await renewal().status()).last?.timeouts).toBeUndefined();
  });

  it("no answer in time: cut, left running, counted, and the pass fails with a short retry", async () => {
    hang = true;
    const out = await renewal().sync();
    expect(out.stats).toBeNull();
    expect(out.error).toContain("sites/renew gave no answer in 1 s");
    expect(out.failures).toBe(1);
    expect(out.delayMs).toBe(15_000);
    const last = (await renewal().status()).last;
    expect(last?.timeouts).toEqual([{ call: "sites/renew", unit: null, ms: LIMIT_MS }]);
    // `keep`: a renew writes tokens, so it is left to finish on its own.
    expect(await open()).toHaveLength(1);
    const ledger = await pg.db
      .select()
      .from(runs)
      .where(eq(runs.command, RENEWAL_COMMAND))
      .orderBy(runs.startedAt);
    expect(ledger.map((r) => (r.stats as { error?: string } | null)?.error ?? null)).toEqual([
      null,
      expect.stringContaining("sites/renew gave no answer"),
    ]);
  });
});
