/**
 * `template_stats`: one view of sends, replies and bookings per template version and variant, for
 * email, texts and DMs. Synthetic rows only.
 */
import { templateStats } from "@wren/core";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { messages, threadEvents } from "../../src/schema.js";
import {
  allMessages,
  liveCopy,
  makeCompany,
  makePerson,
  runCompose,
  TABLES,
} from "./compose-fixtures.js";

let pg: TestPostgres;
const db = () => pg.db;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(async () => {
  await truncate(pg.db, [
    ...TABLES,
    "thread_events",
    "sms_messages",
    "sms_contacts",
    "reach_messages",
    "reach_contacts",
  ]);
  await liveCopy(pg.db, "sec_ria");
});

const SENT = new Date("2026-09-01T15:00:00Z");
const LATER = new Date("2026-09-02T15:00:00Z");
/** Raw SQL takes timestamps as text. */
const at = (d: Date) => sql`${d.toISOString()}::timestamptz`;

describe("template_stats", () => {
  it("counts each channel's sends and the replies after them, by version and picks", async () => {
    const company = await makeCompany(db());
    await makePerson(db(), company, { email: "jane@oakbridge.example" });
    await runCompose(db());
    const [opener] = (await allMessages(db())).filter((m) => m.template === "opener");
    if (!opener) throw new Error("no opener composed");
    await db()
      .update(messages)
      .set({ state: "sent", sentAt: SENT, messageId: "<a@example.test>" })
      .where(eq(messages.id, opener.id));
    await db().insert(threadEvents).values({
      enrollmentId: opener.enrollmentId,
      kind: "reply",
      receivedAt: LATER,
      disposition: "meeting_booked",
      dispositionSource: "operator",
      classifiedAt: LATER,
    });

    const version = "abc123def456";
    const picks = sql`'{"tone": 1}'::jsonb`;
    await db().execute(sql`
      with c as (insert into sms_contacts (e164, source_kind, basis)
        values ('+15555550100', 'manual', 'opt_in') returning id)
      insert into sms_messages (contact_id, direction, kind, to_e164, body, state, template,
        template_version, provenance, sent_at, created_at, provider_id, step)
      select id, 'out', 'sequence', '+15555550100', 'Hi', 'delivered', 'demo#1', ${version},
        jsonb_build_object('picks', ${picks}), ${at(SENT)}, ${at(SENT)}, 'p-1', 1 from c
      union all
      select id, 'in', 'inbound', '+15555550199', 'yes', 'received', null, null, null, null,
        ${at(LATER)}, 'p-2', null from c`);
    await db().execute(sql`
      with c as (insert into reach_contacts (platform, handle, url, found_in)
        values ('reddit', 'demo_user', 'https://example.test/u/demo_user', 'r/demo') returning id)
      insert into reach_messages (contact_id, direction, kind, body, state, template,
        template_version, provenance, sent_at, step)
      select id, 'out', 'sequence', 'Hi', 'sent', 'reddit-dm#1', ${version},
        jsonb_build_object('picks', ${picks}), ${at(SENT)}, 1 from c`);

    const rows = await db().select().from(templateStats);
    const of = (kind: string) => rows.filter((r) => r.kind === kind);
    expect(of("email")).toEqual([
      expect.objectContaining({
        system: "sec_ria",
        template: "opener",
        version: opener.templateVersion,
        sends: 1,
        replies: 1,
        booked: 1,
      }),
    ]);
    expect(of("email")[0]?.templateId).not.toBeNull();
    expect(of("sms")).toEqual([
      expect.objectContaining({
        system: "texts",
        template: "demo#1",
        version,
        picks: { tone: 1 },
        sends: 1,
        replies: 1,
        booked: null,
        templateId: null,
      }),
    ]);
    expect(of("dm")).toEqual([
      expect.objectContaining({ system: "reach", sends: 1, replies: 0, booked: null }),
    ]);
  });
});
