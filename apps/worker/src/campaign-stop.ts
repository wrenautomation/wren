/**
 * A race won in a metro campaign stops the person's other acts in it, on every channel
 * (designs/2026-11-02-campaigns.md, phase 4): the email enrollment, the reach contact, the SMS
 * contact. The person is found by their profile's keys; each channel stops its own rows.
 */
import { stopCampaignTexts } from "@wren/channel-sms";
import { keysOfProfile } from "@wren/core/profiles";
import type { Queryable } from "@wren/db";
import type { CampaignStop } from "@wren/pipeline/steps";
import type { StopReason } from "@wren/starling-email/schema";
import { stopCampaignEnrollments } from "@wren/starling-email/send";
import { stopCampaignContacts } from "@wren/starling-outbound";

/** The email stop reason a winning cause stands for; any other is an operator's call. */
const REASON: Partial<Record<string, StopReason>> = { reply: "reply", booking: "booked" };

export async function stopCampaign(tx: Queryable, s: CampaignStop, now = new Date()) {
  const keys = await keysOfProfile(tx, [s.profile]);
  const of = (kind: string) => keys.filter((k) => k.kind === kind).map((k) => k.value);
  const persons = of("person").map(Number);
  const why = `race ${s.gate} won by ${s.cause.kind}`;
  const at = { campaign: s.campaign, persons, why, now };
  await stopCampaignEnrollments(tx, {
    ...at,
    emails: of("email"),
    reason: REASON[s.cause.kind] ?? "manual",
    detail: why,
  });
  await stopCampaignContacts(tx, {
    ...at,
    handles: keys.flatMap((k) =>
      k.kind.startsWith("handle:") ? [{ platform: k.kind.slice(7), handle: k.value }] : [],
    ),
  });
  await stopCampaignTexts(tx, { ...at, phones: of("phone") });
}
