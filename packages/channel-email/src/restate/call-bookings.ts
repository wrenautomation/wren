/**
 * `CallBookings.ingest`: cal.com's booking webhook, forwarded by the phone Worker after
 * the signature check, with trigger + uid + start as the idempotency key. A booking from
 * an email's link stops the firm's sequences and counts as booked
 * (designs/2026-10-04-booking-webhook.md). A PING or another trigger is a no-op.
 */
import * as restate from "@restatedev/restate-sdk";
import type { Db } from "@wren/db";
import {
  applyBooking,
  type BookingEvent,
  type BookingOutcome,
  bookingFromWebhook,
} from "../inbox/bookings.js";

export function makeCallBookings(deps: { db: Db }) {
  return restate.service({
    name: "CallBookings",
    handlers: {
      ingest: async (ctx: restate.Context, body: unknown): Promise<BookingOutcome | null> => {
        let event: BookingEvent | null;
        try {
          event = bookingFromWebhook(body);
        } catch (err) {
          throw new restate.TerminalError(`unreadable booking: ${(err as Error).message}`);
        }
        if (!event) return null;
        const booking = event;
        const now = new Date(await ctx.date.now());
        return ctx.run("apply", () => applyBooking(deps.db, booking, { now }));
      },
    },
  });
}

export type CallBookings = ReturnType<typeof makeCallBookings>;
