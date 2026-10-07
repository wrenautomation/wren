/**
 * The rules before any outbound dial, in code (designs/2026-10-06-voice-agent.md, "Rules the code
 * enforces"). An AI voice counts as an artificial voice under the TCPA (FCC, 2024), so an outbound
 * call needs, all at once:
 *
 * 1. William's yes for this agent to dial out (`outbound` in its settings).
 * 2. Prior express written consent for the number, saying calls may use an AI voice, not revoked.
 * 3. No phone suppression on the number.
 * 4. The phone channel's quiet hours, at the lead's clock (unknown zone: every US zone's).
 *
 * `placeCall` is the only way out, and it asks `mayDial` first. Inbound and test calls skip it.
 */
import { DEFAULT_POLICY, inWindow } from "@wren/channel-sms";
import { activeSuppressionOf } from "@wren/core";
import type { Db, Queryable } from "@wren/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { AgentSettings } from "./agent.js";
import { type PhoneConsent, phoneConsents } from "./schema.js";
import type { TelnyxControl } from "./transports/telnyx.js";
import { clientStateOf } from "./transports/telnyx.js";

const E164 = /^\+[1-9]\d{6,14}$/;

export type DialVerdict =
  | { ok: true; consent: PhoneConsent }
  | {
      ok: false;
      why:
        | "agent_off"
        | "bad_number"
        | "no_consent"
        | "no_ai_consent"
        | "suppressed"
        | "quiet_hours";
      says: string;
    };

/** The consent that covers calling `e164` for `whose`, newest first; null when there's none. */
export async function consentFor(
  db: Queryable,
  e164: string,
  whose: string,
): Promise<PhoneConsent | null> {
  const [row] = await db
    .select()
    .from(phoneConsents)
    .where(
      and(
        eq(phoneConsents.e164, e164),
        eq(phoneConsents.whose, whose),
        isNull(phoneConsents.revokedAt),
      ),
    )
    .orderBy(desc(phoneConsents.aiVoice), desc(phoneConsents.givenAt))
    .limit(1);
  return row ?? null;
}

/** May this agent call `to` now? Every reason it may not, in the order they're checked. */
export async function mayDial(
  db: Queryable,
  o: { to: string; agent: AgentSettings; whose: string; zone: string | null; now: Date },
): Promise<DialVerdict> {
  if (!o.agent.outbound)
    return { ok: false, why: "agent_off", says: "This agent isn't allowed to dial out." };
  if (!E164.test(o.to))
    return { ok: false, why: "bad_number", says: `${o.to} isn't an E.164 number.` };
  const consent = await consentFor(db, o.to, o.whose);
  if (!consent)
    return { ok: false, why: "no_consent", says: "No written consent to call this number." };
  if (!consent.aiVoice)
    return {
      ok: false,
      why: "no_ai_consent",
      says: "Their consent doesn't cover an AI voice, so an AI call isn't allowed.",
    };
  if (await activeSuppressionOf(db, "phone", o.to))
    return { ok: false, why: "suppressed", says: "The number is suppressed." };
  if (!inWindow(o.zone, o.now, DEFAULT_POLICY))
    return { ok: false, why: "quiet_hours", says: "It's outside calling hours at their end." };
  return { ok: true, consent };
}

/** A refused dial: nothing was sent to the phone network. */
export class DialRefused extends Error {
  constructor(readonly verdict: Extract<DialVerdict, { ok: false }>) {
    super(verdict.says);
  }
}

/**
 * Dial `to` with the agent on the media stream. Refuses (throws `DialRefused`) unless `mayDial`
 * says yes, checked right before the dial. Returns the call control id.
 */
export async function placeCall(
  db: Db,
  control: TelnyxControl,
  o: {
    agent: AgentSettings;
    whose: string;
    from: string;
    to: string;
    zone: string | null;
    streamUrl: string;
    connectionId: string;
    now: Date;
  },
): Promise<string> {
  const verdict = await mayDial(db, o);
  if (!verdict.ok) throw new DialRefused(verdict);
  return control.dial({
    from: o.from,
    to: o.to,
    streamUrl: o.streamUrl,
    connectionId: o.connectionId,
    clientState: clientStateOf({ from: o.from, to: o.to, direction: "outbound" }),
  });
}
