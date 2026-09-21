/**
 * The ads ledger and the guard against Postgres and a Restate test
 * environment: `Ads.launch/start/stop` write `ad_launches` (the Graph calls
 * go to a fake site), and one `AdsWatch` pass stops the launch that spent
 * the guard with nothing to show, through `Ads.stop`, with one message.
 */
import * as restate from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import type { SiteClient } from "@wren/core/content";
import type { PassOutcome } from "@wren/core/restate";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { InsightRow, LaunchSpec } from "../../src/ads.js";
import { listLaunches } from "../../src/launches.js";
import { type AdsService, makeAds } from "../../src/restate.js";
import { type AdsWatch, makeAdsWatch, WATCH_KEY, type WatchStats } from "../../src/watch.js";

const writes: { path: string; input: Record<string, unknown> }[] = [];
let insights: InsightRow[] = [];
const notes: { title: string; body: string; level?: string }[] = [];
let n = 0;
const sites: SiteClient = {
  async call(_site, method, path, input = {}) {
    if (method === "POST") {
      writes.push({ path, input });
      n += 1;
      return { id: `${path.split("/").at(-1)}-${n}` } as never;
    }
    if (path.endsWith("/insights")) return { data: insights } as never;
    return { data: [] } as never;
  },
  async via() {
    return "api";
  },
};

/** As the worker does it: every site call is one journaled step, so a replay never makes a second campaign. */
const journaled = (ctx: restate.Context): SiteClient => ({
  call: <T>(site: string, method: "GET" | "POST", path: string, input?: Record<string, unknown>) =>
    ctx.run(`${method} ${path}`, () => sites.call<T>(site, method, path, input)),
  via: sites.via,
});

/** A stand-in content desk: keeps what AdsWatch hands it. */
const ideas: { text: string; draft?: boolean; source?: string }[] = [];
const fakeDesk = restate.object({
  name: "ContentDesk",
  handlers: {
    add: async (
      _ctx: restate.ObjectContext,
      req: { text: string; draft?: boolean; source?: string },
    ) => {
      ideas.push(req);
      return { idea: { id: `idea-${ideas.length}` } };
    },
  },
});

let pg: TestPostgres;
let env: RestateTestEnvironment;
beforeAll(async () => {
  pg = await startTestPostgres();
  env = await RestateTestEnvironment.start({
    services: [
      fakeDesk,
      makeAds({ sitesFor: journaled, adAccountId: "act_1", pageId: "p", db: pg.db }),
      makeAdsWatch({
        db: pg.db,
        pauseAfterUsd: 50,
        notifier: {
          name: "test",
          notify: async (title, body = "", level) => {
            notes.push({ title, body, ...(level ? { level } : {}) });
            return true;
          },
        },
      }),
    ],
    alwaysReplay: true,
  });
});
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, ["ad_launches"]);
  writes.length = 0;
  notes.length = 0;
  ideas.length = 0;
  insights = [];
});

const ads = () =>
  clients.connect({ url: env.baseUrl() }).serviceClient<AdsService>({ name: "Ads" });
const pass = () =>
  clients
    .connect({ url: env.baseUrl() })
    .objectClient<AdsWatch>({ name: "AdsWatch" }, WATCH_KEY)
    .sync() as Promise<PassOutcome<WatchStats>>;

const spec: LaunchSpec = {
  name: "founders",
  objective: "OUTCOME_TRAFFIC",
  dailyBudgetUsd: 10,
  targeting: { countries: ["US"] },
  creative: { message: "hi", link: "https://wren.test" },
};

describe("ads ledger and watch", () => {
  it("launch → start → stop is three rows' worth of state on one row", async () => {
    const made = await ads().launch(spec);
    let [row] = await listLaunches(pg.db);
    expect(row).toMatchObject({
      name: "founders",
      adAccountId: "1",
      campaignId: made.campaignId,
      adsetId: made.adsetId,
      adId: made.adId,
      status: "paused",
      dailyBudgetUsd: 10,
      startedAt: null,
    });
    expect(row?.spec).toEqual(spec);
    await ads().start({ ...made, dailyBudgetUsd: 12 });
    [row] = await listLaunches(pg.db);
    expect(row).toMatchObject({ status: "active", dailyBudgetUsd: 12 });
    expect(row?.startedAt).toBeInstanceOf(Date);
    await ads().stop({ campaignId: made.campaignId });
    [row] = await listLaunches(pg.db);
    expect(row).toMatchObject({ status: "stopped", stopReason: null });
    expect(row?.stoppedAt).toBeInstanceOf(Date);
  });

  it("a pass with nothing active reads nothing and says nothing", async () => {
    const out = await pass();
    expect(out.stats).toEqual({ active: 0, verdicts: [], failed: [], ideas: [] });
    expect(notes).toEqual([]);
  });

  it("stops the launch over the guard with no clicks, keeps the one with clicks, and reports", async () => {
    const dead = await ads().launch(spec);
    await ads().start({ ...dead, dailyBudgetUsd: 10 });
    const live = await ads().launch({ ...spec, name: "agencies" });
    await ads().start({ ...live, dailyBudgetUsd: 10 });
    insights = [
      { adset_id: dead.adsetId, campaign_id: dead.campaignId, spend: "55.10", clicks: "0" },
      { adset_id: live.adsetId, campaign_id: live.campaignId, spend: "70", clicks: "12" },
    ];
    writes.length = 0;
    const out = await pass();
    expect(out.stats?.active).toBe(2);
    expect(out.stats?.verdicts.map((v) => [v.name, v.paused])).toEqual([
      ["founders", true],
      ["agencies", false],
    ]);
    expect(writes).toEqual([{ path: `/${dead.campaignId}`, input: { status: "PAUSED" } }]);
    const rows = await listLaunches(pg.db);
    expect(rows.find((r) => r.campaignId === dead.campaignId)).toMatchObject({
      status: "stopped",
      stopReason: "spent $55.10 with no clicks or results (guard $50)",
    });
    expect(rows.find((r) => r.campaignId === live.campaignId)?.status).toBe("active");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ title: "ads: last 7 days", level: "warning" });
    expect(notes[0]?.body).toContain("agencies: $70.00 spent, 12 clicks, 0 results");
    // The winner is one idea for the content loop, stored open (draft: false), never drafted here.
    expect(out.stats?.ideas).toEqual([{ campaignId: live.campaignId, ideaId: "idea-1" }]);
    expect(ideas).toEqual([
      {
        text: expect.stringContaining('the ad "agencies" got 12 clicks'),
        draft: false,
        source: "ads",
      },
    ]);
    expect(notes[0]?.body).toContain("→ idea idea-1");
    // Stopped launches leave the watch; the winner is not suggested twice.
    const again = await pass();
    expect(again.stats?.active).toBe(1);
    expect(again.stats?.verdicts.every((v) => !v.paused)).toBe(true);
    expect(again.stats?.ideas).toEqual([]);
    expect(ideas).toHaveLength(1);
  });
});
