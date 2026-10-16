/**
 * The Mac's call recorder (designs/2026-10-16-call-recording.md): autobrowse's desk serves it as
 * Restate service `calls`; no import from that repo. Each call waits a few seconds and is
 * cancelled past that, so a sleeping Mac answers "no answer" and never starts late.
 */
import * as restate from "@restatedev/restate-sdk";
import { PortalRefusal } from "@wren/core/portal";

export const CALL_RECORDER = { name: "calls" } as const;

/** What the desk says about its recorder. */
export interface RecorderState {
  /** Recording now. */
  recording: boolean;
  /** When this recording started (ISO). */
  since: string | null;
  /** The booked call it is, if any. */
  booking: number | null;
  who: string | null;
  by: "desk" | "manual" | null;
  /** The next booked call the desk is armed for (ISO start), if any. */
  next: string | null;
}

/** The ask carries when it was sent: the desk refuses one older than a minute. */
export interface RecorderAsk {
  at: string;
  by?: string;
}

export type RecorderCalls = {
  status: (ctx: restate.Context, req: RecorderAsk) => Promise<RecorderState>;
  start: (ctx: restate.Context, req: RecorderAsk) => Promise<RecorderState>;
  stop: (ctx: restate.Context, req: RecorderAsk) => Promise<RecorderState>;
};

/** How long each ask waits on the Mac: a start may open OBS first. */
export const RECORDER_WAIT_MS = { status: 8_000, start: 30_000, stop: 15_000 } as const;

/** One ask of the Mac's recorder: its answer, or a 503 once the wait is up (the ask cancelled). */
export async function askRecorder(
  ctx: restate.Context,
  what: keyof RecorderCalls,
  by: string,
): Promise<RecorderState> {
  const at = new Date(await ctx.date.now()).toISOString();
  const call = ctx.serviceClient<RecorderCalls>(CALL_RECORDER)[what]({ at, by });
  try {
    return await call.orTimeout(RECORDER_WAIT_MS[what]);
  } catch (err) {
    if (err instanceof restate.TimeoutError) {
      ctx.cancel(await call.invocationId);
      throw new PortalRefusal("The Mac didn't answer. Is it on?", 503);
    }
    if (err instanceof restate.TerminalError) throw new PortalRefusal(err.message, 409);
    throw err;
  }
}
