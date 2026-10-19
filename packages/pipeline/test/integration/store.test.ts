/**
 * The version store on a real Postgres (designs/2026-10-18-journeys.md): offers sync by hash,
 * terms go live by date, funnels append under the rules. Synthetic data only.
 */

import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import type { Offer, Terms } from "@wren/offers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FunnelBody } from "../../src/model.js";
import {
  addFunnel,
  addTerms,
  appendFunnel,
  funnelVersionsOf,
  liveTerms,
  offerVersionsOf,
  Refused,
  setFunnelStatus,
  syncOffers,
} from "../../src/store.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

const triggers = new Set(["trigger.booking", "trigger.reply"]);

const offer = (id: string, promise = "Something."): Offer => ({
  id,
  name: "Test",
  status: "live",
  audience: "Someone.",
  promise,
  price: { kind: "quoted" },
  slots: null,
  days: null,
  youGet: ["A thing."],
  youGive: [],
  weGet: [],
  guarantee: null,
  measures: [],
  next: [],
  page: null,
  booking: null,
  application: null,
});

const terms = (setupCents: number): Terms => ({
  currency: "USD",
  setupCents,
  monthlyCents: null,
  perUnitCents: null,
  unit: null,
  capCents: null,
  days: null,
  payDays: 7,
});

const funnel = (labels: string[] = ["Engaged", "Signed"]): FunnelBody => ({
  name: "Test",
  offer: "offer-a",
  stages: [
    { key: "engaged", label: labels[0] ?? "", on: [{ trigger: "trigger.reply" }] },
    { key: "signed", label: labels[1] ?? "", sale: true, on: [{ trigger: "trigger.booking" }] },
  ],
  entries: [],
});

const reasons = (p: Promise<unknown>) =>
  p.then(
    () => [],
    (e: unknown) => (e instanceof Refused ? e.errors : [String(e)]),
  );

describe("syncOffers", () => {
  it("adds once, repeats nothing, and numbers a changed hash", async () => {
    const first = await syncOffers(pg.db, [offer("sync-a"), offer("sync-b")], "t");
    expect(first.added).toEqual([
      { offer: "sync-a", number: 1 },
      { offer: "sync-b", number: 1 },
    ]);

    const again = await syncOffers(pg.db, [offer("sync-a"), offer("sync-b")], "t");
    expect(again).toEqual({ added: [], unchanged: 2 });

    const changed = await syncOffers(
      pg.db,
      [offer("sync-a", "Something else."), offer("sync-b")],
      "t",
    );
    expect(changed.added).toEqual([{ offer: "sync-a", number: 2 }]);
    expect(changed.unchanged).toBe(1);

    const rows = await offerVersionsOf(pg.db, "sync-a");
    expect(rows.map((r) => r.number)).toEqual([1, 2]);
    expect(rows[1]?.body.promise).toBe("Something else.");
    expect(rows[0]?.hash).not.toBe(rows[1]?.hash);
  });

  it("numbers a change back to an older shape as the next version", async () => {
    await syncOffers(pg.db, [offer("sync-c")], "t");
    await syncOffers(pg.db, [offer("sync-c", "Other.")], "t");
    const back = await syncOffers(pg.db, [offer("sync-c")], "t");
    expect(back).toEqual({ added: [{ offer: "sync-c", number: 3 }], unchanged: 0 });
    const rows = await offerVersionsOf(pg.db, "sync-c");
    expect(rows.map((r) => r.number)).toEqual([1, 2, 3]);
    expect(rows[2]?.hash).toBe(rows[0]?.hash);
    expect((await syncOffers(pg.db, [offer("sync-c")], "t")).unchanged).toBe(1);
  });
});

describe("terms", () => {
  it("goes live by date, the highest number whose date has come", async () => {
    await addTerms(pg.db, {
      offer: "offer-a",
      plan: "standard",
      from: "2027-01-01",
      body: terms(100),
      why: "first",
      by: "t",
    });
    const second = await addTerms(pg.db, {
      offer: "offer-a",
      plan: "standard",
      from: "2027-06-01",
      body: terms(200),
      why: "second",
      by: "t",
    });
    expect(second.number).toBe(2);

    expect(await liveTerms(pg.db, "offer-a", "standard", "2026-12-31")).toBeNull();
    expect((await liveTerms(pg.db, "offer-a", "standard", "2027-03-01"))?.body.setupCents).toBe(
      100,
    );
    expect((await liveTerms(pg.db, "offer-a", "standard", "2027-06-01"))?.body.setupCents).toBe(
      200,
    );
    expect(await liveTerms(pg.db, "offer-a", "flat", "2027-06-01")).toBeNull();
    expect(await liveTerms(pg.db, "offer-b", "standard", "2027-06-01")).toBeNull();
  });

  it("refuses an earlier date and a bad body", async () => {
    const early = await reasons(
      addTerms(pg.db, {
        offer: "offer-a",
        plan: "standard",
        from: "2027-02-01",
        body: terms(300),
        why: "x",
        by: "t",
      }),
    );
    expect(early[0]).toMatch(/cannot start earlier/);
    const bad = await reasons(
      addTerms(pg.db, {
        offer: "offer-a",
        plan: "Bad Plan",
        from: "2027-09-01",
        body: { ...terms(1.5), currency: "usd" },
        why: "x",
        by: "t",
      }),
    );
    expect(bad.length).toBe(3);
  });

  it("numbers two concurrent adds apart", async () => {
    const add = (from: string) =>
      addTerms(pg.db, {
        offer: "offer-c",
        plan: "partner-1",
        from,
        body: terms(100),
        why: "x",
        by: "t",
      });
    const rows = await Promise.all([add("2027-01-01"), add("2027-01-01")]);
    expect(rows.map((r) => r.number).sort()).toEqual([1, 2]);
  });
});

describe("funnels", () => {
  it("adds, and refuses a broken first version", async () => {
    const v1 = await addFunnel(pg.db, {
      id: "f-one",
      name: "One",
      body: funnel(),
      why: "first",
      by: "t",
      triggers,
    });
    expect(v1.number).toBe(1);

    const broken = await reasons(
      addFunnel(pg.db, {
        id: "f-bad",
        name: "Bad",
        body: {
          ...funnel(),
          stages: [{ key: "x", label: "X", on: [{ trigger: "trigger.nope" }] }],
        },
        why: "first",
        by: "t",
        triggers,
      }),
    );
    expect(broken.join(" ")).toMatch(/exactly one sale stage/);
    expect(broken.join(" ")).toMatch(/not a known trigger/);
    expect(await funnelVersionsOf(pg.db, { funnel: "f-bad" })).toEqual([]);

    expect(
      await reasons(
        addFunnel(pg.db, {
          id: "f-one",
          name: "One",
          body: funnel(),
          why: "again",
          by: "t",
          triggers,
        }),
      ),
    ).toEqual(['Funnel "f-one" exists. Append a version to change it.']);
  });

  it("refuses a broken prefix and accepts an append", async () => {
    await addFunnel(pg.db, {
      id: "f-two",
      name: "Two",
      body: funnel(),
      why: "first",
      by: "t",
      triggers,
    });
    const [engaged, signed] = funnel().stages;
    if (!engaged || !signed) throw new Error("no stages");

    // A stage renamed breaks the prefix.
    const renamed: FunnelBody = {
      ...funnel(),
      stages: [{ ...engaged, key: "interested" }, signed],
    };
    const refused = await reasons(appendFunnel(pg.db, "f-two", renamed, "x", "t", triggers));
    expect(refused.join(" ")).toMatch(/must stay "engaged"/);

    // A new stage before the sale stage moves it: also a break.
    const inserted: FunnelBody = {
      ...funnel(),
      stages: [engaged, { key: "call", label: "Call", on: [] }, signed],
    };
    expect(
      (await reasons(appendFunnel(pg.db, "f-two", inserted, "x", "t", triggers))).join(" "),
    ).toMatch(/must stay "signed"/);

    // A new last stage is an append.
    const grown: FunnelBody = {
      ...funnel(),
      stages: [engaged, signed, { key: "kept", label: "Kept", on: [] }],
    };
    const v2 = await appendFunnel(pg.db, "f-two", grown, "add a stage", "t", triggers);
    expect(v2.number).toBe(2);

    // The same body again is not a version.
    expect(await reasons(appendFunnel(pg.db, "f-two", grown, "same", "t", triggers))).toEqual([
      "That is already version 2.",
    ]);
    expect(await reasons(appendFunnel(pg.db, "f-none", grown, "x", "t", triggers))).toEqual([
      'Funnel "f-none" does not exist. Add it first.',
    ]);
  });

  it("numbers two concurrent appends 2 and 3", async () => {
    await addFunnel(pg.db, {
      id: "f-race",
      name: "Race",
      body: funnel(),
      why: "first",
      by: "t",
      triggers,
    });
    const rows = await Promise.all([
      appendFunnel(pg.db, "f-race", funnel(["A", "Signed"]), "a", "t", triggers),
      appendFunnel(pg.db, "f-race", funnel(["B", "Signed"]), "b", "t", triggers),
    ]);
    expect(rows.map((r) => r.number).sort()).toEqual([2, 3]);
    const all = await funnelVersionsOf(pg.db, { funnel: "f-race" });
    expect(all.map((r) => r.number)).toEqual([1, 2, 3]);
  });

  it("checks a funnel entry against stored funnels", async () => {
    const feeder: FunnelBody = {
      ...funnel(),
      entries: [{ id: "from-one", kind: "funnel", funnel: { id: "f-one", at: "signed" } }],
    };
    expect(
      (
        await addFunnel(pg.db, {
          id: "f-feed",
          name: "Feed",
          body: feeder,
          why: "x",
          by: "t",
          triggers,
        })
      ).number,
    ).toBe(1);
    const missing: FunnelBody = {
      ...funnel(),
      entries: [{ id: "from-gone", kind: "funnel", funnel: { id: "f-gone" } }],
    };
    expect(
      (
        await reasons(
          addFunnel(pg.db, {
            id: "f-lost",
            name: "Lost",
            body: missing,
            why: "x",
            by: "t",
            triggers,
          }),
        )
      ).join(" "),
    ).toMatch(/does not exist/);
    // f-one feeding f-feed would make a loop.
    const loop: FunnelBody = {
      ...funnel(),
      entries: [{ id: "from-feed", kind: "funnel", funnel: { id: "f-feed" } }],
    };
    expect(
      (await reasons(appendFunnel(pg.db, "f-one", loop, "x", "t", triggers))).join(" "),
    ).toMatch(/loop/);
  });

  it("sets status and filters versions", async () => {
    await addFunnel(pg.db, {
      id: "f-stat",
      name: "Stat",
      body: funnel(),
      why: "first",
      by: "t",
      triggers,
    });
    await setFunnelStatus(pg.db, "f-stat", "off");
    const live = await funnelVersionsOf(pg.db, { live: true, newest: true });
    expect(live.some((r) => r.funnel === "f-stat")).toBe(false);
    expect(live.some((r) => r.funnel === "f-one")).toBe(true);
    const one = await funnelVersionsOf(pg.db, { funnel: "f-stat" });
    expect(one[0]?.status).toBe("off");
    expect(await reasons(setFunnelStatus(pg.db, "f-none", "live"))).toEqual([
      'Funnel "f-none" does not exist.',
    ]);
  });
});
