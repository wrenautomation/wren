/**
 * A client's texts on whose Telnyx key (designs/2026-10-07-vendor-keys.md): its own, from the key
 * store, or Wren's, gated and metered on its share. A client on its own key with none saved
 * sends nothing: never Wren's account in its place.
 *
 * `send` keeps the provider's contract: a refusal, a stop or a failure before the carrier is "try
 * later" (nothing left), never a throw (a throw means "maybe sent"). Every accepted text is
 * metered, in parts and dollars. Other calls (lookup, balance, numbers, registration, keyword
 * replies) run on the same key, unmetered.
 */
import type { VendorKey, VendorKeys } from "@wren/core/vendor-keys";
import { scrubKey } from "@wren/core/vendor-keys";
import type {
  KeywordReplies,
  LookupResult,
  ProviderNumber,
  Registration,
  SendRequest,
  SendResult,
  SmsEvent,
  SmsProvider,
} from "./provider.js";

export interface KeyedOptions {
  client: string;
  /** One invocation's resolver: its key cached for its life. */
  keys: VendorKeys;
  /** Wren's provider: a managed client's texts. */
  managed: SmsProvider;
  /** The client's own account, on its key. */
  own: (key: string) => SmsProvider;
  part?: string;
  runId?: string | null;
}

const WHY = "telnyx for the client's texts";

export function keyedProvider(o: KeyedOptions): SmsProvider {
  let mine: { key: string; p: SmsProvider } | null = null;
  const on = (k: VendorKey): SmsProvider => {
    if (k.mode !== "own") return o.managed;
    if (mine?.key !== k.key) mine = { key: k.key, p: o.own(k.key) };
    return mine.p;
  };
  /** An unmetered call on the client's key; its error never carries the key. */
  const run = async <T>(fn: (p: SmsProvider) => Promise<T>): Promise<T> => {
    const k = await o.keys.key(o.client, "telnyx", WHY);
    try {
      return await fn(on(k));
    } catch (err) {
      throw scrubKey(err, k.key);
    }
  };
  const registration: Registration | undefined = o.managed.registration && {
    campaign: (id) => run((p) => need(p.registration, "registration").campaign(id)),
    number: (e164) => run((p) => need(p.registration, "registration").number(e164)),
    assign: (e164, id) => run((p) => need(p.registration, "registration").assign(e164, id)),
  };
  const keywordReplies: KeywordReplies | undefined = o.managed.keywordReplies && {
    set: (kw, words, text) =>
      run((p) => need(p.keywordReplies, "keyword replies").set(kw, words, text)),
  };
  return {
    name: o.managed.name,
    async send(req: SendRequest): Promise<SendResult> {
      let reached = false;
      let answer: SendResult | null = null;
      try {
        return await o.keys.use<SendResult>(
          {
            client: o.client,
            vendor: "telnyx",
            why: WHY,
            part: o.part ?? "sms.send",
            runId: o.runId ?? null,
            spent: (r) =>
              r.ok
                ? {
                    units: r.parts ?? 1,
                    ...(r.costUsd !== null ? { micros: Math.round(r.costUsd * 1e6) } : {}),
                  }
                : null,
          },
          async (k) => {
            reached = true;
            try {
              answer = await on(k).send(req);
            } catch (err) {
              throw scrubKey(err, k.key);
            }
            return answer;
          },
        );
      } catch (err) {
        // Refused before the carrier saw it (no key, no mode, a cap): nothing left.
        if (!reached)
          return {
            ok: false,
            retry: true,
            detail: err instanceof Error ? err.message : String(err),
          };
        // The carrier answered and only the meter failed: the answer stands.
        if (answer) return answer;
        throw err;
      }
    },
    lookup: (e164: string): Promise<LookupResult> => run((p) => p.lookup(e164)),
    listNumbers: (): Promise<ProviderNumber[]> => run((p) => p.listNumbers()),
    balance: (): Promise<number | null> => run((p) => p.balance()),
    parseEvent: (body: unknown): SmsEvent => o.managed.parseEvent(body),
    ...(registration ? { registration } : {}),
    ...(keywordReplies ? { keywordReplies } : {}),
  };
}

function need<T>(x: T | undefined, what: string): T {
  if (!x) throw new Error(`this Telnyx provider has no ${what}`);
  return x;
}
