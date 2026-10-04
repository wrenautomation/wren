/**
 * Delivery over the portal API, as an operator, two clients' logins and the
 * demo: the plan is dated from the start day, a client never sees an internal
 * or hidden update, and no id of one client's reaches another's.
 */
import { addMember, clients } from "@wren/core/clients";
import { PortalRefusal, type Viewer } from "@wren/core/portal";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FileStore } from "../../src/files.js";
import {
  addInvoice,
  DeliveryRefusal,
  deliveryHome,
  engagementOf,
  markInvoice,
  postUpdate,
  startEngagement,
} from "../../src/index.js";
import { deliveryApi } from "../../src/service.js";

let pg: TestPostgres;
let api: ReturnType<typeof deliveryApi>;

const OPS: Viewer = { email: "ops@wren.example", operator: true };
const AMY: Viewer = { email: "amy@acme.example" };
const BO: Viewer = { email: "bo@beta.example" };
const DEMO: Viewer = { demo: true };
const START = "2026-10-05";
/** Signs nothing: a URL that names what it would sign. */
const FILES: FileStore = {
  putUrl: async (key, type, size) => `https://files.example/put/${key}?type=${type}&size=${size}`,
  getUrl: async (key) => `https://files.example/get/${key}`,
  put: async () => {},
};

/** The status a call was refused with. */
async function refused(p: Promise<unknown>): Promise<number> {
  try {
    await p;
  } catch (err) {
    if (err instanceof PortalRefusal) return err.status;
    throw err;
  }
  throw new Error("expected a refusal");
}

const acme = { client: "acme" };
const beta = { client: "beta" };
/** What we billed, as Billing reads it: the `delivery.invoice` record, newest first (a day's by id). */
const bills = (viewer: Viewer, more: { client?: string } = {}) =>
  api.recordsList({ viewer, ...more, record: "delivery.invoice", view: "all" });
let acmeAsk = 0;
let betaAsk = 0;
let acmeDeliverable = 0;
let betaDeliverable = 0;
let acmeUpdate = 0;

beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.db.insert(clients).values([
    { id: "acme", name: "Acme Staffing", database: "wren_client_acme" },
    { id: "beta", name: "Beta Search", database: "wren_client_beta" },
    { id: "demo", name: "Northside Talent", database: "wren_client_demo", demo: true },
  ]);
  await addMember(pg.db, "acme", "amy@acme.example", { role: "owner" });
  await addMember(pg.db, "beta", "bo@beta.example", { role: "owner" });
  api = deliveryApi({ main: pg.db, demoName: "Demo recruiting firm", files: FILES });

  await api.start({ viewer: OPS, ...acme, offerId: "reactivation", startsOn: START });
  await api.start({ viewer: OPS, ...beta, offerId: "reactivation", startsOn: START });
  const [a] = (await api.home({ viewer: AMY })).engagements[0]?.asks ?? [];
  const [b] = (await api.home({ viewer: BO })).engagements[0]?.asks ?? [];
  acmeAsk = a?.id ?? 0;
  betaAsk = b?.id ?? 0;
  acmeDeliverable = (
    await api.deliver({
      viewer: OPS,
      ...acme,
      title: "Cleaned list",
      kind: "link",
      url: "https://docs.example.com/acme",
      step: "set-up",
    })
  ).id;
  betaDeliverable = (
    await api.deliver({
      viewer: OPS,
      ...beta,
      title: "Cleaned list",
      kind: "link",
      url: "https://docs.example.com/beta",
    })
  ).id;
  acmeUpdate = (await api.post({ viewer: OPS, ...acme, body: "Kickoff booked for Tuesday." })).id;
  await api.post({ viewer: OPS, ...acme, body: "Their ATS export is a mess.", internal: true });
});

afterAll(async () => {
  await pg?.stop();
});

describe("starting an engagement", () => {
  it("dates each step from the plan's weeks", async () => {
    const [e] = (await api.home({ viewer: AMY })).engagements;
    expect(e?.offer).toMatchObject({ id: "reactivation", name: "Lead reactivation" });
    expect(e?.steps.map((s) => [s.key, s.plannedFrom, s.plannedTo, s.dueOn])).toEqual([
      ["set-up", "2026-10-05", "2026-10-18", "2026-10-18"],
      ["approve", "2026-10-12", "2026-10-25", "2026-10-25"],
      ["send", "2026-10-19", "2027-01-03", "2027-01-03"],
      ["wrap-up", "2026-12-28", "2027-01-03", "2027-01-03"],
    ]);
  });

  it("opens the plan's asks, due at the end of their step's first week", async () => {
    const [e] = (await api.home({ viewer: AMY })).engagements;
    const due = Object.fromEntries((e?.asks ?? []).map((a) => [a.text, [a.step, a.dueOn]]));
    expect(due["The recruiter whose name and signature go on the emails"]).toEqual([
      "set-up",
      "2026-10-11",
    ]);
    expect(due["Approve the first emails in your portal"]).toEqual(["approve", "2026-10-18"]);
    expect(e?.asks).toHaveLength(5);
  });

  it("states each step against today", async () => {
    const home = await deliveryHome(pg.db, "acme", { operator: false, today: "2026-10-13" });
    expect(home.engagements[0]?.steps.map((s) => s.state)).toEqual(["now", "now", "next", "next"]);
    const later = await deliveryHome(pg.db, "acme", { operator: false, today: "2026-10-20" });
    expect(later.engagements[0]?.steps.map((s) => s.state)).toEqual(["late", "now", "now", "next"]);
    expect(later.engagements[0]?.asks.find((a) => a.step === "set-up")?.overdue).toBe(true);
  });

  it("refuses the same offer twice, an unknown offer and a bad day", async () => {
    expect(
      await refused(api.start({ viewer: OPS, ...acme, offerId: "reactivation", startsOn: START })),
    ).toBe(409);
    expect(
      await refused(api.start({ viewer: OPS, ...acme, offerId: "nope", startsOn: START })),
    ).toBe(404);
    expect(
      await refused(
        api.start({
          viewer: OPS,
          ...acme,
          offerId: "ops-automation-build",
          startsOn: "2026-02-30",
        }),
      ),
    ).toBe(400);
  });
});

describe("what a client sees", () => {
  it("never an internal update, on Home or the timeline", async () => {
    const home = await api.home({ viewer: AMY });
    const bodies = home.engagements[0]?.updates.map((u) => u.body);
    expect(bodies).toEqual(["Kickoff booked for Tuesday."]);
    const { updates } = await api.updates({ viewer: AMY });
    expect(updates.map((u) => u.body)).toEqual(["Kickoff booked for Tuesday."]);
    const ops = await api.updates({ viewer: OPS, ...acme });
    expect(ops.updates.map((u) => [u.body, u.internal])).toEqual([
      ["Their ATS export is a mess.", true],
      ["Kickoff booked for Tuesday.", false],
    ]);
    // "View as client": the operator sees exactly what Amy sees.
    const asClient = await api.home({ viewer: OPS, ...acme, asClient: true });
    expect(asClient.engagements[0]?.updates.map((u) => u.body)).toEqual(bodies);
    expect((await api.me({ viewer: OPS })).operator).toBe(true);
    expect((await api.me({ viewer: AMY })).operator).toBe(false);
  });

  it("never a hidden update; the team still sees it, marked", async () => {
    const id = (await api.post({ viewer: OPS, ...acme, body: "Wrong client, oops." })).id;
    expect((await api.updates({ viewer: AMY })).updates.map((u) => u.body)).toContain(
      "Wrong client, oops.",
    );
    await api.hide({ viewer: OPS, ...acme, updateId: id });
    expect((await api.updates({ viewer: AMY })).updates.map((u) => u.body)).not.toContain(
      "Wrong client, oops.",
    );
    const ops = await api.updates({ viewer: OPS, ...acme });
    expect(ops.updates.find((u) => u.id === id)?.hidden).toBe(true);
  });

  it("pages the timeline by the last id seen", async () => {
    for (let i = 0; i < 3; i++) await api.post({ viewer: OPS, ...acme, body: `Week note ${i}` });
    const first = await api.updates({ viewer: AMY });
    expect(first.more).toBe(false);
    const older = await api.updates({ viewer: AMY, before: first.updates[1]?.id ?? 0 } as never);
    expect(older.updates.map((u) => u.body)).toEqual(first.updates.slice(2).map((u) => u.body));
  });

  it("only their own engagements", async () => {
    const home = await api.home({ viewer: BO });
    expect(home.engagements[0]?.updates).toEqual([]);
    expect(home.engagements[0]?.deliverables.map((d) => d.url)).toEqual([
      "https://docs.example.com/beta",
    ]);
  });
});

describe("one client's ids never reach another's", () => {
  it("answer, decide and hide refuse another client's row as not found", async () => {
    expect(await refused(api.answer({ viewer: AMY, askId: betaAsk, answer: "x" }))).toBe(404);
    expect(
      await refused(
        api.decide({ viewer: AMY, deliverableId: betaDeliverable, decision: "approved" }),
      ),
    ).toBe(404);
    expect(await refused(api.hide({ viewer: OPS, ...beta, updateId: acmeUpdate }))).toBe(404);
    const [b] = (await api.home({ viewer: BO })).engagements[0]?.deliverables ?? [];
    expect(b?.status).toBe("waiting");
  });

  it("a new version can't replace another client's deliverable", async () => {
    expect(
      await refused(
        api.deliver({
          viewer: OPS,
          ...acme,
          title: "v2",
          kind: "link",
          url: "https://docs.example.com/v2",
          replaces: betaDeliverable,
        }),
      ),
    ).toBe(404);
  });

  it("a login without the client is refused, whatever it names", async () => {
    expect(await refused(api.home({ viewer: AMY, ...beta }))).toBe(403);
    expect(await refused(api.home({ viewer: { email: "x@nowhere.example" } }))).toBe(403);
  });

  it("ids that aren't ids are not found", async () => {
    for (const askId of [0, -1, 1.5, "1 or 1=1", null, {}] as unknown[])
      expect(await refused(api.answer({ viewer: AMY, askId: askId as number, answer: "x" }))).toBe(
        404,
      );
  });
});

describe("who may write", () => {
  it("a client answers and decides; the rest is the team's", async () => {
    const a = await api.answer({ viewer: AMY, askId: acmeAsk, answer: "Attached in the email." });
    expect(a.answeredAt).not.toBeNull();
    expect(
      await refused(
        api.decide({ viewer: AMY, deliverableId: acmeDeliverable, decision: "changes" }),
      ),
    ).toBe(400);
    const d = await api.decide({
      viewer: AMY,
      deliverableId: acmeDeliverable,
      decision: "changes",
      note: "Drop the 2019 contacts.",
    });
    expect(d.status).toBe("changes");
    for (const write of [
      () => api.post({ viewer: AMY, body: "hi" }),
      () => api.deliver({ viewer: AMY, title: "t", kind: "link", url: "https://x.example.com" }),
      () => api.ask({ viewer: AMY, text: "t" }),
      () => api.done({ viewer: AMY, step: "set-up" }),
      () => api.slip({ viewer: AMY, step: "set-up", to: "2026-11-01", reason: "r" }),
      () => api.result({ viewer: AMY, key: "replies", value: 1 }),
      () => api.hide({ viewer: AMY, updateId: acmeUpdate }),
      () => api.start({ viewer: AMY, offerId: "reactivation", startsOn: START }),
    ])
      expect(await refused(write())).toBe(403);
  });

  it("logs every write as the person who made it", async () => {
    const rows = await pg.db.execute<{ table_name: string; actor: string | null }>(
      sql`select table_name, actor from audit_events where table_name like 'delivery.%' order by id`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(
      rows.every((r) => r.actor === "ops@wren.example" || r.actor === "amy@acme.example"),
    ).toBe(true);
    expect(
      rows.find((r) => r.table_name === "delivery.asks" && r.actor === "amy@acme.example"),
    ).toBeTruthy();
  });

  it("a new version waits again and Home shows only it", async () => {
    const v2 = await api.deliver({
      viewer: OPS,
      ...acme,
      title: "Cleaned list",
      kind: "link",
      url: "https://docs.example.com/acme-v2",
      replaces: acmeDeliverable,
    });
    expect(v2.version).toBe(2);
    const ds = (await api.home({ viewer: AMY })).engagements[0]?.deliverables ?? [];
    expect(ds.map((d) => [d.id, d.version, d.status, d.step])).toEqual([
      [v2.id, 2, "waiting", "set-up"],
    ]);
  });
});

describe("what the team's writes take", () => {
  it("https links only, Loom links from Loom", async () => {
    const link = (kind: string, url: string) =>
      api.deliver({ viewer: OPS, ...acme, title: "t", kind, url });
    expect(await refused(link("link", "javascript:alert(1)"))).toBe(400);
    expect(await refused(link("link", "http://docs.example.com"))).toBe(400);
    expect(await refused(link("link", "not a url"))).toBe(400);
    expect(await refused(link("loom", "https://evil.example.com/share/x"))).toBe(400);
    expect(await refused(link("loom", "https://loom.com.evil.example/share/x"))).toBe(400);
    expect(await refused(link("video", "https://www.loom.com/share/x"))).toBe(400);
    expect((await link("loom", "https://www.loom.com/share/abc")).version).toBe(1);
  });

  it("files only from the client's own folder", async () => {
    const file = (fileKey: string) =>
      api.deliver({ viewer: OPS, ...acme, title: "t", kind: "file", fileKey });
    expect(await refused(file("clients/beta/list.csv"))).toBe(400);
    expect(await refused(file("clients/acme/../beta/list.csv"))).toBe(400);
    expect(await refused(file("list.csv"))).toBe(400);
    expect((await file("clients/acme/list.csv")).version).toBe(1);
  });

  it("results only for the offer's measures, numbers only", async () => {
    await api.result({ viewer: OPS, ...acme, key: "replies", value: 12 });
    await api.result({ viewer: OPS, ...acme, key: "replies", value: 14, note: "two late" });
    expect(await refused(api.result({ viewer: OPS, ...acme, key: "revenue", value: 1 }))).toBe(400);
    expect(
      await refused(api.result({ viewer: OPS, ...acme, key: "replies", value: "9" as never })),
    ).toBe(400);
    expect(
      await refused(api.result({ viewer: OPS, ...acme, key: "replies", value: Number.NaN })),
    ).toBe(400);
    const rs = (await api.home({ viewer: AMY })).engagements[0]?.results ?? [];
    expect(rs.find((r) => r.key === "replies")).toMatchObject({ value: 14, note: "two late" });
    expect(rs.find((r) => r.key === "meetings")?.value).toBeNull();
  });

  it("a slip keeps the planned dates and says why; done marks the step", async () => {
    await api.slip({
      viewer: OPS,
      ...acme,
      step: "approve",
      to: "2026-11-01",
      reason: "Late export.",
    });
    expect(
      await refused(
        api.slip({ viewer: OPS, ...acme, step: "approve", to: "2026-10-01", reason: "r" }),
      ),
    ).toBe(400);
    expect(
      await refused(
        api.slip({ viewer: OPS, ...acme, step: "nope", to: "2026-11-01", reason: "r" }),
      ),
    ).toBe(404);
    await api.done({ viewer: OPS, ...acme, step: "set-up", on: "2026-10-17" });
    const home = await deliveryHome(pg.db, "acme", { operator: false, today: "2026-10-27" });
    const [setUp, approve] = home.engagements[0]?.steps ?? [];
    expect(setUp).toMatchObject({ state: "done", doneOn: "2026-10-17" });
    expect(approve).toMatchObject({
      plannedTo: "2026-10-25",
      dueOn: "2026-11-01",
      slipReason: "Late export.",
      state: "now",
    });
    await api.done({ viewer: OPS, ...acme, step: "set-up", on: null });
    const undone = await deliveryHome(pg.db, "acme", { operator: false, today: "2026-10-27" });
    expect(undone.engagements[0]?.steps[0]?.state).toBe("late");
  });

  it("asks take a real day", async () => {
    expect(await refused(api.ask({ viewer: OPS, ...acme, text: "t", dueOn: "next week" }))).toBe(
      400,
    );
    expect(await refused(api.ask({ viewer: OPS, ...acme, text: "  " }))).toBe(400);
    expect(
      (await api.ask({ viewer: OPS, ...acme, text: "Logo file", dueOn: "2026-10-20" })).id,
    ).toBeGreaterThan(0);
  });
});

describe("files", () => {
  const PDF = { name: "Q3 report (final).pdf", type: "application/pdf", size: 2048 };
  it("signs an upload into the client's own folder, only for taken types and sizes", async () => {
    const up = await api.upload({ viewer: AMY, ...PDF });
    expect(up.key).toMatch(/^clients\/acme\/\d{4}-\d{2}-\d{2}\/[0-9a-f]{8}-Q3-report-final-.pdf$/);
    expect(up.url).toContain("size=2048");
    expect(await refused(api.upload({ viewer: AMY, ...PDF, type: "text/html" }))).toBe(400);
    expect(await refused(api.upload({ viewer: AMY, ...PDF, size: 51 * 1024 * 1024 }))).toBe(400);
    expect(await refused(api.upload({ viewer: AMY, ...PDF, size: 0 }))).toBe(400);
    expect(await refused(api.upload({ viewer: DEMO, ...PDF }))).toBe(403);
    const bare = deliveryApi({ main: pg.db, demoName: "x" });
    expect(await refused(bare.upload({ viewer: AMY, ...PDF }))).toBe(409);
  });

  it("a file handed over or answered with downloads for its client only", async () => {
    const theirs = await api.upload({ viewer: OPS, ...acme, ...PDF });
    const d = await api.deliver({
      viewer: OPS,
      ...acme,
      title: "Report",
      kind: "file",
      fileKey: theirs.key,
    });
    const home = await api.home({ viewer: AMY });
    expect(home.engagements[0]?.deliverables.find((x) => x.id === d.id)?.file).toBe(
      "Q3-report-final-.pdf",
    );
    expect((await api.file({ viewer: AMY, deliverableId: d.id })).url).toBe(
      `https://files.example/get/${theirs.key}`,
    );
    expect(await refused(api.file({ viewer: BO, deliverableId: d.id }))).toBe(404);
    expect(await refused(api.file({ viewer: AMY, deliverableId: acmeDeliverable }))).toBe(404);

    const answer = await api.upload({ viewer: AMY, ...PDF, name: "export.csv", type: "text/csv" });
    const [ask] = home.engagements[0]?.asks.filter((a) => !a.answeredAt) ?? [];
    await api.answer({ viewer: AMY, askId: ask?.id ?? 0, fileKey: answer.key });
    expect((await api.file({ viewer: OPS, ...acme, askId: ask?.id ?? 0 })).url).toContain(
      answer.key,
    );
    // Another client's folder never attaches.
    const other = await api.upload({ viewer: BO, ...PDF });
    expect(
      await refused(
        api.deliver({ viewer: OPS, ...acme, title: "x", kind: "file", fileKey: other.key }),
      ),
    ).toBe(400);
  });
});

describe("people", () => {
  const CY: Viewer = { email: "cy@acme.example" };
  it("an owner invites a teammate, who then sees the project but can't invite", async () => {
    expect(await api.invite({ viewer: AMY, email: " Cy@Acme.example ", role: "member" })).toEqual({
      email: "cy@acme.example",
      role: "member",
    });
    expect((await api.me({ viewer: CY })).clients.map((c) => c.id)).toEqual(["acme"]);
    const seen = await api.people({ viewer: CY });
    expect(seen.canManage).toBe(false);
    expect(seen.people.find((p) => p.email === "cy@acme.example")?.invitedBy).toBe(
      "amy@acme.example",
    );
    expect(await refused(api.invite({ viewer: CY, email: "dee@acme.example" }))).toBe(403);
    expect(await refused(api.remove({ viewer: CY, email: "amy@acme.example" }))).toBe(403);
    expect((await api.people({ viewer: AMY })).canManage).toBe(true);
  });

  it("keeps the last owner, refuses bad emails and other clients' owners", async () => {
    expect(await refused(api.remove({ viewer: AMY, email: "amy@acme.example" }))).toBe(409);
    expect(
      await refused(api.invite({ viewer: AMY, email: "amy@acme.example", role: "member" })),
    ).toBe(409);
    expect(await refused(api.invite({ viewer: AMY, email: "not an email" }))).toBe(400);
    expect(
      await refused(api.invite({ viewer: AMY, email: "x@acme.example", role: "admin" as never })),
    ).toBe(400);
    expect(await refused(api.invite({ viewer: BO, ...acme, email: "x@beta.example" }))).toBe(403);
  });

  it("a removed teammate loses the project at once", async () => {
    expect(await api.remove({ viewer: OPS, ...acme, email: "cy@acme.example" })).toEqual({
      removed: "cy@acme.example",
    });
    expect(await refused(api.home({ viewer: CY, ...acme }))).toBe(403);
    expect(await refused(api.remove({ viewer: AMY, email: "cy@acme.example" }))).toBe(404);
  });
});

describe("comments", () => {
  it("a thread under an update and a deliverable, from both sides, oldest first", async () => {
    await api.comment({ viewer: AMY, updateId: acmeUpdate, body: "Can we do Wednesday?" });
    await api.comment({ viewer: OPS, ...acme, updateId: acmeUpdate, body: "Wednesday works." });
    const before = (await api.home({ viewer: AMY })).engagements[0]?.deliverables;
    const v2 = before?.find((x) => x.title === "Cleaned list")?.id ?? 0;
    await api.comment({ viewer: AMY, deliverableId: v2, body: "Looks right." });
    // A new version takes the thread with it.
    const v3 = (
      await api.deliver({
        viewer: OPS,
        ...acme,
        title: "Cleaned list",
        kind: "link",
        url: "https://docs.example.com/acme-v3",
        replaces: v2,
      })
    ).id;
    const e = (await api.home({ viewer: AMY })).engagements[0];
    const u = e?.updates.find((x) => x.id === acmeUpdate);
    expect(u?.comments.map((c) => [c.author, c.fromWren, c.body])).toEqual([
      ["amy@acme.example", false, "Can we do Wednesday?"],
      ["ops@wren.example", true, "Wednesday works."],
    ]);
    const d = e?.deliverables.find((x) => x.id === v3);
    expect(d?.comments.map((c) => c.body)).toEqual(["Looks right."]);
    const page = await api.updates({ viewer: AMY });
    expect(page.updates.find((x) => x.id === acmeUpdate)?.comments).toHaveLength(2);
  });

  it("none under an internal or hidden update, or another client's row, or empty", async () => {
    const ops = await api.updates({ viewer: OPS, ...acme });
    const internal = ops.updates.find((x) => x.internal)?.id ?? 0;
    const hidden = ops.updates.find((x) => x.hidden)?.id ?? 0;
    for (const updateId of [internal, hidden])
      expect(await refused(api.comment({ viewer: OPS, ...acme, updateId, body: "x" }))).toBe(404);
    expect(
      await refused(api.comment({ viewer: AMY, deliverableId: betaDeliverable, body: "x" })),
    ).toBe(404);
    expect(await refused(api.comment({ viewer: BO, updateId: acmeUpdate, body: "x" }))).toBe(404);
    expect(await refused(api.comment({ viewer: AMY, updateId: acmeUpdate, body: " " }))).toBe(400);
  });
});

describe("billing and the account", () => {
  const CY: Viewer = { email: "cy@acme.example" };
  const bill = async (number: string, over: Partial<Parameters<typeof addInvoice>[2]> = {}) =>
    addInvoice(pg.db, await engagementOf(pg.db, "acme"), {
      number,
      description: "Setup",
      cents: 100_000,
      issuedOn: "2026-09-01",
      dueOn: "2026-09-15",
      link: "https://wise.com/pay/r/abc",
      by: "ops@wren.example",
      ...over,
    });
  const status = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (err) {
      if (err instanceof DeliveryRefusal) return err.status;
      throw err;
    }
    throw new Error("expected a refusal");
  };

  it("an owner sees what we billed, late ones as overdue; a member and another client don't", async () => {
    await bill("WREN-1");
    await bill("WREN-2", {
      description: "Meetings booked in October",
      cents: 250_050,
      dueOn: "2099-01-01",
    });
    const seen = (await bills(AMY)).rows;
    expect(seen.map((i) => [i.number, i.status, i.amount, i.offer])).toEqual([
      ["WREN-1", "overdue", { amount: 1000, currency: "USD" }, "Lead reactivation"],
      ["WREN-2", "open", { amount: 2500.5, currency: "USD" }, "Lead reactivation"],
    ]);
    expect((await bills(OPS, acme)).rows).toHaveLength(2);
    expect((await bills(OPS, beta)).rows).toEqual([]);
    await addMember(pg.db, "acme", "cy@acme.example");
    expect(await refused(bills(CY))).toBe(403);
    expect(await refused(bills(BO, acme))).toBe(403);
  });

  it("paid, void and open again; never another client's", async () => {
    expect((await markInvoice(pg.db, "acme", "WREN-1", "paid", "2026-10-20")).paidOn).toBe(
      "2026-10-20",
    );
    expect((await bills(AMY)).rows[0]?.status).toBe("paid");
    expect((await markInvoice(pg.db, "acme", "WREN-1", "open")).paidOn).toBeNull();
    expect((await markInvoice(pg.db, "acme", "WREN-1", "void")).status).toBe("void");
    expect(await status(markInvoice(pg.db, "beta", "WREN-1", "paid"))).toBe(404);
    expect(await status(markInvoice(pg.db, "acme", "WREN-1", "gone"))).toBe(400);
  });

  it("refuses a number twice, a bad amount, currency, dates or link", async () => {
    expect(await status(bill("WREN-1"))).toBe(409);
    for (const over of [
      { cents: 0 },
      { cents: 10.5 },
      { currency: "dollars" },
      { dueOn: "2026-08-31" },
      { dueOn: "soon" },
      { link: "javascript:alert(1)" },
      { description: " " },
    ])
      expect(await status(bill("WREN-9", over))).toBe(400);
  });

  it("the account: who they are, what they bought, billing for owners only", async () => {
    const a = await api.account({ viewer: AMY });
    expect(a).toMatchObject({
      name: "Acme Staffing",
      you: { email: "amy@acme.example", role: "owner", wren: false },
      owners: ["amy@acme.example"],
      billing: { open: 1, overdue: 0 },
    });
    expect(a.bought.map((b) => [b.offer, b.startsOn, b.status])).toEqual([
      ["Lead reactivation", START, "active"],
    ]);
    expect((await api.account({ viewer: CY })).billing).toBeNull();
    expect((await api.account({ viewer: OPS, ...acme })).you).toEqual({
      email: "ops@wren.example",
      role: null,
      wren: true,
    });
    expect(await refused(api.account({ viewer: BO, ...acme }))).toBe(403);
    await api.remove({ viewer: AMY, email: "cy@acme.example" });
  });
});

describe("the demo", () => {
  beforeAll(async () => {
    const e = await startEngagement(pg.db, {
      clientId: "demo",
      offerId: "reactivation",
      startsOn: START,
      by: "seed",
    });
    await postUpdate(pg.db, e, { body: "List cleaned: 1,204 contacts.", author: "seed" });
    await postUpdate(pg.db, e, { body: "Internal only.", author: "seed", internal: true });
  });

  it("reads the sample under its demo name, without internal notes", async () => {
    expect(await api.me({ viewer: DEMO })).toEqual({
      clients: [{ id: "demo", name: "Demo recruiting firm", demo: true }],
      demo: true,
      operator: false,
    });
    const home = await api.home({ viewer: DEMO });
    expect(home.engagements[0]?.updates.map((u) => u.body)).toEqual([
      "List cleaned: 1,204 contacts.",
    ]);
    expect(await api.account({ viewer: DEMO })).toMatchObject({
      name: "Demo recruiting firm",
      people: 0,
      billing: null,
    });
    expect(await refused(bills(DEMO))).toBe(403);
  });

  it("writes nothing, even as an operator naming the demo client", async () => {
    const [ask] = (await api.home({ viewer: DEMO })).engagements[0]?.asks ?? [];
    expect(await refused(api.answer({ viewer: DEMO, askId: ask?.id ?? 0, answer: "x" }))).toBe(403);
    expect(await refused(api.post({ viewer: DEMO, body: "x" }))).toBe(403);
    expect(await refused(api.comment({ viewer: DEMO, updateId: 1, body: "x" }))).toBe(403);
    expect(await refused(api.post({ viewer: OPS, client: "demo", body: "x" }))).toBe(403);
    expect(await refused(api.invite({ viewer: DEMO, email: "x@y.example" }))).toBe(403);
    expect(await api.people({ viewer: DEMO })).toEqual({
      people: [],
      canManage: false,
      mail: null,
    });
  });

  it("is never among a client's or a stranger's clients", async () => {
    expect((await api.me({ viewer: AMY })).clients.map((c) => c.id)).toEqual(["acme"]);
    expect((await api.me({ viewer: OPS })).clients.map((c) => c.id)).toEqual([
      "acme",
      "beta",
      "demo",
    ]);
  });
});

describe("every route a client reads", () => {
  it("carries no internal or hidden note, and nothing of another client's", async () => {
    await api.post({ viewer: OPS, ...acme, body: "INTERNAL-ZQ acme", internal: true });
    const hidden = await api.post({ viewer: OPS, ...acme, body: "HIDDEN-ZQ acme" });
    await api.hide({ viewer: OPS, ...acme, updateId: hidden.id });
    await api.post({ viewer: OPS, ...beta, body: "BETA-ZQ only" });
    const walk = async (viewer: Viewer) =>
      JSON.stringify(
        await Promise.all([
          api.me({ viewer }),
          api.home({ viewer }),
          api.updates({ viewer }),
          api.account({ viewer }),
          bills(viewer).catch(() => null),
          api.people({ viewer }),
          api.contract({ viewer }).catch(() => null),
        ]),
      );
    const amy = await walk(AMY);
    expect(amy).not.toMatch(/INTERNAL-ZQ|HIDDEN-ZQ|BETA-ZQ|bo@beta/);
    const bo = await walk(BO);
    expect(bo).toContain("BETA-ZQ");
    expect(bo).not.toMatch(/ZQ acme|amy@acme/);
  });
});

describe("the project as records", () => {
  const list = (viewer: Viewer, record: string, more: Record<string, unknown> = {}) =>
    api.recordsList({ viewer, ...more, record } as Parameters<typeof api.recordsList>[0]);

  it("the plan's steps in order, keyed by project and step", async () => {
    const [e] = (await api.home({ viewer: AMY })).engagements;
    const { rows } = await list(AMY, "delivery.step", { view: "all" });
    expect(rows.map((r) => r.id)).toEqual(
      ["set-up", "approve", "send", "wrap-up"].map((k) => `${e?.id}.${k}`),
    );
  });

  it("a client never reads a team note; the team sees who sees each", async () => {
    const amy = JSON.stringify((await list(AMY, "delivery.update", { view: "all" })).rows);
    expect(amy).toContain("Kickoff booked");
    expect(amy).not.toContain("ATS export");
    const ops = (await list(OPS, "delivery.update", { ...acme, view: "all" })).rows;
    expect(ops.find((r) => String(r.body).includes("ATS export"))?.seen).toBe("team");
  });

  it("only the asking app's projects, and never another client's row", async () => {
    expect((await list(AMY, "delivery.step", { app: "reactivation" })).total).toBe(4);
    expect((await list(AMY, "delivery.step", { app: "elsewhere" })).total).toBe(0);
    expect(
      await refused(
        api.recordsGet({ viewer: AMY, record: "delivery.deliverable", id: betaDeliverable }),
      ),
    ).toBe(404);
    const got = await api.recordsGet({ viewer: AMY, record: "delivery.ask", id: acmeAsk });
    expect(got.detail).toMatchObject({ id: acmeAsk });
  });
});
