/**
 * Linq (designs/2026-10-11-imessage.md): texts from our own line as iMessage first, then RCS,
 * then SMS, Linq's own fallback. Every text says what carried it, so a thread shows blue or
 * green. No 10DLC and no keyword replies here: the line is Linq's, and so is the carrier side.
 * Calls stay on Telnyx: a Telnyx body handed to `parseEvent` reads as Telnyx.
 *
 * Webhooks: subscribe with `?version=2026-02-03` (the flat message payload read here); the
 * Standard Webhooks signature is checked at the edge (`webhook.ts`, `verifyStandardWebhook`).
 */
import type {
  LookupResult,
  ProviderNumber,
  SendRequest,
  SendResult,
  SmsEvent,
  SmsProvider,
} from "./provider.js";
import type { Service } from "./schema.js";
import { parseTelnyxEvent } from "./telnyx.js";

const BASE = "https://api.linqapp.com/api/partner/v3";

/** Linq refuses a link in a new chat's first text. */
const FIRST_LINK_CODE = "1005";

interface LinqOptions {
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

type LinqError = { code?: number | string; message?: string };

function errorOf(json: unknown): LinqError {
  return (json as { error?: LinqError } | null)?.error ?? {};
}

/** Linq's transport name in ours; null for anything else. */
export function serviceOf(v: unknown): Service | null {
  const s = typeof v === "string" ? v.toLowerCase() : "";
  return s === "imessage" || s === "rcs" || s === "sms" ? s : null;
}

function textOf(parts: unknown): string {
  return (Array.isArray(parts) ? parts : [])
    .filter((p): p is { type: string; value: string } => p?.type === "text" && !!p.value)
    .map((p) => p.value)
    .join("\n");
}

export class LinqProvider implements SmsProvider {
  readonly name = "linq";
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: LinqOptions) {
    if (!opts.apiKey) throw new Error("linq: no API key (WREN_LINQ_API_KEY)");
    this.fetchImpl = opts.fetch ?? fetch;
  }

  private async call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; json: unknown }> {
    const res = await this.fetchImpl(`${BASE}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.opts.apiKey}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 20_000),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { error: { message: text.slice(0, 300) } };
    }
    return { status: res.status, json };
  }

  private async read(method: string, path: string, body?: unknown): Promise<unknown> {
    const { status, json } = await this.call(method, path, body);
    if (status >= 400) {
      const e = errorOf(json);
      throw new Error(`linq ${method} ${path}: HTTP ${status} ${e.code ?? ""} ${e.message ?? ""}`);
    }
    return json;
  }

  /** One chat per line and phone: Linq sends into the open chat when there is one. */
  async send(req: SendRequest): Promise<SendResult> {
    const { status, json } = await this.call("POST", "/chats", {
      from: req.from,
      to: [req.to],
      message: { parts: [{ type: "text", value: req.text }] },
    });
    if (status === 429 || status >= 500) {
      return {
        ok: false,
        retry: true,
        detail: `HTTP ${status} ${errorOf(json).message ?? ""}`.trim(),
      };
    }
    if (status >= 400) {
      const e = errorOf(json);
      const code = e.code === undefined ? null : String(e.code);
      return {
        ok: false,
        retry: false,
        code,
        detail:
          code === FIRST_LINK_CODE
            ? "a first text can't carry a link on iMessage; send the link after they reply"
            : `HTTP ${status} ${e.message ?? ""}`.trim(),
        optedOut: false,
      };
    }
    const chat = (
      json as { chat?: { service?: unknown; message?: { id?: string; service?: unknown } } }
    ).chat;
    const id = chat?.message?.id;
    if (!id) throw new Error(`linq: HTTP ${status} with no message id`);
    return {
      ok: true,
      providerId: id,
      parts: 1,
      costUsd: null,
      service: serviceOf(chat?.message?.service),
    };
  }

  /**
   * No carrier lookup at Linq: a phone iMessage or RCS reaches is a mobile; one neither reaches
   * is unknown, so enrollment passes it by rather than text it green blind.
   */
  async lookup(e164: string): Promise<LookupResult> {
    const check = async (kind: "imessage" | "rcs") =>
      (
        (await this.read("POST", `/capability/check_${kind}`, { address: e164 })) as {
          available?: boolean;
        } | null
      )?.available === true;
    const imessage = await check("imessage");
    const rcs = imessage ? null : await check("rcs");
    return {
      e164,
      lineType: imessage || rcs ? "mobile" : "unknown",
      carrier: null,
      raw: { imessage, rcs },
      imessage,
    };
  }

  async listNumbers(): Promise<ProviderNumber[]> {
    const body = (await this.read("GET", "/phone_numbers")) as {
      phone_numbers?: { id: string; phone_number: string }[];
    } | null;
    return (body?.phone_numbers ?? []).map((n) => ({ e164: n.phone_number, providerId: n.id }));
  }

  /** Linq bills per line, no prepaid balance. */
  async balance(): Promise<number | null> {
    return null;
  }

  parseEvent(body: unknown): SmsEvent {
    return parseLinqEvent(body);
  }
}

type MessageData = {
  id?: string;
  direction?: string;
  service?: unknown;
  parts?: unknown;
  sender_handle?: { handle?: string };
  chat?: { owner_handle?: { handle?: string } | null };
  sent_at?: string | null;
  delivered_at?: string | null;
  read_at?: string | null;
};

type FailedData = {
  message_id?: string;
  code?: number | string;
  reason?: string;
  service?: unknown;
  failed_at?: string;
};

/**
 * A Linq webhook body → our event; a Telnyx body (calls) reads as Telnyx. Pure: the signature
 * was checked at the edge.
 */
export function parseLinqEvent(body: unknown): SmsEvent {
  const b = (body ?? {}) as {
    event_type?: unknown;
    event_id?: unknown;
    webhook_version?: unknown;
    created_at?: unknown;
    data?: unknown;
  };
  if (typeof b.event_type !== "string") return parseTelnyxEvent(body);
  const type = b.event_type;
  const eventId = String(b.event_id ?? "");
  if (!eventId) throw new Error("linq webhook: no event_id");
  if (String(b.webhook_version ?? "").startsWith("2025"))
    throw new Error("linq webhook: subscribe with ?version=2026-02-03");
  const created = typeof b.created_at === "string" ? b.created_at : new Date().toISOString();
  if (type === "message.failed") {
    const d = (b.data ?? {}) as FailedData;
    if (!d.message_id) return { kind: "ignored", eventId, type };
    return {
      kind: "status",
      eventId,
      type,
      messageId: d.message_id,
      status: "failed",
      at: new Date(d.failed_at ?? created),
      code: d.code === undefined ? null : String(d.code),
      detail: d.reason ?? null,
      parts: null,
      costUsd: null,
      service: serviceOf(d.service),
    };
  }
  const d = (b.data ?? {}) as MessageData;
  if (!d.id) return { kind: "ignored", eventId, type };
  if (type === "message.received" && d.direction === "inbound") {
    return {
      kind: "inbound",
      eventId,
      type,
      messageId: d.id,
      from: String(d.sender_handle?.handle ?? ""),
      to: String(d.chat?.owner_handle?.handle ?? ""),
      text: textOf(d.parts),
      at: new Date(d.sent_at ?? created),
      service: serviceOf(d.service),
    };
  }
  if (d.direction !== "outbound") return { kind: "ignored", eventId, type };
  // A read text was delivered: our states stop there.
  const status =
    type === "message.sent"
      ? "sent"
      : type === "message.delivered" || type === "message.read"
        ? "delivered"
        : null;
  if (!status) return { kind: "ignored", eventId, type };
  return {
    kind: "status",
    eventId,
    type,
    messageId: d.id,
    status,
    at: new Date((status === "delivered" ? d.delivered_at : d.sent_at) ?? created),
    code: null,
    detail: null,
    parts: null,
    costUsd: null,
    service: serviceOf(d.service),
  };
}
