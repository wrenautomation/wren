/**
 * A sealed document (designs/2026-10-21-esign-and-newsletter.md) through Restate, every step
 * replayed (`alwaysReplay`): send makes one envelope and mails the provider's link, a retry after
 * the provider's 5xx makes no second one, the webhooks move the document (opened, completed,
 * rejected, cancelled), the signed copy lands in the bucket once, and a void cancels the envelope.
 * A fake Documenso and a fake bucket, synthetic data, no network, no mail sent.
 */
import { createHash } from "node:crypto";
import { smsContacts } from "@wren/channel-sms/schema";
import { addClient, addOperator, updateClient } from "@wren/core/clients";
import { pgKeyStore, throwawayRing } from "@wren/core/keys";
import { startTestRestate } from "@wren/core/testing";
import { cachedDb, clientDatabaseUrl } from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { documentsConsoleApi, makeDocumentsConsole } from "../../src/console.js";
import { documenso } from "../../src/documenso.js";
import { type Answer, type DocumentsDeps, makeDocuments } from "../../src/service.js";
import { docById, docEventsOf, issueLink, SEALED_CONSENT_VERSION } from "../../src/store.js";

let pg: TestPostgres;
let env: Awaited<ReturnType<typeof startTestRestate>>;
const open = (c: { id: string }) => cachedDb(clientDatabaseUrl(pg.url, `wren_client_${c.id}`));
const ADA = { viewer: { email: "ada@example.test", operator: true } as never, client: "acme" };
const SIGNED = new TextEncoder().encode("%PDF-1.7 signed copy");

/** The fake Documenso: envelopes by id, what was asked of it, and the next failures. */
const envelopes = new Map<string, { status: string; token: string; externalId: string }>();
let asked: { path: string; body: unknown }[] = [];
let failCreate: { status: number; times: number } | null = null;
let mails: { from: string; to: string; subject: string; text: string }[] = [];
let stored = new Map<string, Uint8Array>();
let n = 0;

const fakeFetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
  const p = new URL(url).pathname.replace("/api/v2", "");
  const form = init.body instanceof FormData ? init.body : null;
  const json = !form && init.body ? JSON.parse(String(init.body)) : null;
  asked.push({ path: p, body: form ? Object.fromEntries(form.entries()) : json });
  if (p === "/envelope/create") {
    if (failCreate && failCreate.times > 0) {
      failCreate.times -= 1;
      return Response.json({ message: "no good" }, { status: failCreate.status });
    }
    const payload = JSON.parse(
      await ((form?.get("payload") as Blob | undefined) ?? new Blob(["{}"])).text(),
    );
    n += 1;
    envelopes.set(`envelope_${n}`, {
      status: "DRAFT",
      token: `tok${n}`,
      externalId: payload.externalId,
    });
    return Response.json({ id: `envelope_${n}` });
  }
  const one = /^\/envelope\/([^/]+)$/.exec(p);
  if (one && init.method === "GET") {
    const e = envelopes.get(one[1] as string);
    if (!e) return Response.json({ message: "not found" }, { status: 404 });
    return Response.json({
      status: e.status,
      recipients: [{ email: "sam@example.test", name: "Sam Rivera", token: e.token }],
      envelopeItems: [{ id: "item_1" }],
    });
  }
  if (p === "/envelope/distribute") {
    const e = envelopes.get(json.envelopeId);
    if (e) e.status = "PENDING";
    return Response.json({ recipients: [{ email: "sam@example.test", token: e?.token }] });
  }
  if (p === "/envelope/cancel") {
    const e = envelopes.get(json.envelopeId);
    if (e) e.status = "CANCELLED";
    return Response.json({ success: true });
  }
  if (p === "/envelope/delete") {
    envelopes.delete(json.envelopeId);
    return Response.json({ success: true });
  }
  if (
    p.startsWith("/envelope/item/") ||
    p.endsWith("/certificate/download") ||
    p.endsWith("/audit-log/download")
  )
    return new Response(SIGNED);
  return Response.json({ message: "?" }, { status: 404 });
};

const files = {
  put: async (key: string, bytes: Uint8Array) => {
    stored.set(key, bytes);
  },
  getUrl: async (key: string) => `https://files.test/${key}?sig=1`,
};

const deps = (): DocumentsDeps => ({
  main: pg.db,
  open,
  keys: pgKeyStore(pg.db, throwawayRing()),
  fetch: async () => Response.json({}),
  portal: "https://app.wren.test",
  mailer: (from) => async (m) => {
    mails.push({ from, ...m });
  },
  documenso: documenso({ url: "https://sign.test", token: "api_test", fetch: fakeFetch }),
  files,
  esignRetry: { maxRetryDuration: 4_000, initialRetryInterval: 50, maxRetryInterval: 200 },
});

const post = async <T>(service: string, handler: string, body: unknown): Promise<T> => {
  const r = await fetch(`${env.baseUrl()}/${service}/${handler}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${service}/${handler}: ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
};
const hook = (event: string, envelopeId: string, extra: Record<string, unknown> = {}) =>
  post<{ ok: boolean; why?: string; ignored?: string }>("Documents", "signed", {
    event,
    createdAt: "2026-10-22T02:10:38.768Z",
    payload: {
      id: 1,
      envelopeId,
      externalId: "x",
      status: event === "DOCUMENT_COMPLETED" ? "COMPLETED" : "PENDING",
      completedAt: event === "DOCUMENT_COMPLETED" ? "2026-10-22T02:10:38.000Z" : null,
      recipients: [
        {
          email: "Sam@Example.test",
          name: "Sam Rivera",
          signedAt: event === "DOCUMENT_COMPLETED" ? "2026-10-22T02:10:37.000Z" : null,
          ...extra,
        },
      ],
    },
  });

/** A new sealed draft for the contact, sent through the console. */
async function sealedSend(title: string) {
  const made = await documentsConsoleApi({ main: pg.db, open, sealed: true }).create(
    {
      ...ADA,
      kind: "contract",
      title,
      body: "We tune the unit.",
      lines: [{ name: "Tune-up", price: 149 }],
      email: "sam@example.test",
      name: "Sam Rivera",
      channel: "email",
      signing: "sealed",
    },
    new Date(),
  );
  const out = await post<{
    docs: { id: string; status: string }[];
    url: string | null;
    why: string | null;
  }>("DocumentsConsole", "send", { ...ADA, id: made.doc.id });
  return { id: made.doc.id, out };
}

beforeAll(async () => {
  pg = await startTestPostgres({ own: true });
  await addClient(pg.db, pg.url, { id: "acme", name: "Acme Air", products: {} });
  await updateClient(pg.db, "acme", { sends: ["documents.docs"] });
  await addOperator(pg.db, "ada@example.test");
  await open({ id: "acme" })
    .insert(smsContacts)
    .values({ e164: "+12125550143", sourceKind: "form", basis: "opt_in", name: "Sam Rivera" });
  env = await startTestRestate({
    services: [makeDocuments(deps()), makeDocumentsConsole({ ...deps(), sealed: true })],
    alwaysReplay: true,
  });
}, 180_000);
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});
beforeEach(() => {
  asked = [];
  mails = [];
  failCreate = null;
});

describe("send and the webhooks", () => {
  let id = "";
  let envelope = "";

  it("sends: one envelope from the frozen text, the provider's link mailed, no expiry of ours", async () => {
    const sent = await sealedSend("Service agreement");
    id = sent.id;
    expect(sent.out).toMatchObject({
      docs: [{ id, status: "sent" }],
      url: "https://sign.test/sign/tok1",
    });
    const d = await docById(pg.db, id);
    envelope = d?.envelopeId ?? "";
    expect(envelope).toMatch(/^envelope_/);
    expect(d).toMatchObject({ signing: "sealed", status: "sent", expiresAt: null });
    expect(d?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(d?.tokenHash).toBeNull();
    expect(asked.filter((a) => a.path === "/envelope/create")).toHaveLength(1);
    expect(envelopes.get(envelope)).toMatchObject({ status: "PENDING", externalId: id });
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ from: "Acme Air", to: "sam@example.test" });
    expect(mails[0]?.text).toContain("https://sign.test/sign/tok1");
    expect(mails[0]?.text).toContain("e-sign");
  });

  it("a reminder mails the same live link and makes no second envelope", async () => {
    await post("DocumentsConsole", "remind", { ...ADA, id });
    await expect.poll(() => mails.length).toBe(1);
    expect(mails[0]?.subject).toMatch(/^Reminder/);
    expect(mails[0]?.text).toContain("https://sign.test/sign/tok1");
    expect(asked.filter((a) => a.path === "/envelope/create")).toHaveLength(0);
  });

  it("opened marks it viewed once", async () => {
    expect(await hook("DOCUMENT_OPENED", envelope)).toEqual({ ok: true });
    expect(await hook("DOCUMENT_OPENED", envelope)).toEqual({ ok: true });
    expect((await docById(pg.db, id))?.status).toBe("viewed");
    expect((await docEventsOf(pg.db, id)).filter((e) => e.type === "viewed")).toHaveLength(1);
  });

  it("completed keeps the three files once, marks it signed with the consent version, mails the copy", async () => {
    expect(await hook("DOCUMENT_COMPLETED", envelope)).toEqual({ ok: true });
    const d = await docById(pg.db, id);
    expect(d).toMatchObject({
      status: "signed",
      signerName: "Sam Rivera",
      signerEmail: "sam@example.test",
      consentVersion: SEALED_CONSENT_VERSION,
    });
    expect(d?.signedAt?.toISOString()).toBe("2026-10-22T02:10:37.000Z");
    const keys = [...stored.keys()].sort();
    expect(keys).toEqual([
      `clients/acme/documents/${id}/${d?.number}-audit.pdf`,
      `clients/acme/documents/${id}/${d?.number}-certificate.pdf`,
      `clients/acme/documents/${id}/${d?.number}-signed.pdf`,
    ]);
    expect(d?.sealed).toMatchObject({
      pdf: `clients/acme/documents/${id}/${d?.number}-signed.pdf`,
      sha256: createHash("sha256").update(SIGNED).digest("hex"),
    });
    expect(mails.map((m) => m.to)).toContain("sam@example.test");
    const copy = mails.find((m) => m.subject.startsWith("Signed:"));
    expect(copy?.text).toMatch(/https:\/\/app\.wren\.test\/o\/d\/[^/\s]+\/pdf/);
    // "signed" carries the provider's clock, so the order is not asserted.
    const types = (await docEventsOf(pg.db, id)).map((e) => e.type).sort();
    expect(types).toEqual(["asked", "made", "reminded", "sent", "signed", "viewed"]);
  });

  it("a repeat of completed changes nothing", async () => {
    stored = new Map();
    mails = [];
    expect(await hook("DOCUMENT_COMPLETED", envelope)).toEqual({ ok: true });
    expect(stored.size).toBe(0);
    expect(mails).toHaveLength(0);
    expect((await docEventsOf(pg.db, id)).filter((e) => e.type === "signed")).toHaveLength(1);
  });

  it("the signer's page link sends the sealed PDF from the bucket", async () => {
    const d = await docById(pg.db, id);
    const token = await issueLink(pg.db, id, new Date());
    const got = await post<Answer>("Documents", "pdf", { client: "acme", token });
    expect(got.status).toBe(303);
    expect(got.location).toBe(`https://files.test/${d?.sealed?.pdf}?sig=1`);
  });

  it("the console gives the sealed parts as short-lived links", async () => {
    const d = await docById(pg.db, id);
    const pdf = await post<{ name: string; url: string }>("DocumentsConsole", "pdf", {
      ...ADA,
      id,
    });
    expect(pdf).toEqual({
      name: `${d?.number}-signed.pdf`,
      url: `https://files.test/${d?.sealed?.pdf}?sig=1`,
    });
    const cert = await post<{ name: string; url: string }>("DocumentsConsole", "pdf", {
      ...ADA,
      id,
      part: "certificate",
    });
    expect(cert.url).toBe(`https://files.test/${d?.sealed?.certificate}?sig=1`);
  });

  it("an envelope Wren did not make, and an event it does not use, are answered and left", async () => {
    expect(await hook("DOCUMENT_COMPLETED", "envelope_unknown")).toMatchObject({ ok: false });
    expect(await hook("DOCUMENT_SENT", envelope)).toEqual({ ok: true, ignored: "DOCUMENT_SENT" });
    expect(
      await post("Documents", "signed", { event: "DOCUMENT_COMPLETED", payload: {} }),
    ).toMatchObject({ ok: false });
  });
});

describe("rejected, called off, and the provider in trouble", () => {
  it("rejected closes it as declined, with the reason", async () => {
    const { id } = await sealedSend("Rejected one");
    const envelope = (await docById(pg.db, id))?.envelopeId ?? "";
    expect(await hook("DOCUMENT_REJECTED", envelope, { rejectionReason: "Wrong price" })).toEqual({
      ok: true,
    });
    expect(await docById(pg.db, id)).toMatchObject({
      status: "declined",
      declinedWhy: "Wrong price",
    });
  });

  it("a void cancels the live envelope, and a signing after it still counts", async () => {
    const { id } = await sealedSend("Voided one");
    const envelope = (await docById(pg.db, id))?.envelopeId ?? "";
    expect(await post("DocumentsConsole", "void", { ...ADA, ids: [id] })).toEqual({ done: 1 });
    await expect.poll(() => envelopes.get(envelope)?.status).toBe("CANCELLED");
    expect((await docById(pg.db, id))?.status).toBe("void");
    // Called off on Documenso's side too: the event finds it already void.
    expect(await hook("DOCUMENT_CANCELLED", envelope)).toEqual({ ok: true });
    // The signer finished before the cancel reached the provider.
    expect(await hook("DOCUMENT_COMPLETED", envelope)).toEqual({ ok: true });
    const d = await docById(pg.db, id);
    expect(d?.status).toBe("signed");
    expect((await docEventsOf(pg.db, id)).find((e) => e.type === "signed")?.note).toContain(
      "after it was called off",
    );
  });

  it("the provider's 5xx is retried and one envelope results", async () => {
    failCreate = { status: 503, times: 3 };
    const { id, out } = await sealedSend("Retried one");
    expect(out.docs[0]?.status).toBe("sent");
    expect(failCreate.times).toBe(0);
    expect((await docById(pg.db, id))?.envelopeId).toMatch(/^envelope_/);
    expect([...envelopes.values()].filter((e) => e.externalId === id)).toHaveLength(1);
  });

  it("the provider's refusal fails the send with its reason, and a second send makes the envelope", async () => {
    failCreate = { status: 400, times: 1 };
    const { id, out } = await sealedSend("Refused one");
    expect(out.docs[0]?.status).toBe("failed");
    expect(out.why).toContain("no good");
    expect(await docById(pg.db, id)).toMatchObject({ status: "failed", envelopeId: null });
    // Fixed on the provider's side: Send again from the failed document.
    const again = await post<{ docs: { status: string }[] }>("DocumentsConsole", "send", {
      ...ADA,
      id,
    });
    expect(again.docs[0]?.status).toBe("sent");
    expect((await docById(pg.db, id))?.envelopeId).toMatch(/^envelope_/);
  });
});

describe("with the provider off", () => {
  it("a sealed document can't be sent and says why; an own-signature one is not affected", async () => {
    const api = documentsConsoleApi({ main: pg.db, open });
    const made = await api.create(
      { ...ADA, kind: "contract", email: "x@example.test", signing: "sealed" },
      new Date(),
    );
    await expect(api.send({ ...ADA, id: made.doc.id }, new Date())).rejects.toThrow(
      /E-signature is not set up/,
    );
    const own = await api.create({ ...ADA, kind: "contract", email: "y@example.test" }, new Date());
    expect((await api.send({ ...ADA, id: own.doc.id }, new Date())).docs[0]?.status).toBe(
      "sending",
    );
  });

  it("a sealed one needs an email address", async () => {
    const api = documentsConsoleApi({ main: pg.db, open, sealed: true });
    const made = await api.create({ ...ADA, kind: "contract", signing: "sealed" }, new Date());
    await expect(api.send({ ...ADA, id: made.doc.id }, new Date())).rejects.toThrow(/email/i);
  });
});
