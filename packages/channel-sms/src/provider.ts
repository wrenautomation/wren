/**
 * The SMS provider port. Everything the channel needs from a carrier is here,
 * in our words; `telnyx.ts` is the one file that speaks a vendor's API, and
 * `FakeProvider` is the one tests and dry runs use. Swapping vendors (PH-D8's
 * Twilio fallback) is one new file behind this interface.
 *
 * `send` answers three ways and throws for a fourth: accepted (an id we can
 * match webhooks to), rejected for good (a 4xx: never retried), try later
 * (429/5xx: nothing was sent). A thrown error means we cannot know whether it
 * went out; the caller marks the message `unknown` and never resends it.
 */
import type { LineType } from "./schema.js";

export interface SendRequest {
  from: string;
  to: string;
  text: string;
}

export type SendResult =
  | { ok: true; providerId: string; parts: number | null; costUsd: number | null }
  | {
      ok: false;
      retry: false;
      code: string | null;
      detail: string;
      /** The carrier says this recipient texted STOP to us before. */
      optedOut: boolean;
    }
  | { ok: false; retry: true; detail: string };

export interface LookupResult {
  e164: string;
  lineType: LineType;
  carrier: string | null;
  raw: unknown;
}

export interface ProviderNumber {
  e164: string;
  providerId: string;
}

export type DeliveryStatus = "sent" | "delivered" | "failed" | "unconfirmed";

/** A webhook, read into our words. */
export type SmsEvent =
  | {
      kind: "status";
      eventId: string;
      type: string;
      messageId: string;
      status: DeliveryStatus;
      at: Date;
      code: string | null;
      detail: string | null;
      parts: number | null;
      costUsd: number | null;
    }
  | {
      kind: "inbound";
      eventId: string;
      type: string;
      messageId: string;
      from: string;
      to: string;
      text: string;
      at: Date;
    }
  | { kind: "ignored"; eventId: string; type: string };

export interface SmsProvider {
  readonly name: string;
  send(req: SendRequest): Promise<SendResult>;
  lookup(e164: string): Promise<LookupResult>;
  /** The numbers the account owns that can text. */
  listNumbers(): Promise<ProviderNumber[]>;
  /** Account balance in USD, or null when the provider has no prepaid balance. */
  balance(): Promise<number | null>;
  parseEvent(body: unknown): SmsEvent;
}

/**
 * In memory, deterministic. `sent` is what went out; `reject` / `retry` /
 * `explode` script the next sends to a number; `landlines` answer lookups.
 * Its webhook shape is the `SmsEvent` itself with ISO dates, so tests can post
 * exactly what they mean.
 */
export class FakeProvider implements SmsProvider {
  readonly name = "fake";
  readonly sent: (SendRequest & { providerId: string })[] = [];
  readonly reject = new Map<string, { code: string; detail: string; optedOut?: boolean }>();
  readonly retry = new Set<string>();
  readonly explode = new Set<string>();
  readonly landlines = new Set<string>();
  numbers: ProviderNumber[] = [];
  usd: number | null = 25;
  private seq = 0;

  async send(req: SendRequest): Promise<SendResult> {
    if (this.explode.has(req.to)) throw new Error("fake: connection reset");
    if (this.retry.has(req.to)) return { ok: false, retry: true, detail: "fake: 429 slow down" };
    const rejected = this.reject.get(req.to);
    if (rejected) {
      return {
        ok: false,
        retry: false,
        code: rejected.code,
        detail: rejected.detail,
        optedOut: rejected.optedOut ?? false,
      };
    }
    this.seq += 1;
    const providerId = `fake-${this.seq}`;
    this.sent.push({ ...req, providerId });
    return { ok: true, providerId, parts: 1, costUsd: 0.004 };
  }

  async lookup(e164: string): Promise<LookupResult> {
    const lineType: LineType = this.landlines.has(e164) ? "landline" : "mobile";
    return { e164, lineType, carrier: "Fake Wireless", raw: { fake: true } };
  }

  async listNumbers(): Promise<ProviderNumber[]> {
    return this.numbers;
  }

  async balance(): Promise<number | null> {
    return this.usd;
  }

  parseEvent(body: unknown): SmsEvent {
    const event = body as SmsEvent & { at?: string };
    if (event.kind === "ignored") return event;
    return { ...event, at: new Date(event.at as unknown as string) } as SmsEvent;
  }
}
