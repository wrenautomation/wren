/**
 * Scheduled comments: the slots `scheduled.ts` keeps in `send_at`, each fired as a ReachDesk call
 * delayed to its slot. The call checks the slot is still its own before it sends.
 */

import * as restate from "@restatedev/restate-sdk";
import type { Slotted } from "../scheduled.js";

/** Who a scheduled send is by, on the draft record and the touch. */
export const SCHEDULER = "scheduler";

type Sent = { id: number | string; at: string; viewer: { email: string } };
type Desk = {
  commentPost: (ctx: restate.Context, req: Sent) => Promise<unknown>;
  commentThread: (ctx: restate.Context, req: Sent) => Promise<unknown>;
};

/** One delayed ReachDesk call a slot; the journal keeps them, so a retry fires none twice. */
export function fireSlots(ctx: restate.Context, slots: readonly Slotted[], now: Date): void {
  const desk = ctx.serviceSendClient<Desk>({ name: "ReachDesk" });
  const viewer = { email: SCHEDULER };
  for (const s of slots) {
    const opts = restate.rpc.sendOpts<Sent>({
      delay: Math.max(0, new Date(s.at).getTime() - now.getTime()),
    });
    if (s.kind === "post") desk.commentPost({ id: Number(s.id), at: s.at, viewer }, opts);
    else desk.commentThread({ id: s.id, at: s.at, viewer }, opts);
  }
}
