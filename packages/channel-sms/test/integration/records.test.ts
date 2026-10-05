/**
 * `marketing.text_contact` against Postgres: texts counted as `SmsDesk/stats` counts them, the
 * newest text either way, the reply's disposition, and unread replies as waiting. Synthetic only.
 */
import { serveRecords } from "@wren/core/records/serve";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { textContactRecord, textCopyRecord } from "../../src/records.js";
import { smsContacts, smsMessages } from "../../src/schema.js";
import { fillTemplates, SEQUENCES } from "./fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});

describe("marketing.text_contact", () => {
  it("counts texts and replies, and a reply waits until read", async () => {
    const contact = (e164: string, state: "replied" | "enrolled" | "new") => ({
      e164,
      sourceKind: "test",
      basis: "published" as const,
      state,
      name: `Synthetic ${e164.slice(-2)}`,
    });
    const [a, b] = await pg.db
      .insert(smsContacts)
      .values([
        contact("+15550000001", "replied"),
        contact("+15550000002", "enrolled"),
        contact("+15550000003", "new"),
      ])
      .returning();
    const out = (contactId: number, at: string, state: "sent" | "failed" | "queued", step = 1) => ({
      contactId,
      direction: "out" as const,
      kind: "sequence" as const,
      toE164: "+15550000000",
      body: `opener ${at}`,
      step,
      state,
      providerId: state === "sent" ? `SM${at}` : null,
      sentAt: state === "queued" ? null : new Date(at),
    });
    await pg.db.insert(smsMessages).values([
      out(a!.id, "2026-01-01T10:00:00Z", "sent"),
      out(b!.id, "2026-01-01T10:00:00Z", "failed"),
      out(b!.id, "2026-01-03T10:00:00Z", "queued", 2),
      {
        contactId: a!.id,
        direction: "in",
        kind: "inbound",
        toE164: "+15550000000",
        body: "tell me more",
        state: "received",
        receivedAt: new Date("2026-01-02T10:00:00Z"),
        disposition: "interested",
        dispositionSource: "operator",
      },
    ]);

    const api = serveRecords([textContactRecord], pg.db);
    for (const v of textContactRecord.views)
      await api.list({ record: textContactRecord.id, view: v.id, limit: 9 });
    const texted = await api.list({ record: textContactRecord.id, view: "texted", limit: 9 });
    expect(
      texted.rows.map((r) => [r.sent, r.replies, r.lastText, r.disposition, r.waiting]),
    ).toEqual([
      [1, 1, "tell me more", "interested", "waiting"],
      [1, 0, "opener 2026-01-01T10:00:00Z", null, "read"],
    ]);
    expect(texted.totals.replyRate).toEqual({ n: 1, of: 2 });
    await pg.db.update(smsContacts).set({ readAt: new Date("2026-01-04T00:00:00Z") });
    const waiting = await api.list({ record: textContactRecord.id, view: "waiting", limit: 9 });
    expect(waiting.rows).toEqual([]);
  });
});

describe("marketing.text_copy", () => {
  it("lists every slot with its billed parts, and loads the sample facts", async () => {
    await fillTemplates(pg.db, {
      "recruiting-sms#1": "hi {first_name|there}, {sender} here. STOP to opt out",
    });
    const record = textCopyRecord(SEQUENCES.values(), "William");
    const api = serveRecords([record], pg.db);
    for (const v of record.views) await api.list({ record: record.id, view: v.id, limit: 50 });
    const all = await api.list({ record: record.id, view: "all", limit: 50 });
    const first = all.rows.find((r) => r.id === "recruiting-sms#1");
    expect(first).toMatchObject({ filled: "filled", parts: 1 });
    const empty = await api.list({ record: record.id, view: "empty", limit: 50 });
    expect(empty.rows.map((r) => r.id)).toContain("recruiting-sms#2");
    const one = await api.get({ record: record.id, id: "recruiting-sms#1" });
    expect(one.detail).toMatchObject({ sample: { first_name: "Dana", sender: "William" } });
  });
});
