/**
 * Telnyx: the one file that names the vendor (PH-D8). Messaging v2, number
 * lookup, phone numbers, balance, 10DLC, keyword auto-replies, and the webhook body. Auth is the API key as
 * a bearer; it never leaves this file's requests.
 *
 * https://developers.telnyx.com/api/messaging/send-message
 */

import type {
  CampaignState,
  DeliveryStatus,
  KeywordReplies,
  LookupResult,
  NumberAssignment,
  ProviderNumber,
  Registration,
  SendRequest,
  SendResult,
  SmsEvent,
  SmsProvider,
} from "./provider.js";
import { type LineType, PHONE_COUNTRIES } from "./schema.js";

const BASE = "https://api.telnyx.com/v2";
/** "Blocked due to STOP message": the recipient opted out of this number with the carrier. */
const STOPPED_CODES: ReadonlySet<string> = new Set(["40300"]);

export interface TelnyxOptions {
  apiKey: string;
  /** Messages go out under this profile (it holds the webhook URL and the 10DLC campaign's numbers). */
  messagingProfileId?: string | null;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

interface TelnyxError {
  code?: string;
  title?: string;
  detail?: string;
}

function firstError(body: unknown): TelnyxError {
  const errors = (body as { errors?: TelnyxError[] } | null)?.errors;
  return errors?.[0] ?? {};
}

function money(cost: unknown): number | null {
  const amount = (cost as { amount?: string | number } | null)?.amount;
  if (amount === undefined || amount === null) return null;
  const n = Number(amount);
  return Number.isFinite(n) ? n : null;
}

/** Telnyx's carrier type strings → ours. "fixed line or mobile" stays unknown: it is not a yes. */
export function lineTypeOf(type: string | null | undefined): LineType {
  const t = (type ?? "").toLowerCase();
  if (t === "mobile" || t === "wireless") return "mobile";
  if (t === "fixed line" || t === "landline") return "landline";
  if (t.includes("voip")) return "voip";
  if (t.includes("toll")) return "toll_free";
  return "unknown";
}

/** Carriers have approved the campaign: numbers may be attached. */
const APPROVED: ReadonlySet<string> = new Set(["MNO_ACCEPTED", "MNO_PROVISIONED"]);
/** Dead ends: a fix and a resubmit, by hand. */
const REJECTED: ReadonlySet<string> = new Set([
  "TCR_FAILED",
  "TCR_SUSPENDED",
  "TCR_EXPIRED",
  "TELNYX_FAILED",
  "MNO_REJECTED",
  "MNO_PROVISIONING_FAILED",
]);

/** `failureReasons` comes as a string or a list of `{ description }`. */
function reasons(raw: unknown): string | null {
  if (typeof raw === "string") return raw || null;
  if (!Array.isArray(raw)) return null;
  const text = raw
    .map((r) =>
      typeof r === "string" ? r : String((r as { description?: string }).description ?? ""),
    )
    .filter(Boolean)
    .join(" | ");
  return text || null;
}

/** `/10dlc/phone_number_campaigns` body → ours. */
export function assignmentOf(body: unknown): NumberAssignment {
  const b = (body ?? {}) as {
    assignmentStatus?: string;
    campaignId?: string;
    failureReasons?: unknown;
  };
  const raw = b.assignmentStatus ?? "";
  const status: NumberAssignment["status"] =
    raw === "ASSIGNED" ? "assigned" : raw.includes("FAIL") ? "failed" : "pending";
  return {
    status,
    campaignId: b.campaignId ?? null,
    detail: reasons(b.failureReasons) ?? (raw || null),
  };
}

/** `/10dlc/campaign/{id}` body → ours. Old failure reasons linger after a resubmit: shown only when rejected. */
export function campaignOf(body: unknown): CampaignState {
  const b = (body ?? {}) as { campaignStatus?: string; failureReasons?: unknown };
  const raw = b.campaignStatus ?? "UNKNOWN";
  if (APPROVED.has(raw)) return { status: "approved", raw, detail: null };
  if (REJECTED.has(raw)) return { status: "rejected", raw, detail: reasons(b.failureReasons) };
  return { status: "pending", raw, detail: null };
}

function statusOf(status: string | undefined): DeliveryStatus | null {
  switch (status) {
    case "sent":
      return "sent";
    case "delivered":
      return "delivered";
    case "sending_failed":
    case "delivery_failed":
      return "failed";
    case "delivery_unconfirmed":
      return "unconfirmed";
    default:
      return null;
  }
}

export class TelnyxProvider implements SmsProvider {
  readonly name = "telnyx";
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: TelnyxOptions) {
    if (!opts.apiKey) throw new Error("telnyx: no API key (WREN_TELNYX_API_KEY)");
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
      json = { errors: [{ detail: text.slice(0, 300) }] };
    }
    return { status: res.status, json };
  }

  private async read(path: string): Promise<unknown> {
    const { status, json } = await this.call("GET", path);
    if (status >= 400) {
      const e = firstError(json);
      throw new Error(
        `telnyx GET ${path.split("?")[0]}: HTTP ${status} ${e.code ?? ""} ${e.detail ?? e.title ?? ""}`.trim(),
      );
    }
    return (json as { data?: unknown }).data;
  }

  private async write(method: string, path: string, body?: unknown): Promise<unknown> {
    const { status, json } = await this.call(method, path, body);
    if (status >= 400) {
      const e = firstError(json);
      throw new Error(
        `telnyx ${method} ${path.replace(/\/[0-9a-f-]{36}/g, "/…")}: HTTP ${status} ${e.code ?? ""} ${e.detail ?? e.title ?? ""}`.trim(),
      );
    }
    return (json as { data?: unknown } | null)?.data;
  }

  async send(req: SendRequest): Promise<SendResult> {
    const { status, json } = await this.call("POST", "/messages", {
      from: req.from,
      to: req.to,
      text: req.text,
      ...(this.opts.messagingProfileId
        ? { messaging_profile_id: this.opts.messagingProfileId }
        : {}),
    });
    if (status === 429 || status >= 500) {
      const e = firstError(json);
      return {
        ok: false,
        retry: true,
        detail: `HTTP ${status} ${e.detail ?? e.title ?? ""}`.trim(),
      };
    }
    if (status >= 400) {
      const e = firstError(json);
      const code = e.code ?? null;
      return {
        ok: false,
        retry: false,
        code,
        detail: `HTTP ${status} ${e.title ?? ""}${e.detail ? `: ${e.detail}` : ""}`.trim(),
        optedOut: code !== null && STOPPED_CODES.has(code),
      };
    }
    const data = (json as { data?: { id?: string; parts?: number; cost?: unknown } }).data;
    if (!data?.id) throw new Error(`telnyx: HTTP ${status} with no message id`);
    return { ok: true, providerId: data.id, parts: data.parts ?? null, costUsd: money(data.cost) };
  }

  async lookup(e164: string): Promise<LookupResult> {
    const data = (await this.read(`/number_lookup/${encodeURIComponent(e164)}?type=carrier`)) as {
      carrier?: { name?: string; type?: string };
      portability?: { line_type?: string };
    } | null;
    return {
      e164,
      lineType: lineTypeOf(data?.carrier?.type ?? data?.portability?.line_type),
      carrier: data?.carrier?.name ?? null,
      raw: data,
    };
  }

  async listNumbers(): Promise<ProviderNumber[]> {
    const out: ProviderNumber[] = [];
    for (let page = 1; page <= 20; page += 1) {
      const { status, json } = await this.call(
        "GET",
        `/phone_numbers?page[number]=${page}&page[size]=250`,
      );
      if (status >= 400) {
        const e = firstError(json);
        throw new Error(
          `telnyx GET /phone_numbers: HTTP ${status} ${e.detail ?? e.title ?? ""}`.trim(),
        );
      }
      const body = json as {
        data?: {
          id: string;
          phone_number: string;
          status?: string;
          messaging_profile_id?: string | null;
        }[];
        meta?: { total_pages?: number };
      };
      for (const n of body.data ?? []) {
        if (n.status && n.status !== "active") continue;
        if (this.opts.messagingProfileId && n.messaging_profile_id !== this.opts.messagingProfileId)
          continue;
        out.push({ e164: n.phone_number, providerId: n.id });
      }
      if (page >= (body.meta?.total_pages ?? 1)) break;
    }
    return out;
  }

  async balance(): Promise<number | null> {
    const data = (await this.read("/balance")) as { balance?: string | number } | null;
    const n = Number(data?.balance);
    return Number.isFinite(n) ? n : null;
  }

  parseEvent(body: unknown): SmsEvent {
    return parseTelnyxEvent(body);
  }

  /** 10DLC answers come back bare, not under `data`. */
  private async tenDlc(method: string, path: string, body?: unknown): Promise<unknown> {
    const { status, json } = await this.call(method, `/10dlc${path}`, body);
    if (status === 404 && method === "GET") return null;
    if (status >= 400) {
      const e = firstError(json);
      throw new Error(
        `telnyx ${method} /10dlc${path.split("/").slice(0, 2).join("/")}: HTTP ${status} ${e.code ?? ""} ${e.detail ?? e.title ?? ""}`.trim(),
      );
    }
    return json;
  }

  readonly registration: Registration = {
    campaign: async (campaignId) => {
      const body = await this.tenDlc("GET", `/campaign/${encodeURIComponent(campaignId)}`);
      if (body === null) throw new Error(`telnyx: no 10DLC campaign ${campaignId}`);
      return campaignOf(body);
    },
    number: async (e164) => {
      const body = await this.tenDlc("GET", `/phone_number_campaigns/${encodeURIComponent(e164)}`);
      return body === null
        ? { status: "none", campaignId: null, detail: null }
        : assignmentOf(body);
    },
    assign: async (e164, campaignId) =>
      assignmentOf(
        await this.tenDlc("POST", "/phone_number_campaigns", { phoneNumber: e164, campaignId }),
      ),
  };

  /** Auto-responses on the messaging profile: one per keyword per country, updated in place. */
  readonly keywordReplies: KeywordReplies = {
    set: async (keyword, words, text) => {
      const profile = this.opts.messagingProfileId;
      if (!profile)
        throw new Error(
          "telnyx: keyword replies live on the messaging profile (WREN_TELNYX_MESSAGING_PROFILE_ID)",
        );
      const base = `/messaging_profiles/${encodeURIComponent(profile)}/autoresp_configs`;
      const have = ((await this.read(`${base}?page[size]=250`)) ?? []) as {
        id: string;
        op: string;
        country_code: string;
      }[];
      const mine = have.filter((c) => c.op === keyword);
      if (text === null) {
        for (const c of mine) await this.write("DELETE", `${base}/${c.id}`);
        return;
      }
      for (const country of PHONE_COUNTRIES) {
        const body = { op: keyword, keywords: words, resp_text: text, country_code: country };
        const found = mine.find((c) => c.country_code === country);
        await (found
          ? this.write("PUT", `${base}/${found.id}`, body)
          : this.write("POST", base, body));
      }
    },
  };
}

/** A Telnyx webhook body → our event. Pure: the signature was checked at the edge. */
export function parseTelnyxEvent(body: unknown): SmsEvent {
  const data = (body as { data?: Record<string, unknown> } | null)?.data;
  const eventId = String(data?.id ?? "");
  const type = String(data?.event_type ?? "");
  if (!eventId || !type) throw new Error("telnyx webhook: no data.id or data.event_type");
  const p = (data?.payload ?? {}) as {
    id?: string;
    text?: string;
    parts?: number;
    cost?: unknown;
    from?: { phone_number?: string };
    to?: { phone_number?: string; status?: string }[];
    errors?: TelnyxError[];
    received_at?: string;
    sent_at?: string;
    completed_at?: string;
  };
  const occurred = String(data?.occurred_at ?? new Date().toISOString());
  if (type === "message.received") {
    return {
      kind: "inbound",
      eventId,
      type,
      messageId: String(p.id ?? eventId),
      from: String(p.from?.phone_number ?? ""),
      to: String(p.to?.[0]?.phone_number ?? ""),
      text: String(p.text ?? ""),
      at: new Date(p.received_at ?? occurred),
    };
  }
  if ((type === "message.sent" || type === "message.finalized") && p.id) {
    const status = statusOf(p.to?.[0]?.status);
    if (status) {
      const e = p.errors?.[0];
      return {
        kind: "status",
        eventId,
        type,
        messageId: p.id,
        status,
        at: new Date(p.completed_at ?? p.sent_at ?? occurred),
        code: e?.code ?? null,
        detail: e ? `${e.title ?? ""}${e.detail ? `: ${e.detail}` : ""}` : null,
        parts: p.parts ?? null,
        costUsd: money(p.cost),
      };
    }
  }
  return { kind: "ignored", eventId, type };
}
