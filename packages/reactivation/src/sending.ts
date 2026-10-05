/**
 * What a client's mailbox sends under (R4): its own database, its own fleet,
 * and Wren's send rules with the client's caps. Wren's window, days and gaps
 * carry over; Wren's opener caps, kill-switch exemptions and ramp are Wren's campaigns' and do not.
 */
import { type SendPolicy, senderFleet, sendPolicyFor, sharedFor } from "@wren/channel-email";
import type { SendScope } from "@wren/channel-email/restate";
import { type Client, findClient } from "@wren/core/clients";
import { clientOfKey } from "@wren/core/restate";
import type { Db } from "@wren/db";
import { type ReactivationSettings, reactivationSettingsOf } from "./settings.js";

// Moved to channel-email with email sequences (O2); the same rules serve both.
export { senderFleet, sendPolicyFor };

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
    // An opt-out anywhere is an opt-out everywhere.
    shared: sharedFor(deps.main, client.id),
  };
}
