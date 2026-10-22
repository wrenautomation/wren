import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DocumensoError, documenso, eventOf } from "./documenso.js";

const TOKEN = "api_test_fixture";
const PDF = new TextEncoder().encode("%PDF-1.7 fixture");

/** A fake Documenso: a few envelopes in memory, the same routes and shapes the real v2 API answers. */
function fake() {
  const calls: { method: string; path: string; headers: Headers; body: unknown }[] = [];
  const envelopes = new Map<string, { status: string; token: string }>();
  let failNext: { status: number; message: string } | null = null;
  let n = 0;
  const fetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const u = new URL(url);
    const headers = new Headers(init.headers);
    const body =
      init.body instanceof FormData ? init.body : init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method: init.method ?? "GET", path: u.pathname + u.search, headers, body });
    if (failNext) {
      const f = failNext;
      failNext = null;
      return Response.json({ message: f.message }, { status: f.status });
    }
    const p = u.pathname.replace("/api/v2", "");
    if (p === "/envelope/create") {
      n += 1;
      envelopes.set(`envelope_${n}`, { status: "DRAFT", token: `tok_${n}` });
      return Response.json({ id: `envelope_${n}` });
    }
    const one = /^\/envelope\/([^/]+)$/.exec(p);
    if (one && init.method === "GET") {
      const e = envelopes.get(one[1] as string);
      if (!e) return Response.json({ message: "not found" }, { status: 404 });
      return Response.json({
        status: e.status,
        recipients: [{ email: "sam@example.test", name: "Sam", token: e.token }],
        envelopeItems: [{ id: "item_1" }],
      });
    }
    if (p === "/envelope/distribute") {
      const e = envelopes.get((body as { envelopeId: string }).envelopeId);
      if (e) e.status = "PENDING";
      return Response.json({ recipients: [{ email: "sam@example.test", token: e?.token }] });
    }
    if (p === "/envelope/cancel" || p === "/envelope/delete") {
      const e = envelopes.get((body as { envelopeId: string }).envelopeId);
      if (e) e.status = p.endsWith("cancel") ? "CANCELLED" : "DELETED";
      return Response.json({ success: true });
    }
    if (
      p.startsWith("/envelope/item/") ||
      p.endsWith("/certificate/download") ||
      p.endsWith("/audit-log/download")
    )
      return new Response(PDF);
    return Response.json({ message: "?" }, { status: 404 });
  };
  return {
    calls,
    envelopes,
    fetch,
    failNext: (status: number, message: string) => {
      failNext = { status, message };
    },
  };
}
const client = (f = fake()) => ({
  f,
  dx: documenso({ url: "https://sign.test/", token: TOKEN, fetch: f.fetch }),
});

describe("documenso client", () => {
  it("makes a draft envelope: the PDF, one signer, every Documenso email off, the token in one header", async () => {
    const { f, dx } = client();
    const id = await dx.create({
      title: "Service agreement",
      externalId: "doc_1",
      signer: { name: "Sam Rivera", email: "sam@example.test" },
      pdf: PDF,
    });
    expect(id).toBe("envelope_1");
    const call = f.calls[0];
    expect(call?.path).toBe("/api/v2/envelope/create");
    expect(call?.headers.get("authorization")).toBe(TOKEN);
    // A multipart body sets its own content type; none is forced here.
    expect(call?.headers.get("content-type")).toBeNull();
    const form = call?.body as FormData;
    const payload = JSON.parse(await (form.get("payload") as Blob).text());
    expect(payload).toMatchObject({
      type: "DOCUMENT",
      title: "Service agreement",
      externalId: "doc_1",
      recipients: [{ email: "sam@example.test", name: "Sam Rivera", role: "SIGNER" }],
      meta: { distributionMethod: "NONE" },
    });
    expect(Object.values(payload.meta.emailSettings)).toEqual(Array(9).fill(false));
    const file = form.get("files") as File;
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PDF);
  });

  it("goes live once and returns the signer's link; a repeat finds the same link", async () => {
    const { f, dx } = client();
    const id = await dx.create({
      title: "T",
      externalId: "d",
      signer: { name: "Sam", email: "sam@example.test" },
      pdf: PDF,
    });
    expect(await dx.distribute(id)).toBe("https://sign.test/sign/tok_1");
    expect(await dx.distribute(id)).toBe("https://sign.test/sign/tok_1");
    expect(f.calls.filter((c) => c.path.endsWith("/envelope/distribute"))).toHaveLength(1);
  });

  it("refuses to send an envelope that is not a draft or live one", async () => {
    const { f, dx } = client();
    f.envelopes.set("envelope_9", { status: "COMPLETED", token: "t" });
    await expect(dx.distribute("envelope_9")).rejects.toMatchObject({ status: 409 });
  });

  it("looks up the status and the link", async () => {
    const { dx } = client();
    const id = await dx.create({
      title: "T",
      externalId: "d",
      signer: { name: "Sam", email: "sam@example.test" },
      pdf: PDF,
    });
    expect(await dx.look(id)).toEqual({ status: "DRAFT", url: "https://sign.test/sign/tok_1" });
  });

  it("fetches the sealed PDF, certificate and audit log, with the PDF's SHA-256", async () => {
    const { f, dx } = client();
    f.envelopes.set("envelope_1", { status: "COMPLETED", token: "t" });
    const got = await dx.sealed("envelope_1");
    expect(got.pdf).toEqual(PDF);
    expect(got.certificate).toEqual(PDF);
    expect(got.audit).toEqual(PDF);
    expect(got.sha256).toBe(createHash("sha256").update(PDF).digest("hex"));
    expect(f.calls.map((c) => c.path)).toContain(
      "/api/v2/envelope/item/item_1/download?version=signed",
    );
  });

  it("withdraws by state: cancel a live one, delete a draft, keep a signed one", async () => {
    const { f, dx } = client();
    f.envelopes.set("a", { status: "PENDING", token: "t" });
    f.envelopes.set("b", { status: "DRAFT", token: "t" });
    f.envelopes.set("c", { status: "COMPLETED", token: "t" });
    expect(await dx.withdraw("a", "Withdrawn")).toBe("cancelled");
    expect(await dx.withdraw("b", "Withdrawn")).toBe("deleted");
    expect(await dx.withdraw("c", "Withdrawn")).toBe("kept");
    expect(f.envelopes.get("a")?.status).toBe("CANCELLED");
    expect(f.envelopes.get("b")?.status).toBe("DELETED");
    expect(f.envelopes.get("c")?.status).toBe("COMPLETED");
  });

  it("tells a refusal from trouble worth another try, and never puts the token in an error", async () => {
    const { f, dx } = client();
    f.failNext(400, "bad file");
    const refused = await dx
      .create({
        title: "T",
        externalId: "d",
        signer: { name: "S", email: "s@example.test" },
        pdf: PDF,
      })
      .catch((e) => e);
    expect(refused).toBeInstanceOf(DocumensoError);
    expect(refused.transient).toBe(false);
    expect(refused.message).toContain("bad file");
    expect(refused.message).not.toContain(TOKEN);
    f.failNext(503, "down");
    const down = await dx.look("x").catch((e) => e);
    expect(down.transient).toBe(true);
    const gone = documenso({
      url: "https://sign.test",
      token: TOKEN,
      fetch: async () => {
        throw new Error("connection refused");
      },
    });
    const dead = await gone.look("x").catch((e) => e);
    expect(dead).toMatchObject({ status: 0, transient: true });
    expect(dead.message).not.toContain(TOKEN);
  });
});

describe("eventOf", () => {
  const hook = (event: string, extra: Record<string, unknown> = {}) => ({
    event,
    createdAt: "2026-10-22T02:10:38.768Z",
    payload: {
      id: 7,
      envelopeId: "envelope_abc",
      externalId: "doc_1",
      status: "COMPLETED",
      completedAt: "2026-10-22T02:10:38.000Z",
      recipients: [
        {
          email: "sam@example.test",
          name: "Sam Rivera",
          token: "secret-signer-token",
          signedAt: "2026-10-22T02:10:37.000Z",
          signingStatus: "SIGNED",
        },
      ],
      ...extra,
    },
  });

  it("reduces a webhook to what Wren uses and drops the signer's token", () => {
    const ev = eventOf(hook("DOCUMENT_COMPLETED"));
    expect(ev).toEqual({
      event: "DOCUMENT_COMPLETED",
      envelopeId: "envelope_abc",
      externalId: "doc_1",
      status: "COMPLETED",
      completedAt: "2026-10-22T02:10:38.000Z",
      signer: {
        email: "sam@example.test",
        name: "Sam Rivera",
        signedAt: "2026-10-22T02:10:37.000Z",
        rejectionReason: null,
      },
    });
    expect(JSON.stringify(ev)).not.toContain("secret-signer-token");
  });

  it("reads a rejection's reason and answers null for anything else", () => {
    const ev = eventOf(
      hook("DOCUMENT_REJECTED", {
        recipients: [{ email: "sam@example.test", rejectionReason: "Wrong price" }],
      }),
    );
    expect(ev?.signer?.rejectionReason).toBe("Wrong price");
    expect(eventOf({ nope: 1 })).toBeNull();
    expect(eventOf(null)).toBeNull();
    expect(eventOf({ event: "DOCUMENT_SENT", payload: {} })).toBeNull();
  });
});
