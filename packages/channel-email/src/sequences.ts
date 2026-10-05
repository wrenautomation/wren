/**
 * Email sequences for a client (designs/2026-10-04-outbound-per-client.md, O2): its mailboxes,
 * its database, Wren's send rules under the client's caps, and the client's own kill switch and
 * opener brakes (`campaign_controls` in its database). Suppression stays global: work in a
 * client's database also reads and writes main's list.
 */
import { type Client, findClient } from "@wren/core/clients";
import { clientOfKey } from "@wren/core/restate";
import type { Db } from "@wren/db";
import type { SharedSuppressions } from "./guards.js";
import type { Campaign } from "./restate/compose-scheduler.js";
import type { SendScope } from "./restate/send-scheduler.js";
import { campaignPolicy } from "./send/campaign-controls.js";
import { PlainDate } from "./send/dates.js";
import { SendPolicy } from "./send/policy.js";
import type { Fleet } from "./send/tick.js";
import {
  REPLIES,
  SEQUENCES,
  type SequencesSettings,
  sequencesSettingsSchema,
} from "./sequences-settings.js";

type Sending = {
  sending: {
    perInboxPerDay: number | null;
    openersPerDay: number | null;
    rampStart: string | null;
  };
};
type Senders = { senders: readonly { address: string; name: string; suspended: boolean }[] };

/** A client's mailboxes as a fleet: the suspended ones measured, never sending. */
export function senderFleet(settings: Senders): Fleet {
  const active = settings.senders.filter((s) => !s.suspended);
  return {
    senders: active.map((s) => s.address),
    domainFleet: settings.senders.map((s) => s.address),
    fromNames: Object.fromEntries(active.map((s) => [s.address, s.name])),
    signatureHtml: {},
    pages: {},
  };
}

/**
 * Wren's rules with this client's caps: its per-inbox ceiling (else Wren's), its
 * daily openers (else no cap past the per-inbox one), its ramp (else none). Wren's
 * opener caps and kill-switch exemptions are Wren's campaigns' and do not carry over.
 */
export function sendPolicyFor(settings: Sending, base: SendPolicy): SendPolicy {
  const ceiling = settings.sending.perInboxPerDay ?? base.perInboxCeiling;
  return new SendPolicy({
    ...base,
    perInboxCeiling: ceiling,
    newOpenersPerDay: settings.sending.openersPerDay,
    nicheOpenersPerDay: new Map(),
    killSwitchOffFor: new Set(),
    rampStart: settings.sending.rampStart ? PlainDate.fromIso(settings.sending.rampStart) : null,
    rampFrom: Math.min(base.rampFrom, ceiling),
  });
}

/** Main's list, for work in this client's database. */
export const sharedFor = (main: Db, client: string): SharedSuppressions => ({ main, client });

/** A client's sequences this pass, or why there is nothing to do. */
export type ClientSequences =
  | { kind: "gone"; why: string }
  | { kind: "work"; client: Pick<Client, "id" | "database">; settings: SequencesSettings };

export async function clientSequences(main: Db, id: string): Promise<ClientSequences> {
  const client = await findClient(main, id);
  if (!client) return { kind: "gone", why: "no such client" };
  if (client.demo) return { kind: "gone", why: "the demo never sends" };
  const block = (client.products as Record<string, unknown> | null)?.[SEQUENCES];
  if (block === undefined) return { kind: "gone", why: "email sequences are not installed" };
  const parsed = sequencesSettingsSchema.safeParse(block);
  if (!parsed.success) return { kind: "gone", why: "the email sequences settings do not parse" };
  return {
    kind: "work",
    client: { id: client.id, database: client.database },
    settings: parsed.data,
  };
}

/**
 * Wren's niche campaign with the client's mailboxes, sign-offs and role-inbox rule. The plan,
 * sequences and copy are the niche's.
 */
export function clientCampaign(base: Campaign, settings: SequencesSettings): Campaign {
  const active = settings.senders.filter((s) => !s.suspended);
  return {
    ...base,
    senders: active.map((s) => s.address),
    ramps: {},
    signatures: Object.fromEntries(
      active.flatMap((s) => (s.signature ? [[s.address, s.signature]] : [])),
    ),
    mailsRoleInboxes: settings.mailsRoleInboxes ?? base.mailsRoleInboxes,
  };
}

export interface ClientScopeDeps {
  main: Db;
  open(client: Pick<Client, "database">): Db;
  /** Wren's rules, which a client's caps adjust. */
  policy: SendPolicy;
}

/** A client's send rules now: its caps over Wren's, then its own console overrides. */
export async function clientPolicy(
  db: Db,
  settings: SequencesSettings,
  base: SendPolicy,
): Promise<SendPolicy> {
  return campaignPolicy(db, sendPolicyFor(settings, base));
}

/**
 * The scope of a `<client>/<mailbox>` send key under email sequences; null when that
 * mailbox may not send now (client gone, not installed, mailbox unlisted or suspended).
 */
export async function sequencesSendScope(
  deps: ClientScopeDeps,
  key: string,
): Promise<SendScope | null> {
  const owner = clientOfKey(key);
  if (!owner) return null;
  const plan = await clientSequences(deps.main, owner.client);
  if (plan.kind === "gone") return null;
  const address = owner.unit.toLowerCase();
  const sender = plan.settings.senders.find((s) => s.address === address);
  if (!sender || sender.suspended) return null;
  const db = deps.open(plan.client);
  let policy: SendPolicy;
  try {
    policy = await clientPolicy(db, plan.settings, deps.policy);
  } catch {
    // A policy that can't be built sends nothing; a throw here would retry the tick forever.
    return null;
  }
  return {
    db,
    policy,
    fleet: senderFleet(plan.settings),
    // The pixel's opens land in Wren's database, and a client's mail offers no Wren times.
    pixelBaseUrl: null,
    calendar: null,
    shared: sharedFor(deps.main, plan.client.id),
  };
}

/**
 * A client's answers to warm replies, while it has email replies on its sequences: its
 * settings and the cal.com login that says who already booked. Null = no answers.
 */
export async function clientReplies(
  main: Db,
  id: string,
): Promise<{ settings: SequencesSettings; calcom: string | null } | null> {
  const plan = await clientSequences(main, id);
  if (plan.kind === "gone") return null;
  const client = await findClient(main, id);
  if (!client || (client.products as Record<string, unknown>)[REPLIES] === undefined) return null;
  return { settings: plan.settings, calcom: client.accounts.calcom ?? null };
}
