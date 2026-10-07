/**
 * `CallBookings.ingest`: cal.com's booking webhook, forwarded by the phone Worker after
 * the signature check, with trigger + uid + start as the idempotency key. A booking from
 * an email's link stops the firm's sequences and counts as booked
 * (designs/2026-10-04-booking-webhook.md). A PING or another trigger is a no-op.
 * `ingestFor` is a client's cal.com, by its own webhook, into its database (O4). A call booked
 * or moved enters the `close` workflow, whose brief step builds its pre-call brief.
 */
import * as restate from "@restatedev/restate-sdk";
import { findClient } from "@wren/core/clients";
import { spineEmit } from "@wren/core/spine";
import type { Db } from "@wren/db";
import { bookingEmit } from "../calls/restate.js";
import {
  applyBooking,
  type BookingEvent,
  type BookingOutcome,
  bookingFromWebhook,
} from "../inbox/bookings.js";

export function makeCallBookings(deps: { db: Db; clientDb?: ((client: string) => Db) | null }) {
  const apply = async (ctx: restate.Context, db: Db, body: unknown, client: string | null) => {
    let event: BookingEvent | null;
    try {
      event = bookingFromWebhook(body);
    } catch (err) {
      throw new restate.TerminalError(`unreadable booking: ${(err as Error).message}`);
    }
    if (!event) return null;
    const booking = event;
    const now = new Date(await ctx.date.now());
    const done = await ctx.run("apply", () => applyBooking(db, booking, { now }));
    const emit = bookingEmit({ ...done, start: booking.start });
    if (emit) spineEmit(ctx, { client, ...emit });
    return done;
  };
  return restate.service({
    name: "CallBookings",
    handlers: {
      ingest: (ctx: restate.Context, body: unknown): Promise<BookingOutcome | null> =>
        apply(ctx, deps.db, body, null),
      /** A client's booking; the phone Worker checked it against that client's secret. */
      ingestFor: async (
        ctx: restate.Context,
        req: { client: string; body: unknown },
      ): Promise<BookingOutcome | null> => {
        if (!deps.clientDb) throw new restate.TerminalError("no client databases here");
        const clientDb = deps.clientDb;
        const id = req?.client;
        if (!id) throw new restate.TerminalError("no client");
        const known = await ctx.run("client", async () => (await findClient(deps.db, id)) !== null);
        if (!known) throw new restate.TerminalError(`no such client: ${id}`);
        return apply(ctx, clientDb(id), req.body, id);
      },
    },
  });
}

export type CallBookings = ReturnType<typeof makeCallBookings>;
