/**
 * The reverse gate: a setup fee refunded in full or lost to a chargeback pauses a running
 * plan; a partial refund doesn't; an open dispute only flags. Nothing resumes by itself.
 */
import { clients } from "@wren/core/clients";
import type { Notifier } from "@wren/core/notify";
import { serializable } from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addInvoice,
  DeliveryRefusal,
  disputeInvoice,
  markInvoice,
  onboard,
  refundInvoice,
  setEngagementStatus,
  signAgreement,
  startEngagement,
} from "../../src/index.js";
import { type PortalMail, watchPass } from "../../src/watch.js";

let pg: TestPostgres;

const BY = "ops@wren.example";
const pinged: { title: string; body: string }[] = [];
const notifier: Notifier = {
  name: "test",
  notify: async (title, body = "") => {
    pinged.push({ title, body });
    return true;
  },
};
const pass = (at: string) =>
  watchPass(
    {
      main: pg.db,
      send: async (_m: PortalMail) => {},
      app: "https://app.example",
      zone: "UTC",
      notifier,
    },
    new Date(at),
  );

async function refused(p: Promise<unknown>): Promise<number> {
  try {
    await p;
  } catch (err) {
    if (err instanceof DeliveryRefusal) return err.status;
    throw err;
  }
  throw new Error("expected a refusal");
}

/** A client with a running plan and its setup fee paid (invoice `<id>-S`, 1000.00). */
async function running(id: string) {
  await pg.db.insert(clients).values({ id, name: `Client ${id}`, database: `wren_client_${id}` });
  const e = await startEngagement(pg.db, {
    clientId: id,
    offerId: "reactivation",
    startsOn: "2026-10-05",
    by: BY,
    status: "active",
  });
  await addInvoice(pg.db, e, {
    number: `${id}-S`,
    description: "Setup",
    cents: 100_000,
    dueOn: "2026-12-01",
    setup: true,
    by: BY,
  });
  await markInvoice(pg.db, id, `${id}-S`, "paid");
  return e;
}

/** The client's newest engagement status (a paused one isn't "running", so no `engagementOf`). */
const statusOf = async (id: string) =>
  (
    await pg.db.execute<{ status: string }>(
      sql`select status from delivery.engagements where client_id = ${id} order by id desc limit 1`,
    )
  )[0]?.status;
const notes = async (id: string) =>
  pg.db.execute<{ body: string; author: string; internal: boolean }>(
    sql`select u.body, u.author, u.internal from delivery.updates u
        join delivery.engagements e on e.id = u.engagement_id
        where e.client_id = ${id} and u.body like 'Paused:%'`,
  );

beforeAll(async () => {
  pg = await startTestPostgres();
});

afterAll(async () => {
  await pg?.stop();
});

describe("the reverse gate", () => {
  it("a setup fee refunded in full pauses the plan, and says why to the team only", async () => {
    await running("full");
    expect(await statusOf("full")).toBe("active");
    const r = await refundInvoice(pg.db, "full", "full-S", 100_000, BY);
    expect(r).toMatchObject({ paused: true, invoice: { refundedCents: 100_000 } });
    expect(await statusOf("full")).toBe("paused");
    const [note, ...rest] = await notes("full");
    expect(rest).toEqual([]);
    expect(note).toMatchObject({ author: BY, internal: true });
    expect(note?.body).toContain("full-S was refunded in full");
    // It stays down until someone resumes it: clearing the refund doesn't.
    expect((await refundInvoice(pg.db, "full", "full-S", 0, BY)).paused).toBe(false);
    expect(await statusOf("full")).toBe("paused");
    const [{ id } = { id: 0 }] = await pg.db.execute<{ id: number }>(
      sql`select id from delivery.engagements where client_id = 'full'`,
    );
    await setEngagementStatus(pg.db, "full", id, "active");
    expect(await statusOf("full")).toBe("active");
  });

  it("a partial refund doesn't, however it grows, until it is all of it", async () => {
    await running("part");
    expect((await refundInvoice(pg.db, "part", "part-S", 99_999, BY)).paused).toBe(false);
    expect(await statusOf("part")).toBe("active");
    expect((await refundInvoice(pg.db, "part", "part-S", 100_000, BY)).paused).toBe(true);
    expect(await statusOf("part")).toBe("paused");
  });

  it("a lost dispute pauses; a won one doesn't; an open one only flags", async () => {
    await running("lost");
    await running("won");
    await running("open");
    expect((await disputeInvoice(pg.db, "open", "open-S", "open", BY)).paused).toBe(false);
    expect((await disputeInvoice(pg.db, "won", "won-S", "open", BY)).paused).toBe(false);
    expect((await disputeInvoice(pg.db, "won", "won-S", "won", BY)).paused).toBe(false);
    expect((await disputeInvoice(pg.db, "lost", "lost-S", "open", BY)).paused).toBe(false);
    expect((await disputeInvoice(pg.db, "lost", "lost-S", "lost", BY)).paused).toBe(true);
    expect(await statusOf("lost")).toBe("paused");
    expect((await notes("lost"))[0]?.body).toContain("lost to a chargeback");
    expect(await statusOf("won")).toBe("active");
    expect(await statusOf("open")).toBe("active");
  });

  it("an open dispute is flagged now, and the flag goes when it is decided", async () => {
    const flagged = async () =>
      pg.db.execute<{ client_id: string; urgent: boolean; what: string }>(
        sql`select client_id, urgent, what from delivery.flags
            where cause like 'dispute:%' and cleared_at is null`,
      );
    await pass("2026-10-14T20:30:00Z");
    const [f, ...rest] = await flagged();
    expect(rest).toEqual([]);
    expect(f).toMatchObject({ client_id: "open", urgent: true });
    expect(f?.what).toContain("open-S");
    expect(pinged.some((p) => p.body.includes("disputed with the card issuer"))).toBe(true);
    await disputeInvoice(pg.db, "open", "open-S", "won", BY);
    await pass("2026-10-14T20:50:00Z");
    expect(await flagged()).toEqual([]);
    expect(await statusOf("open")).toBe("active");
  });

  it("only a paid invoice can be refunded or disputed, by up to what it was", async () => {
    const e = await running("odd");
    await addInvoice(pg.db, e, {
      number: "odd-M",
      description: "Month",
      cents: 30_000,
      dueOn: "2026-12-01",
      by: BY,
    });
    expect(await refused(refundInvoice(pg.db, "odd", "odd-M", 1_000, BY))).toBe(409);
    expect(await refused(disputeInvoice(pg.db, "odd", "odd-M", "open", BY))).toBe(409);
    expect(await refused(refundInvoice(pg.db, "odd", "odd-S", 100_001, BY))).toBe(400);
    expect(await refused(refundInvoice(pg.db, "odd", "odd-S", -1, BY))).toBe(400);
    expect(await refused(refundInvoice(pg.db, "odd", "nope", 1, BY))).toBe(404);
    expect(await refused(refundInvoice(pg.db, "full", "odd-S", 1, BY))).toBe(404);
    // Not the setup fee: recorded, never a pause.
    await markInvoice(pg.db, "odd", "odd-M", "paid");
    const r = await refundInvoice(pg.db, "odd", "odd-M", 30_000, BY);
    expect(r).toMatchObject({ paused: false, invoice: { refundedCents: 30_000 } });
    expect((await disputeInvoice(pg.db, "odd", "odd-M", "lost", BY)).paused).toBe(false);
    expect(await statusOf("odd")).toBe("active");
  });

  it("a plan still onboarding doesn't start on a fee that was handed back", async () => {
    await pg.db
      .insert(clients)
      .values({ id: "late", name: "Client late", database: "wren_client_late" });
    const { engagement, agreement } = await onboard(pg.db, {
      clientId: "late",
      offerId: "reactivation",
      startsOn: "2026-10-05",
      terms: { setupCents: 100_000 },
      by: BY,
    });
    await addInvoice(pg.db, engagement, {
      number: "late-S",
      description: "Setup",
      cents: 100_000,
      dueOn: "2026-12-01",
      setup: true,
      by: BY,
    });
    await markInvoice(pg.db, "late", "late-S", "paid");
    await refundInvoice(pg.db, "late", "late-S", 100_000, BY);
    await signAgreement(pg.db, engagement, {
      sha256: agreement.sha256,
      name: "Lee Late",
      email: "lee@late.example",
      agreed: true,
    });
    expect(await statusOf("late")).toBe("onboarding");
    // Undone, the same payment starts it on the next look.
    await refundInvoice(pg.db, "late", "late-S", 0, BY);
    await markInvoice(pg.db, "late", "late-S", "paid");
    expect(await statusOf("late")).toBe("active");
  });

  it("the audit log holds who did it, the refund and the pause", async () => {
    await running("trail");
    await serializable(pg.db, (tx) =>
      refundInvoice(tx, "trail", "trail-S", 100_000, "amy@wren.example"),
    );
    const rows = await pg.db.execute<{ actor: string; table_name: string }>(
      sql`select distinct table_name, actor from audit_events
          where actor = 'amy@wren.example' and table_name like 'delivery.%'`,
    );
    expect(rows.map((r) => r.table_name).sort()).toEqual([
      "delivery.engagements",
      "delivery.invoices",
      "delivery.updates",
    ]);
  });
});
