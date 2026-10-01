/**
 * Onboarding: the contract is issued with the terms, an owner signs the text
 * they read, access is asked for and answered, and the plan starts once it's
 * signed and the setup fee is paid. The watch mails the signed copy and pings
 * us about paperwork left waiting.
 */
import { addMember, clients } from "@wren/core/clients";
import type { Notifier } from "@wren/core/notify";
import { PortalRefusal, type Viewer } from "@wren/core/portal";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { offerFor } from "@wren/offers";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addInvoice,
  DeliveryRefusal,
  engagementOf,
  markInvoice,
  onboard,
  requestAccess,
  termsFor,
  todayUtc,
  WREN_PARTY,
} from "../../src/index.js";
import { deliveryApi } from "../../src/service.js";
import { type PortalMail, watchPass } from "../../src/watch.js";

let pg: TestPostgres;
let api: ReturnType<typeof deliveryApi>;

const OPS: Viewer = { email: "ops@wren.example", operator: true };
const AMY: Viewer = { email: "amy@acme.example" };
const MO: Viewer = { email: "mo@acme.example" };
const BO: Viewer = { email: "bo@beta.example" };
const acme = { client: "acme" };
const FROM = { ip: "203.0.113.7", agent: "Test browser" };
const mail: PortalMail[] = [];
const pinged: string[] = [];
const notifier: Notifier = {
  name: "test",
  notify: async (_title, body = "") => {
    pinged.push(body);
    return true;
  },
};
const pass = () =>
  watchPass(
    {
      main: pg.db,
      send: async (m) => {
        mail.push(m);
      },
      app: "https://app.example",
      zone: "UTC",
      notifier,
    },
    new Date(),
  );

async function refused(p: Promise<unknown>): Promise<number> {
  try {
    await p;
  } catch (err) {
    if (err instanceof PortalRefusal || err instanceof DeliveryRefusal) return err.status;
    throw err;
  }
  throw new Error("expected a refusal");
}

beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.db.insert(clients).values([
    { id: "acme", name: "Acme Staffing", database: "wren_client_acme" },
    { id: "beta", name: "Beta Search", database: "wren_client_beta" },
  ]);
  await addMember(pg.db, "acme", "amy@acme.example", { role: "owner" });
  await addMember(pg.db, "acme", "mo@acme.example");
  await addMember(pg.db, "beta", "bo@beta.example", { role: "owner" });
  api = deliveryApi({ main: pg.db, demoName: "Demo" });
});

afterAll(async () => {
  await pg?.stop();
});

describe("terms", () => {
  it("come from the offer's price, in cents, with changes on top", () => {
    const t = termsFor(offerFor("reactivation"));
    expect(t).toMatchObject({
      setupCents: 150_000,
      monthlyCents: 30_000,
      perUnitCents: 50_000,
      unit: "meeting booked",
      capCents: 1_350_000,
      days: 90,
      until: 20,
      refundIfNone: { minContacts: 500 },
    });
    expect(termsFor(offerFor("reactivation"), {}, true)).toMatchObject({
      setupCents: 750_000,
      monthlyCents: 30_000,
      perUnitCents: null,
      capCents: null,
      until: 20,
      refundIfNone: { minContacts: 500 },
    });
    expect(() => termsFor(offerFor("recruiting-candidate-reactivation"), {}, true)).toThrow(/flat/);
    expect(termsFor(offerFor("reactivation"), { setupCents: 0 }).setupCents).toBe(0);
    expect(() => termsFor(offerFor("reactivation"), { currency: "dollars" })).toThrow();
    expect(() => termsFor(offerFor("recruiting-candidate-reactivation"))).toThrow(/per deal/);
  });
});

describe("onboarding", () => {
  let sha = "";
  let accessId = 0;

  beforeAll(async () => {
    // A start already past: signing late moves the plan to the day it really starts.
    await onboard(pg.db, {
      clientId: "acme",
      offerId: "reactivation",
      startsOn: "2026-01-05",
      by: "ops@wren.example",
    });
    const e = await engagementOf(pg.db, "acme");
    accessId = (
      await requestAccess(pg.db, e, {
        system: "Your ATS",
        scope: "Read only",
        why: "To match candidates",
        revoke: "Remove our user",
        by: "ops@wren.example",
      })
    ).id;
  });

  it("waits: steps are next, asks aren't overdue, the paperwork shows", async () => {
    const [e] = (await api.home({ viewer: MO })).engagements;
    expect(e?.status).toBe("onboarding");
    expect(new Set(e?.steps.map((s) => s.state))).toEqual(new Set(["next"]));
    expect(e?.asks.some((a) => a.overdue)).toBe(false);
    expect(e?.paperwork.contract?.signedAt).toBeNull();
    expect(e?.paperwork.setupPaid).toBe(false);
    expect(e?.paperwork.access.map((a) => a.status)).toEqual(["open"]);
    expect(e?.offer.youGive.length).toBeGreaterThan(0);
  });

  it("the contract is for owners and Wren; it names the client and the fees", async () => {
    const c = await api.contract({ viewer: AMY });
    sha = c.sha256;
    expect(c.body).toContain("Acme Staffing");
    expect(c.body).toContain("A setup fee of USD 1,500");
    expect(c.body).toContain("USD 300 a month while the work runs");
    expect(c.body).toContain("up to USD 13,500 in total");
    expect(c.body).toContain(
      "If there are fewer than 20 meetings booked by then, it carries on until there are 20",
    );
    expect(c.body).toContain(
      "If there are no meetings booked by day 90, we refund every fee you've paid us",
    );
    expect(c.body).toContain("at least 500 contacts");
    expect(c.body).toContain(
      "isn't refundable once the work has started, except as the next point says",
    );
    expect(c.body).toContain("apart from the refund in section 6");
    expect(c.body).toContain(WREN_PARTY.name);
    expect(c.body).not.toMatch(/[–—]/);
    expect(c.signed).toBeNull();
    expect((await api.contract({ viewer: OPS, ...acme })).sha256).toBe(sha);
    expect(await refused(api.contract({ viewer: MO }))).toBe(403);
    expect(await refused(api.contract({ viewer: BO, ...acme }))).toBe(403);
    expect(await refused(api.contract({ viewer: BO }))).toBe(404);
  });

  it("only an owner signs, ticking the box, the text they read", async () => {
    const sign = { sha256: sha, name: "Amy Adams", agreed: true, from: FROM };
    expect(await refused(api.sign({ viewer: MO, ...sign }))).toBe(403);
    expect(await refused(api.sign({ viewer: OPS, ...acme, ...sign }))).toBe(403);
    expect(await refused(api.sign({ viewer: AMY, ...sign, agreed: false }))).toBe(400);
    expect(await refused(api.sign({ viewer: AMY, ...sign, sha256: "0".repeat(64) }))).toBe(409);
    expect(await refused(api.sign({ viewer: AMY, ...sign, name: " " }))).toBe(400);
    await api.sign({ viewer: AMY, ...sign, title: "CEO" });
    expect(await refused(api.sign({ viewer: AMY, ...sign }))).toBe(409);
    const c = await api.contract({ viewer: AMY });
    expect(c.signed).toMatchObject({ name: "Amy Adams", title: "CEO", email: "amy@acme.example" });
    const [row] = await pg.db.execute<{ signed_ip: string; signed_agent: string }>(
      sql`select signed_ip, signed_agent from delivery.agreements`,
    );
    expect(row).toEqual({ signed_ip: FROM.ip, signed_agent: FROM.agent });
  });

  it("access is granted, declined with a reason, or taken back; never another client's", async () => {
    expect(await refused(api.access({ viewer: MO, accessId, status: "declined" }))).toBe(400);
    expect(await refused(api.access({ viewer: MO, accessId, status: "open" }))).toBe(400);
    expect(await refused(api.access({ viewer: BO, accessId, status: "granted" }))).toBe(404);
    await api.access({ viewer: MO, accessId, status: "declined", note: "IT says no" });
    const [e] = (await api.home({ viewer: AMY })).engagements;
    expect(e?.paperwork.access.find((a) => a.id === accessId)).toMatchObject({
      status: "declined",
      note: "IT says no",
      answeredBy: "mo@acme.example",
    });
  });

  it("signed alone isn't enough: the setup fee paid starts the plan from today", async () => {
    expect((await engagementOf(pg.db, "acme")).status).toBe("onboarding");
    const e = await engagementOf(pg.db, "acme");
    await addInvoice(pg.db, e, {
      number: "W-1",
      description: "Setup",
      cents: 100_000,
      dueOn: "2026-12-01",
      setup: true,
      by: "ops@wren.example",
    });
    await markInvoice(pg.db, "acme", "W-1", "paid");
    const started = await engagementOf(pg.db, "acme");
    expect(started.status).toBe("active");
    expect(started.startsOn).toBe(todayUtc());
    const [view] = (await api.home({ viewer: AMY })).engagements;
    expect(view?.steps[0]?.plannedFrom).toBe(todayUtc());
    expect(view?.paperwork.setupPaid).toBe(true);
  });

  it("can't onboard the same offer while it runs", async () => {
    await expect(
      onboard(pg.db, {
        clientId: "acme",
        offerId: "reactivation",
        startsOn: "2026-11-01",
        by: "ops@wren.example",
      }),
    ).rejects.toThrow(/already running/);
  });
});

describe("the watch", () => {
  it("mails the signed copy to the signer, owners and Wren, once", async () => {
    await pass();
    const copies = mail.filter((m) => m.subject.includes("signed contract"));
    expect(copies.map((m) => m.to).sort()).toEqual(["amy@acme.example", WREN_PARTY.email].sort());
    expect(copies[0]?.text).toContain("Amy Adams, CEO");
    expect(copies[0]?.text).toContain(FROM.ip);
    mail.splice(0);
    await pass();
    expect(mail.filter((m) => m.subject.includes("signed contract"))).toEqual([]);
  });

  it("pings about declined access, and a contract left unsigned", async () => {
    expect(pinged.join("\n")).toContain("declined access to Your ATS");
    pinged.splice(0);
    await onboard(pg.db, {
      clientId: "beta",
      offerId: "reactivation",
      startsOn: "2026-11-01",
      terms: { setupCents: 0 },
      by: "ops@wren.example",
    });
    await pg.db.execute(sql`update delivery.agreements set issued_at = now() - interval '4 days'
      where signed_at is null`);
    await pass();
    expect(pinged.join("\n")).toMatch(/beta: contract unsigned since/);
  });

  it("no setup fee: signing alone starts it", async () => {
    const { sha256 } = await api.contract({ viewer: BO });
    await api.sign({ viewer: BO, sha256, name: "Bo Brown", agreed: true });
    expect((await engagementOf(pg.db, "beta")).status).toBe("active");
  });
});
