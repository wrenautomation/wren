/**
 * `MetaPace/<owner>:<platform>`: Meta's private replies, spaced under its cap per professional
 * account (designs/2026-11-04-meta-push-flows.md). Even gaps, not a window: a burst of 15k
 * comments drains at the cap, never in a spike a spam check sees.
 */

import { exclusiveHandler, NO_INPUT } from "@wren/core/restate";
import * as restate from "@wren/runtime";

/** Default: under Meta's 750 an hour, with margin. */
export const PRIVATE_PER_HOUR = 600;

/** When the next send may go, and the new last slot. */
export function nextSlot(last: number | null, now: number, perHour: number): number {
  const gap = Math.ceil(3_600_000 / Math.max(1, perHour));
  return last === null ? now : Math.max(now, last + gap);
}

export const paceKey = (owner: string | null, platform: string) => `${owner ?? "wren"}:${platform}`;

const LAST = "last";

export function makeMetaPace(o: { perHour?: number } = {}) {
  const perHour = o.perHour ?? PRIVATE_PER_HOUR;
  return restate.object({
    name: "MetaPace",
    handlers: {
      /** Takes the next slot: the ms to wait before the send. */
      slot: exclusiveHandler(
        { ingressPrivate: true, input: NO_INPUT },
        async (ctx: restate.ObjectContext): Promise<number> => {
          const now = await ctx.date.now();
          const at = nextSlot((await ctx.get<number>(LAST)) ?? null, now, perHour);
          ctx.set(LAST, at);
          return at - now;
        },
      ),
    },
  });
}
export type MetaPace = ReturnType<typeof makeMetaPace>;
