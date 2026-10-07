/**
 * Speed to lead's call (designs/2026-10-07-speed-to-lead.md): a few minutes after the first
 * text, the lead is called. Until voice is set up for the client, the step "alerts": the run
 * shows "Call now" on the client's speed-to-lead page, with the lead's details and a tap-to-call
 * link, for their rep. Once a dialer is configured, it dials through `placeCall`, which still
 * refuses without written AI-call consent, inside quiet hours or to a suppressed number.
 *
 * A lead who already booked isn't called: the step leaves `booked`, which ends the run.
 */
import { type Bookings, type SpeedCall, type SpeedRun, speedRuns } from "@wren/channel-sms";
import type { Step } from "@wren/core/spine";
import type { Db } from "@wren/db";
import { and, eq, isNull } from "drizzle-orm";
import type { AgentSettings } from "./agent.js";
import { CALL_NOW } from "./components.js";
import { DialRefused, placeCall } from "./consent.js";
import type { TelnyxControl } from "./transports/telnyx.js";

export { CALL_NOW };

/** What dialing needs once voice is set up for a client. */
export interface Dialer {
  control: TelnyxControl;
  agent: AgentSettings;
  /** Whose consent covers the call: the client's id, or "wren". */
  whose: string;
  from: string;
  streamUrl: string;
  connectionId: string;
}

export interface CallNowDeps {
  db: Db;
  /** Asked first: someone who booked isn't called. Null = no calendar to ask. */
  bookings: Pick<Bookings, "name" | "booked"> | null;
  /** Null until voice is set up: the rep gets "Call now" instead. */
  dialer: Dialer | null;
}

export interface CallNow {
  run: SpeedRun;
  booked: boolean;
}

async function mark(
  db: Db,
  id: number,
  call: SpeedCall,
  detail: string,
  now: Date,
  booked = false,
): Promise<SpeedRun> {
  const [run] = await db
    .update(speedRuns)
    .set({ call, callAt: now, callDetail: detail, ...(booked ? { bookedAt: now } : {}) })
    .where(and(eq(speedRuns.id, id), isNull(speedRuns.call)))
    .returning();
  if (run) return run;
  // A retry: the first call stands.
  const [have] = await db.select().from(speedRuns).where(eq(speedRuns.id, id));
  return have as SpeedRun;
}

/** Call the lead of run `id`, or alert the rep; once per run. */
export async function callNow(d: CallNowDeps, id: number, now: Date): Promise<CallNow> {
  const [run] = await d.db.select().from(speedRuns).where(eq(speedRuns.id, id));
  if (!run) throw new Error(`no speed run ${id}`);
  if (run.call !== null) return { run, booked: run.bookedAt !== null };
  if (run.bookedAt !== null)
    return { run: await mark(d.db, id, "skipped", "booked before the call", now), booked: true };
  // A check that can't tell throws: the step is retried rather than call someone who booked.
  if (run.email && d.bookings && (await d.bookings.booked(run.email)))
    return {
      run: await mark(d.db, id, "skipped", `booked on ${d.bookings.name}`, now, true),
      booked: true,
    };
  if (!d.dialer)
    return { run: await mark(d.db, id, "alerted", "voice not set up", now), booked: false };
  if (!run.e164)
    return { run: await mark(d.db, id, "alerted", "no number to dial", now), booked: false };
  try {
    const control = await placeCall(d.db, d.dialer.control, {
      ...d.dialer,
      to: run.e164,
      zone: run.zone,
      now,
    });
    return { run: await mark(d.db, id, "dialed", control, now), booked: false };
  } catch (err) {
    if (!(err instanceof DialRefused)) throw err;
    return {
      run: await mark(d.db, id, "alerted", `voice can't dial: ${err.message}`, now),
      booked: false,
    };
  }
}

/** `voice.call_now` on the spine: the lead's run is on the event (`run`, from the first text). */
export const callNowStep =
  (depsFor: (client: string | null) => CallNowDeps | Promise<CallNowDeps>): Step =>
  async (_port, e, at) => {
    const id = Number(e.data.run);
    if (!Number.isInteger(id)) throw new Error(`${e.subject} has no speed run`);
    const got = await callNow(await depsFor(at.client), id, new Date());
    if (!got.booked) return [];
    const data = { ...e.data, booked: got.run.callDetail };
    return [{ port: "booked", event: { subject: e.subject, kind: "call", data } }];
  };
