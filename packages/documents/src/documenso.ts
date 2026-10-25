/**
 * A thin client for Documenso's REST API v2 (designs/2026-10-21-esign-and-newsletter.md).
 * Documenso is self-hosted and signs the PDF with our certificate. This covers the five calls
 * the Documents app needs and no more. Every shape here was probed against Documenso 2.21.0.
 * The API token goes in one header and never in a log line or an error.
 *
 * Documenso sends no email of ours: the envelope is made with `distributionMethod: NONE` and every
 * email setting off. Wren sends the signing link from the client's name.
 */
import { createHash } from "node:crypto";
import { z } from "zod";

type DocumensoFetch = (url: string, init?: RequestInit) => Promise<Response>;

interface DocumensoConfig {
  /** The public base URL: signers open `<url>/sign/<token>`. No trailing path. */
  url: string;
  token: string;
  fetch?: DocumensoFetch;
}

export class DocumensoError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(`documenso ${status}: ${message}`);
  }
  /** Worth another try: the server or the network, not a refusal of this request. */
  get transient() {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

/** Every email Documenso can send, off. */
const NO_EMAIL = {
  recipientSigningRequest: false,
  recipientRemoved: false,
  recipientSigned: false,
  documentPending: false,
  documentCompleted: false,
  documentDeleted: false,
  ownerDocumentCompleted: false,
  ownerRecipientExpired: false,
  ownerDocumentCreated: false,
};

const RECIPIENT = z.looseObject({
  email: z.string(),
  name: z.string().nullish(),
  token: z.string().nullish(),
  signingUrl: z.string().nullish(),
});
const ENVELOPE = z.looseObject({
  status: z.string(),
  recipients: z.array(RECIPIENT).default([]),
  envelopeItems: z.array(z.looseObject({ id: z.string() })).default([]),
});

interface SealedBytes {
  pdf: Uint8Array;
  certificate: Uint8Array;
  audit: Uint8Array;
  /** SHA-256 of the sealed PDF, hex. */
  sha256: string;
}

export function documenso(cfg: DocumensoConfig) {
  const base = cfg.url.replace(/\/+$/, "");
  const doFetch: DocumensoFetch = cfg.fetch ?? ((u, i) => fetch(u, i));

  async function send(method: string, path: string, body?: string | FormData, json = false) {
    let res: Response;
    try {
      res = await doFetch(`${base}/api/v2${path}`, {
        method,
        headers: {
          Authorization: cfg.token,
          ...(json ? { "Content-Type": "application/json" } : {}),
        },
        ...(body === undefined ? {} : { body }),
      });
    } catch (err) {
      throw new DocumensoError(0, err instanceof Error ? err.message : "no answer");
    }
    if (!res.ok) {
      const text = await res.text();
      let message = text.slice(0, 200);
      try {
        message = String((JSON.parse(text) as { message?: unknown }).message ?? message);
      } catch {}
      throw new DocumensoError(res.status, message);
    }
    return res;
  }
  const call = async <S extends z.ZodType>(
    schema: S,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<z.infer<S>> => {
    const res = await send(
      method,
      path,
      body === undefined ? undefined : JSON.stringify(body),
      true,
    );
    const text = await res.text();
    return schema.parse(text ? JSON.parse(text) : {});
  };
  async function look(envelopeId: string): Promise<{ status: string; url: string | null }> {
    const e = await call(ENVELOPE, "GET", `/envelope/${encodeURIComponent(envelopeId)}`);
    return { status: e.status, url: e.recipients[0] ? signUrl(e.recipients[0]) : null };
  }
  const bytes = async (path: string) =>
    new Uint8Array(await (await send("GET", path)).arrayBuffer());
  const signUrl = (r: z.infer<typeof RECIPIENT>) =>
    r.signingUrl ?? (r.token ? `${base}/sign/${r.token}` : null);

  return {
    /**
     * A draft envelope for one signer. The PDF holds `{{signature, r1}}` and `{{date, r1}}`;
     * Documenso turns them into the signer's fields. Returns the envelope's id.
     */
    async create(o: {
      title: string;
      /** Wren's document id, so a webhook can find it again. */
      externalId: string;
      signer: { name: string; email: string };
      pdf: Uint8Array;
    }): Promise<string> {
      const form = new FormData();
      form.append(
        "payload",
        new Blob(
          [
            JSON.stringify({
              type: "DOCUMENT",
              title: o.title,
              externalId: o.externalId,
              recipients: [{ email: o.signer.email, name: o.signer.name, role: "SIGNER" }],
              meta: { distributionMethod: "NONE", emailSettings: NO_EMAIL },
            }),
          ],
          { type: "application/json" },
        ),
      );
      form.append(
        "files",
        new Blob([Buffer.from(o.pdf)], { type: "application/pdf" }),
        "document.pdf",
      );
      const res = await send("POST", "/envelope/create", form);
      return z.object({ id: z.string() }).parse(await res.json()).id;
    },

    /**
     * The envelope goes live. Returns the signer's link. A repeat finds it live already and
     * returns the same link, so a retried step is safe.
     */
    async distribute(envelopeId: string): Promise<string> {
      const was = await look(envelopeId);
      if (was.status === "PENDING" && was.url) return was.url;
      if (was.status !== "DRAFT")
        throw new DocumensoError(409, `the envelope is ${was.status.toLowerCase()}`);
      const out = await call(
        z.looseObject({ recipients: z.array(RECIPIENT).default([]) }),
        "POST",
        "/envelope/distribute",
        { envelopeId },
      );
      const url = out.recipients[0] ? signUrl(out.recipients[0]) : null;
      if (!url) throw new DocumensoError(502, "no signing link in the answer");
      return url;
    },

    /** The signer's link again, for a reminder; and the envelope's status. */
    look,

    /** The sealed PDF, the signing certificate and the audit log of a completed envelope. */
    async sealed(envelopeId: string): Promise<SealedBytes> {
      const id = encodeURIComponent(envelopeId);
      const e = await call(ENVELOPE, "GET", `/envelope/${id}`);
      const item = e.envelopeItems[0]?.id;
      if (!item) throw new DocumensoError(502, "the envelope has no file");
      const pdf = await bytes(`/envelope/item/${encodeURIComponent(item)}/download?version=signed`);
      return {
        pdf,
        certificate: await bytes(`/envelope/${id}/certificate/download`),
        audit: await bytes(`/envelope/${id}/audit-log/download`),
        sha256: createHash("sha256").update(pdf).digest("hex"),
      };
    },

    /**
     * Call it off: a live envelope is cancelled, a draft deleted. A completed one stays (it is
     * signed). Returns what was done.
     */
    async withdraw(envelopeId: string, reason: string): Promise<"cancelled" | "deleted" | "kept"> {
      const { status } = await look(envelopeId);
      const ok = z.looseObject({});
      if (status === "PENDING") {
        await call(ok, "POST", "/envelope/cancel", { envelopeId, reason: reason.slice(0, 500) });
        return "cancelled";
      }
      if (status === "DRAFT") {
        await call(ok, "POST", "/envelope/delete", { envelopeId });
        return "deleted";
      }
      return "kept";
    },
  };
}
export type Documenso = ReturnType<typeof documenso>;

/** What a webhook says, reduced to what Wren uses. The signer's token is dropped here. */
const HOOK = z.looseObject({
  event: z.string(),
  payload: z.looseObject({
    envelopeId: z.string().min(1),
    externalId: z.string().nullish(),
    status: z.string().nullish(),
    completedAt: z.string().nullish(),
    recipients: z
      .array(
        z.looseObject({
          email: z.string(),
          name: z.string().nullish(),
          signedAt: z.string().nullish(),
          rejectionReason: z.string().nullish(),
          signingStatus: z.string().nullish(),
        }),
      )
      .default([]),
  }),
});
interface DocumensoEvent {
  event: string;
  envelopeId: string;
  externalId: string | null;
  status: string | null;
  completedAt: string | null;
  signer: {
    email: string;
    name: string | null;
    signedAt: string | null;
    rejectionReason: string | null;
  } | null;
}

/** A webhook body as an event; null when it is not a Documenso document event. */
export function eventOf(body: unknown): DocumensoEvent | null {
  const p = HOOK.safeParse(body);
  if (!p.success) return null;
  const { event, payload } = p.data;
  const r = payload.recipients[0];
  return {
    event,
    envelopeId: payload.envelopeId,
    externalId: payload.externalId ?? null,
    status: payload.status ?? null,
    completedAt: payload.completedAt ?? null,
    signer: r
      ? {
          email: r.email,
          name: r.name ?? null,
          signedAt: r.signedAt ?? null,
          rejectionReason: r.rejectionReason ?? null,
        }
      : null,
  };
}
