/**
 * B7: a client's rows kept on main (form entries, pay links) as `profile_events` lines in its
 * workspace, the backfill of them, bookings on any calendar, the pages a form's visit saw, and
 * live site visits on Wren's profile pages. One database plays both main and the workspace.
 * Synthetic rows.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { profileRecords, type VisitLine } from "../../src/profile-records.js";
import { mergeProfiles, resolveProfile } from "../../src/profiles.js";
import {
  backfillClientRows,
  backfillProfiles,
  noteClientForm,
  noteClientPayLink,
} from "../../src/profiles-backfill.js";
import { serveRecords } from "../../src/records-serve.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

type Row = Record<string, unknown>;
const run = async (q: ReturnType<typeof sql>) => (await pg.db.execute(q)) as unknown as Row[];
const one = async (q: ReturnType<typeof sql>) => (await run(q))[0] as Row;
const T = (day: number) => new Date(Date.UTC(2026, 9, day, 12));
const S = (day: number) => T(day).toISOString();

beforeEach(async () => {
  await truncate(pg.db, [
    "profile_events",
    "profile_merges",
    "profile_trait_events",
    "profile_traits",
    "profile_keys",
    "profiles",
    "site_forms",
    "site_pages",
    "pay_links",
    "sms_messages",
    "sms_contacts",
    "clients",
  ]);
  await run(sql`truncate calendar.bookings restart identity cascade`);
  await run(
    sql`insert into clients (id, name, database) values ('acme', 'Acme', 'wren_client_acme')`,
  );
});

const page = async (client: string | null, slug: string) =>
  (
    await one(sql`insert into site_pages (slug, title, kind, source, preview_token, created_by,
      updated_by, client) values (${slug}, 'Quote page', 'lander', 'data', ${"t".repeat(43)},
      'test', 'test', ${client}) returning id`)
  ).id as string;

const form = async (pageId: string, fields: Row, pages: unknown, day: number) =>
  (
    await one(sql`insert into site_forms (page, fields, touch, channel, at, pages)
      values (${pageId}, ${JSON.stringify(fields)}::jsonb, '{}'::jsonb, 'direct', ${S(day)},
        ${pages === null ? null : JSON.stringify(pages)}::jsonb) returning id`)
  ).id as string;

const lines = (email: string) =>
  run(sql`select t.id, t.kind, t.channel, t.summary, t.body, t.link, t.source from profile_timeline t
    join profile_keys k on k.profile_id = t.profile_id
    where k.kind = 'email' and k.value = ${email} order by t.at`);

describe("lines kept on main, written in the workspace", () => {
  it("a client's form entry: its profile and one line with the pages seen first", async () => {
    const p = await page("acme", "quote");
    const pages = [
      { path: "/", at: T(2).getTime() },
      { path: "/pricing", at: T(2).getTime() + 1000 },
    ];
    const id = await form(p, { email: "Bo@Example.test", name: "Bo Diaz", job: "roof" }, pages, 2);
    const fields = { email: "Bo@Example.test", name: "Bo Diaz", job: "roof" };
    const at = T(2);
    const got = await noteClientForm(pg.db, { id, title: "Quote page", fields, pages, at });
    expect(got).toBeTypeOf("number");
    // Twice: still one line.
    await noteClientForm(pg.db, { id, title: "Quote page", fields, pages, at });
    const l = (await lines("bo@example.test")).filter((x) => x.kind === "form");
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({
      kind: "form",
      channel: "site",
      summary: "Quote page sent",
      link: `/sites/submissions/${id}`,
      source: "site_forms",
    });
    expect(l[0]?.body).toBe(
      "email: Bo@Example.test\njob: roof\nname: Bo Diaz\n\nPages seen first: /, /pricing",
    );
    const t = await one(sql`select key, value from profile_traits where key = 'job'`);
    expect(t.value).toBe("roof");
  });

  it("a pay link: a line once sent, rewritten when paid; sms_contacts.paid_at adds none", async () => {
    const c =
      await one(sql`insert into sms_contacts (e164, source_kind, basis, email, name, paid_cents, paid_at)
      values ('+15550100201', 'manual', 'opt_in', 'cy@example.test', 'Cy Moe', 4500, ${S(5)}) returning id`);
    const link = {
      id: "3f0c3c2e-0000-4000-8000-000000000001",
      contact: c.id as number,
      email: null,
      name: "Cy Moe",
      channel: "sms",
      description: "Gutter clean",
      amountCents: 1500,
      quantity: 3,
      currency: "usd",
      sentAt: null as Date | null,
      paidCents: null as number | null,
      paidAt: null as Date | null,
    };
    expect(await noteClientPayLink(pg.db, link)).toBeNull();
    await noteClientPayLink(pg.db, { ...link, sentAt: T(4) });
    let l = await lines("cy@example.test");
    expect(l.map((x) => x.summary)).toEqual(["Pay link sent: $45.00 for Gutter clean"]);
    await noteClientPayLink(pg.db, { ...link, sentAt: T(4), paidCents: 4500, paidAt: T(5) });
    l = await lines("cy@example.test");
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({
      kind: "payment",
      channel: "sms",
      summary: "Paid $45.00 for Gutter clean",
      link: `/payments/links/${link.id}`,
      source: "pay_links",
    });
    // Found by the thread's number too.
    const k = await run(sql`select kind from profile_keys order by kind`);
    expect(k.map((r) => r.kind)).toEqual(["email", "phone"]);
  });

  it("backfills a client's form entries and sent links, and a second run changes nothing", async () => {
    const ours = await page(null, "ours");
    const theirs = await page("acme", "theirs");
    await form(ours, { email: "wren@example.test" }, null, 1);
    await form(theirs, { email: "dee@example.test", phone: "555-010-0301" }, null, 2);
    await run(sql`insert into pay_links (client, email, channel, description, amount_cents, created_by, sent_at)
      values ('acme', 'dee@example.test', 'email', 'Deposit', 9900, 'test', ${S(3)}),
        ('acme', 'dee@example.test', 'email', 'Draft only', 100, 'test', null)`);
    const first = await backfillClientRows(pg.db, "acme", pg.db);
    expect(first).toEqual([
      { source: "site_forms", rows: 1, noted: 1 },
      { source: "pay_links", rows: 1, noted: 1 },
    ]);
    const again = await backfillClientRows(pg.db, "acme", pg.db);
    expect(again).toEqual(first);
    const l = await lines("dee@example.test");
    expect(l.map((x) => x.summary)).toEqual([
      "Quote page sent",
      "Pay link sent: $99.00 for Deposit",
    ]);
    expect(await run(sql`select 1 from profile_events`)).toHaveLength(2);
    // Wren's own entry isn't a client's line.
    expect(await lines("wren@example.test")).toHaveLength(0);
  });

  it("moves a profile's lines when it merges", async () => {
    const a = await resolveProfile(pg.db, [{ kind: "email", value: "a@example.test" }], "t");
    const b = await resolveProfile(pg.db, [{ kind: "email", value: "b@example.test" }], "t");
    await noteClientPayLink(pg.db, {
      id: "3f0c3c2e-0000-4000-8000-000000000002",
      contact: null,
      email: "b@example.test",
      name: null,
      channel: "email",
      description: "Visit",
      amountCents: 5000,
      quantity: 1,
      currency: "eur",
      sentAt: T(6),
      paidCents: null,
      paidAt: null,
    });
    await mergeProfiles(pg.db, a?.id as number, b?.id as number, "test", "t");
    const e = await one(sql`select profile_id, summary from profile_events`);
    expect(e).toEqual({ profile_id: a?.id, summary: "Pay link sent: 50.00 EUR for Visit" });
  });
});

describe("Wren's own", () => {
  it("shows a form's pages seen first on Wren's entry line", async () => {
    const p = await page(null, "ours");
    await form(p, { email: "eli@example.test" }, [{ path: "/", at: 1 }], 1);
    await backfillProfiles(pg.db, { only: ["site_form"] });
    const l = await lines("eli@example.test");
    expect(l[0]?.body).toBe("email: eli@example.test\n\nPages seen first: /");
  });

  it("puts every calendar's booking on the timeline: each database's bookings are its own", async () => {
    await run(sql`insert into calendar.bookings (calendar, start, "end", name, email, zone)
      values ('acme', ${S(7)}, ${S(8)}, 'Fay Ng', 'fay@example.test', 'UTC')`);
    await backfillProfiles(pg.db, { only: ["booking"] });
    expect((await lines("fay@example.test")).map((x) => x.kind)).toEqual(["booking"]);
  });

  it("reads site visits live by visitor key, and none for a profile without one", async () => {
    const seen: string[][] = [];
    const visits = async (v: readonly string[]): Promise<VisitLine[]> => {
      seen.push([...v]);
      return [{ at: S(8), text: "Saw /pricing, 2 min", href: "https://example.test/pricing" }];
    };
    const api = serveRecords(profileRecords([], { visits }), pg.db);
    const a = await resolveProfile(
      pg.db,
      [
        { kind: "email", value: "gus@example.test" },
        { kind: "visitor", value: "v-synthetic-1" },
      ],
      "t",
    );
    const b = await resolveProfile(pg.db, [{ kind: "email", value: "hal@example.test" }], "t");
    const visitsOf = async (id: number | undefined) =>
      (
        (await api.get({ record: "people.profile", id: String(id) })).detail as {
          visits: VisitLine[] | null;
        }
      ).visits;
    expect(await visitsOf(a?.id)).toEqual([
      { at: S(8), text: "Saw /pricing, 2 min", href: "https://example.test/pricing" },
    ]);
    expect(seen).toEqual([["v-synthetic-1"]]);
    expect(await visitsOf(b?.id)).toBeNull();
    expect(seen).toHaveLength(1);
  });
});
