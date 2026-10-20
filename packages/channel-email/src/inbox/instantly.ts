/**
 * The carrier for an inbox only Instantly holds (roster `transport = "instantly"`): the
 * Inbox Insiders fleet, whose Google logins stay with them. Reading it lives in autobrowse
 * (`InstantlyReader`, `@wrenautomation/autobrowse/mail`).
 *
 * Sending through Instantly is not built: `InstantlyTransport` refuses at the sender level,
 * so a resumed inbox fails its message cleanly instead of sending from nowhere.
 */

import { type SendReceipt, type Transport, TransportRefused } from "../send/transport.js";

/** The carrier for an inbox wren only reads: every send is refused, sender-level. */
export class InstantlyTransport implements Transport {
  readonly name = "instantly";
  async send(email: { fromAddress: string }): Promise<SendReceipt> {
    throw new TransportRefused(
      `${email.fromAddress} is read through Instantly; wren cannot send from it yet`,
      { senderLevel: true },
    );
  }
  async find(): Promise<SendReceipt | null> {
    return null;
  }
}
