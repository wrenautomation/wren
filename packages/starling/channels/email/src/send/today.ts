import type { Queryable } from "@wren/db";
import { and, count, eq, gte, lt } from "drizzle-orm";
import { enrollments, messages } from "../schema.js";
import type { SendPolicy } from "./policy.js";

/**
 * (sends per inbox, openers fleet-wide, openers per niche) over the policy's
 * LOCAL day: the cap is a promise about one operator's working day. Openers are step 0.
 */
export async function todaysSends(
  db: Queryable,
  policy: SendPolicy,
  now: Date,
): Promise<{
  sentToday: Map<string, number>;
  openersToday: number;
  nicheOpeners: Map<string, number>;
}> {
  const [dayStart, dayEnd] = policy.localDayBounds(now);
  const rows = await db
    .select({
      sender: enrollments.sender,
      niche: enrollments.niche,
      step: messages.step,
      n: count(),
    })
    .from(messages)
    .innerJoin(enrollments, eq(enrollments.id, messages.enrollmentId))
    .where(
      and(eq(messages.state, "sent"), gte(messages.sentAt, dayStart), lt(messages.sentAt, dayEnd)),
    )
    .groupBy(enrollments.sender, enrollments.niche, messages.step);
  const sentToday = new Map<string, number>();
  const nicheOpeners = new Map<string, number>();
  let openersToday = 0;
  for (const { sender, niche, step, n } of rows) {
    sentToday.set(sender, (sentToday.get(sender) ?? 0) + n);
    if (step === 0) {
      openersToday += n;
      nicheOpeners.set(niche, (nicheOpeners.get(niche) ?? 0) + n);
    }
  }
  return { sentToday, openersToday, nicheOpeners };
}
