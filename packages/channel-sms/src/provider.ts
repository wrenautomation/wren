/**
 * The SMS provider port. Everything the channel needs from a carrier is here,
 * in our words; `telnyx.ts` is the one file that speaks a vendor's API, and
 * `FakeProvider` is the one tests and local dry runs use, and `NoProvider` is
 * what a deploy runs before a carrier account exists. Swapping vendors (PH-D8's
 * Twilio fallback) is one new file behind this interface.
 *
 * `send` answers three ways and throws for a fourth: accepted (an id we can
 * match webhooks to), rejected for good (a 4xx: never retried), try later
 * (429/5xx: nothing was sent). A thrown error means we cannot know whether it
 * went out; the caller marks the message `unknown` and never resends it.
 */
import { SmsRefusal } from "./refusal.js";
import type { LineType } from "./schema.js";
import type { Keyword } from "./templates.js";

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
  | {
      /**
       * A voice call to one of our numbers (Call Control): it rang, our app picked up, a person
       * picked up (bridged), or it ended with the carrier's cause. Every event of one call
       * carries its `callId`.
       */
      kind: "call";
      eventId: string;
      type: string;
      callId: string;
      stage: CallStage;
      from: string;
      to: string;
      at: Date;
      /** On `ended`: the hangup cause (`normal_clearing`, `user_busy`, `timeout`). */
      cause: string | null;
    }
  | { kind: "ignored"; eventId: string; type: string };

export type CallStage = "ringing" | "answered" | "bridged" | "ended";

export interface SmsProvider {
  readonly name: string;
  send(req: SendRequest): Promise<SendResult>;
  lookup(e164: string): Promise<LookupResult>;
  /** The numbers the account owns that can text. */
  listNumbers(): Promise<ProviderNumber[]>;
  /** Account balance in USD, or null when the provider has no prepaid balance. */
  balance(): Promise<number | null>;
  parseEvent(body: unknown): SmsEvent;
  /** US 10DLC registration. Absent = this provider has none (`none`). */
  readonly registration?: Registration;
  /** Replies the provider sends itself to HELP/START/STOP. Absent = it has none. */
  readonly keywordReplies?: KeywordReplies;
}

export interface KeywordReplies {
  /** `text` answers `words` from now on, in every country we text; null removes it (the provider's default answers). */
  set(keyword: Keyword, words: readonly string[], text: string | null): Promise<void>;
}

export class FakeKeywordReplies implements KeywordReplies {
  readonly replies = new Map<Keyword, { words: readonly string[]; text: string }>();
  /** The next set throws this. */
  fail: string | null = null;

  async set(keyword: Keyword, words: readonly string[], text: string | null): Promise<void> {
    if (this.fail) throw new Error(this.fail);
    if (text === null) this.replies.delete(keyword);
    else this.replies.set(keyword, { words, text });
  }
}

/**
 * The registered campaign as the carriers see it. `approved` = numbers may be
 * attached; `rejected` = it needs a fix and a resubmit, by hand.
 */
export interface CampaignState {
  status: "pending" | "approved" | "rejected";
  /** The provider's own word for it (`MNO_PENDING`), for the operator. */
  raw: string;
  detail: string | null;
}

/** One number's attachment to a campaign. `none` = never asked. */
export interface NumberAssignment {
  status: "none" | "pending" | "assigned" | "failed";
  campaignId: string | null;
  detail: string | null;
}

export interface Registration {
  campaign(campaignId: string): Promise<CampaignState>;
  number(e164: string): Promise<NumberAssignment>;
  /** Ask the carriers to attach the number. Throws when the provider refuses the request. */
  assign(e164: string, campaignId: string): Promise<NumberAssignment>;
}

/** In memory: `campaignState` scripts the campaign; an assign is pending until `settle()`. */
export class FakeRegistration implements Registration {
  campaignState: CampaignState = { status: "pending", raw: "MNO_PENDING", detail: null };
  readonly assignments = new Map<string, NumberAssignment>();

  async campaign(): Promise<CampaignState> {
    return this.campaignState;
  }

  async number(e164: string): Promise<NumberAssignment> {
    return this.assignments.get(e164) ?? { status: "none", campaignId: null, detail: null };
  }

  async assign(e164: string, campaignId: string): Promise<NumberAssignment> {
    if (this.campaignState.status !== "approved")
      throw new Error(`fake: campaign ${this.campaignState.raw}, cannot assign`);
    const a: NumberAssignment = { status: "pending", campaignId, detail: null };
    this.assignments.set(e164, a);
    return a;
  }

  /** The carriers finish every pending assignment. */
  settle(): void {
    for (const [e164, a] of this.assignments)
      if (a.status === "pending") this.assignments.set(e164, { ...a, status: "assigned" });
  }
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
  readonly registration = new FakeRegistration();
  readonly keywordReplies = new FakeKeywordReplies();
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

/**
 * No carrier yet: the default, so a deploy never fakes a send, a lookup or a
 * number. Reading, adding contacts and the inbox work; anything that needs a
 * carrier is refused, and the send tick holds every due text as gated.
 */
export class NoProvider implements SmsProvider {
  readonly name = "none";

  private refuse(): never {
    throw new SmsRefusal("no SMS provider yet: set WREN_SMS_PROVIDER=telnyx and its keys");
  }

  async send(): Promise<SendResult> {
    this.refuse();
  }

  async lookup(): Promise<LookupResult> {
    this.refuse();
  }

  async listNumbers(): Promise<ProviderNumber[]> {
    this.refuse();
  }

  async balance(): Promise<number | null> {
    return null;
  }

  parseEvent(): SmsEvent {
    this.refuse();
  }
}
