/**
 * What a client's mailbox sends under (R4): its own database, its own fleet,
 * and Wren's send rules with the client's caps. Wren's window, days and gaps
 * carry over; Wren's opener cap and ramp are Wren's campaign's and do not.
 */
import { type Fleet, PlainDate, SendPolicy } from "@wren/channel-email";
import type { SendScope } from "@wren/channel-email/restate";
import { type Client, findClient } from "@wren/core/clients";
import { clientOfKey } from "@wren/core/restate";
import type { Db } from "@wren/db";
import { type ReactivationSettings, reactivationSettingsOf } from "./settings.js";

/** The client's mailboxes as a fleet: the suspended ones measured, never sending. */
export function senderFleet(settings: Pick<ReactivationSettings, "senders">): Fleet {
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
 * daily openers (else no cap past the per-inbox one), its ramp (else none).
 */
export function sendPolicyFor(
  settings: Pick<ReactivationSettings, "sending">,
  base: SendPolicy,
): SendPolicy {
  const ceiling = settings.sending.perInboxPerDay ?? base.perInboxCeiling;
  return new SendPolicy({
    ...base,
    perInboxCeiling: ceiling,
    newOpenersPerDay: settings.sending.openersPerDay,
    rampStart: settings.sending.rampStart ? PlainDate.fromIso(settings.sending.rampStart) : null,
    rampFrom: Math.min(base.rampFrom, ceiling),
  });
}

/** A block that no longer parses sends nothing; `clients set` refuses one, so this is a hand edit. */
export function settingsOrNull(products: Record<string, unknown>): ReactivationSettings | null {
  try {
    return reactivationSettingsOf(products);
  } catch {
    return null;
  }
}

/** Whether this client sends at all right now, and why not. */
export function sendingOff(client: Pick<Client, "demo">, settings: ReactivationSettings) {
  if (client.demo) return "the demo never sends";
  if (!settings.on) return "reactivation is off";
  if (!settings.stages.send) return "stages.send is off";
  return null;
}

export interface ClientSendDeps {
  main: Db;
  open(client: Pick<Client, "database">): Db;
  /** Wren's rules, which a client's caps adjust. */
  policy: SendPolicy;
}

/**
 * The scope of a `<client>/<mailbox>` send key; null when that mailbox may not
 * send now (client gone or off, sending off, mailbox unlisted or suspended).
 */
export async function clientSendScope(
  deps: ClientSendDeps,
  key: string,
): Promise<SendScope | null> {
  const owner = clientOfKey(key);
  if (!owner) return null;
  const client = await findClient(deps.main, owner.client);
  if (!client) return null;
  const settings = settingsOrNull(client.products);
  if (!settings || sendingOff(client, settings) !== null) return null;
  const address = owner.unit.toLowerCase();
  const sender = settings.senders.find((s) => s.address === address);
  if (!sender || sender.suspended) return null;
  // A policy that can't be built sends nothing; a throw here would retry the tick forever.
  let policy: SendPolicy;
  try {
    policy = sendPolicyFor(settings, deps.policy);
  } catch {
    return null;
  }
  return {
    db: deps.open(client),
    policy,
    fleet: senderFleet(settings),
    // The pixel's opens land in Wren's database; a client's mail carries none.
    pixelBaseUrl: null,
  };
}
