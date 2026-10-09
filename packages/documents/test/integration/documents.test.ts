/**
 * Documents on a real Postgres (designs/2026-10-09-documents.md): starters once, a draft from a
 * template with its slots filled and numbered, Send frozen with its SHA-256, the link by its
 * token's hash, an open, a signature checked against the text shown, the PDF, void and expiry.
 * Synthetic data only.
 */
import { smsContacts } from "@wren/channel-sms/schema";
import { addClient, addOperator } from "@wren/core/clients";
import { cachedDb, clientDatabaseUrl } from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { documentsConsoleApi } from "../../src/console.js";
import { docPdf } from "../../src/pdf.js";
import { documentRecordFor } from "../../src/records.js";
import { docPage } from "../../src/render.js";
import { docEvents, docs, docTemplates } from "../../src/schema.js";
import {
  docById,
  docByToken,
  docEventsOf,
  issueLink,
  markSent,
  seeDoc,
  shaOf,
  signDoc,
  waitingDocs,
} from "../../src/store.js";

let pg: TestPostgres;
const open = (c: { id: string }) => cachedDb(clientDatabaseUrl(pg.url, `wren_client_${c.id}`));
const NOW = new Date("2026-10-09T15:00:00Z");
const ADA = { viewer: { email: "ada@example.test", operator: true } as never, client: "acme" };
const api = () => documentsConsoleApi({ main: pg.db, open });
let contact = 0;

beforeAll(async () => {
  pg = await startTestPostgres();
  await addClient(pg.db, pg.url, { id: "acme", name: "Acme Air", products: {} });
  await addClient(pg.db, pg.url, { id: "beta", name: "Beta", products: {} });
  await addOperator(pg.db, "ada@example.test");
  const [c] = await open({ id: "acme" })
    .insert(smsContacts)
    .values({
      e164: "+12125550143",
      sourceKind: "form",
      basis: "opt_in",
      name: "Sam Rivera",
      email: "sam@example.test",
    })
    .returning({ id: smsContacts.id });
  contact = c?.id ?? 0;
});
afterAll(() => pg.stop());

describe("templates", () => {
  it("adds the starters once", async () => {
    await api().recordsTypes(ADA);
    await api().recordsTypes(ADA);
    const rows = await pg.db.select().from(docTemplates).where(eq(docTemplates.client, "acme"));
    expect(rows.map((t) => t.starter).sort()).toEqual(["estimate", "proposal", "service"]);
  });

  it("saves the client's own and refuses a bad deposit", async () => {
    const t = await api().templateSave(
      {
        ...ADA,
        kind: "estimate",
        name: "Tune-up",
        body: "For {contact.first_name}.",
        lines: [{ name: "Tune-up", price: "149.00", tax_pct: 8 }],
        depositPct: 25,
      },
      NOW,
    );
    expect(t.template.kind).toBe("estimate");
    await expect(
      api().templateSave({ ...ADA, kind: "estimate", name: "X", depositPct: 150 }, NOW),
    ).rejects.toThrow(/1 to 100/);
  });
});

describe("a document from draft to signed", () => {
  let id = "";
  let token = "";

  it("makes a numbered draft from a thread, slots filled, one left", async () => {
    const [t] = await pg.db.select().from(docTemplates).where(eq(docTemplates.name, "Tune-up"));
    const a = await api().create({ ...ADA, template: t?.id ?? null, contact }, NOW);
    const b = await api().create(
      { ...ADA, kind: "estimate", email: "x@example.test", lines: [{ name: "A", price: 10 }] },
      NOW,
    );
    expect(a.doc.number).toBe("EST-0001");
    expect(b.doc.number).toBe("EST-0002");
    id = a.doc.id;
    const d = await docById(pg.db, id);
    expect(d).toMatchObject({
      name: "Sam Rivera",
      email: "sam@example.test",
      contact,
      channel: "sms",
      body: "For Sam.",
      subtotalCents: 14900,
      taxCents: 1192,
      totalCents: 16092,
      depositCents: 4023,
    });
    // A slot with no value blocks Send.
    await api().update({ ...ADA, id, body: "For {contact.first_name}. Size: {field.size}." }, NOW);
    await expect(api().send({ ...ADA, id }, NOW)).rejects.toThrow(/\{field\.size\}/);
    await api().update({ ...ADA, id, body: "For {contact.first_name}." }, NOW);
  });

  it("sends: frozen with a fingerprint, the link kept only as a hash", async () => {
    const s = await api().send({ ...ADA, id }, NOW);
    expect(s.docs[0]?.status).toBe("sending");
    await expect(api().update({ ...ADA, id, title: "Changed" }, NOW)).rejects.toThrow(/duplicate/);
    token = await issueLink(pg.db, id, NOW);
    await markSent(pg.db, id, { message: 7, by: "ada@example.test", now: NOW });
    const d = await docById(pg.db, id);
    expect(d?.status).toBe("sent");
    expect(d?.tokenHash).not.toContain(token);
    expect(d?.sha256).toBe(shaOf(d as never));
    expect(d?.expiresAt?.toISOString()).toBe("2026-11-08T15:00:00.000Z");
  });

  it("opens only on its owner's host, and counts the first open", async () => {
    expect(await docByToken(pg.db, token, "beta", NOW)).toBeNull();
    const d = await docByToken(pg.db, token, "acme", NOW);
    expect(d?.id).toBe(id);
    expect(await seeDoc(pg.db, d as never, { ip: "203.0.113.9", agent: "Test", now: NOW })).toBe(
      "first",
    );
    const again = await docById(pg.db, id);
    expect(again?.status).toBe("viewed");
    expect(
      await seeDoc(pg.db, again as never, { now: new Date(NOW.getTime() + 60_000) }),
    ).toBeNull();
  });

  it("renders the page escaped, with the fingerprint in the form", async () => {
    const d = (await docById(pg.db, id)) as never as Parameters<typeof docPage>[0];
    const html = docPage(
      { ...d, title: "<script>x</script>" },
      {
        business: "Acme Air",
        look: { accent: null, logo: null },
        token,
        siteKey: null,
        reach: { phone: null, email: null },
      },
    );
    expect(html).not.toContain("<script>x");
    expect(html).toContain(`name="sha" value="${d.sha256}"`);
    expect(html).toContain("$160.92");
  });

  it("refuses a signature on other text, then signs", async () => {
    const d = (await docById(pg.db, id)) as never as Parameters<typeof signDoc>[1];
    const sign = {
      name: "Sam Rivera",
      email: "SAM@example.test",
      consent: "yes",
      ip: "203.0.113.9",
      agent: "Test",
      now: NOW,
    };
    await expect(signDoc(pg.db, d, { ...sign, sha: "0".repeat(64) })).rejects.toThrow(/changed/);
    await expect(signDoc(pg.db, d, { ...sign, consent: undefined, sha: d.sha256 })).rejects.toThrow(
      /Tick/,
    );
    const done = await signDoc(pg.db, d, { ...sign, sha: d.sha256 });
    expect(done).toMatchObject({
      status: "signed",
      signerEmail: "sam@example.test",
      consentVersion: "2026-10-09",
    });
    await expect(signDoc(pg.db, done, { ...sign, sha: d.sha256 })).rejects.toThrow(
      /can't be signed/,
    );
    const types = (await docEventsOf(pg.db, id)).map((e) => e.type);
    expect(types).toEqual(["made", "asked", "sent", "viewed", "signed"]);
  });

  it("builds the signed PDF with its record", async () => {
    const d = await docById(pg.db, id);
    const bytes = await docPdf(d as never, await docEventsOf(pg.db, id), "Acme Air");
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const again = await docPdf(d as never, await docEventsOf(pg.db, id), "Acme Air");
    expect(Buffer.from(again).equals(Buffer.from(bytes))).toBe(true);
    const viaConsole = await api().pdf({ ...ADA, id });
    expect(viaConsole.name).toBe("EST-0001-signed.pdf");
  });

  it("shows the timeline and the draft on the record", async () => {
    const rec = documentRecordFor("acme");
    const got = (await rec.load?.(pg.db, id)) as { steps: unknown[]; edit: { depositPct: number } };
    expect(got.steps).toHaveLength(5);
    expect(got.edit.depositPct).toBe(25);
  });
});

describe("approval, void and expiry", () => {
  it("waits in To approve for a non-approver and says no back to draft", async () => {
    await pg.db.execute(`update clients set approver = 'client' where id = 'acme'` as never);
    const made = await api().create(
      { ...ADA, kind: "contract", email: "lee@example.test", name: "Lee" },
      NOW,
    );
    const s = await api().send({ ...ADA, id: made.doc.id }, NOW);
    expect(s.docs[0]?.status).toBe("waiting");
    expect((await waitingDocs(pg.db)).map((w) => w.id)).toContain(made.doc.id);
    await pg.db.execute(`update clients set approver = 'wren' where id = 'acme'` as never);
    expect((await api().decline({ ...ADA, ids: [`doc:${made.doc.id}`] }, NOW)).done).toBe(1);
    expect((await docById(pg.db, made.doc.id))?.status).toBe("draft");
  });

  it("voids an open one and expires a stale one, once each", async () => {
    const a = await api().create({ ...ADA, kind: "contract", email: "a@example.test" }, NOW);
    await api().send({ ...ADA, id: a.doc.id }, NOW);
    const ta = await issueLink(pg.db, a.doc.id, NOW);
    await markSent(pg.db, a.doc.id, { message: null, by: "ada@example.test", now: NOW });
    expect((await api().void({ ...ADA, ids: [a.doc.id] }, NOW)).done).toBe(1);
    expect((await docByToken(pg.db, ta, "acme", NOW))?.status).toBe("void");

    const b = await api().create(
      { ...ADA, kind: "contract", email: "b@example.test", expiresDays: 1 },
      NOW,
    );
    await api().send({ ...ADA, id: b.doc.id }, NOW);
    const tb = await issueLink(pg.db, b.doc.id, NOW);
    await markSent(pg.db, b.doc.id, { message: null, by: "ada@example.test", now: NOW });
    const later = new Date(NOW.getTime() + 2 * 86_400_000);
    expect((await docByToken(pg.db, tb, "acme", later))?.status).toBe("expired");
    await docByToken(pg.db, tb, "acme", later);
    const expired = await pg.db.select().from(docEvents).where(eq(docEvents.document, b.doc.id));
    expect(expired.filter((e) => e.type === "expired")).toHaveLength(1);
    // A reminder's new link retires the old one.
    const c = await api().create({ ...ADA, kind: "contract", email: "c@example.test" }, NOW);
    await api().send({ ...ADA, id: c.doc.id }, NOW);
    const t1 = await issueLink(pg.db, c.doc.id, NOW);
    const t2 = await issueLink(pg.db, c.doc.id, NOW);
    expect(await docByToken(pg.db, t1, "acme", NOW)).toBeNull();
    expect((await docByToken(pg.db, t2, "acme", NOW))?.id).toBe(c.doc.id);
    const [row] = await pg.db.select().from(docs).where(eq(docs.id, c.doc.id));
    expect(row?.sha256).toBe(shaOf(row as never));
  });
});
