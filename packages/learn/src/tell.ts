/**
 * Telling William: per source, "Tell me" is every item, 8 and up, or the digest only. The
 * Monitor's pass sends what's due in one alert, the way urgent flags go out, and once a day after
 * 09:00 one digest names the rest worth reading. Saved items never alert: he saved them. Nothing
 * here lands in the Inbox; that's for what waits on a reply.
 */
import type { Notifier } from "@wren/core/notify";
import type { Db } from "@wren/db";
import { and, desc, eq, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { digests, items, sources, TOP_SCORE } from "./schema.js";

export const DIGEST_HOUR = 9;
/** Items scored longer ago than this are past telling: a source's backlog never floods. */
const FRESH_MS = 2 * 86_400_000;
/** Lines one message names; the rest are counted. */
const MAX_LINES = 15;

interface Told {
  id: number;
  title: string;
  url: string;
  score: number | null;
  source: string;
  why: string | null;
}

const line = (i: Told) =>
  `${i.score ?? "-"}/10 ${i.title} (${i.source})${i.why ? `: ${i.why}` : ""}\n${i.url}`;

const body = (list: Told[], portal: string | null) =>
  [
    ...list.slice(0, MAX_LINES).map(line),
    ...(list.length > MAX_LINES ? [`and ${list.length - MAX_LINES} more`] : []),
    ...(portal ? [`All of it: ${portal}/learn/items`] : []),
  ].join("\n\n");

const pick = {
  id: items.id,
  title: items.title,
  url: items.url,
  score: items.score,
  source: sources.name,
  why: items.why,
};

/**
 * Send what's due. `today` (YYYY-MM-DD) and `hour` are William's wall clock. A failed send is
 * tried again next pass.
 */
export async function tellLearn(
  db: Db,
  notifier: Notifier,
  p: { today: string; hour: number; now: Date; portal?: string | null },
): Promise<{ alerts: number; digest: number }> {
  const told = { alerts: 0, digest: 0 };
  const fresh = and(
    isNull(items.toldAt),
    isNull(items.savedAt),
    isNull(items.archivedAt),
    isNotNull(items.scoredAt),
    gte(items.scoredAt, new Date(p.now.getTime() - FRESH_MS)),
  );
  const alerts = await db
    .select(pick)
    .from(items)
    .innerJoin(sources, eq(sources.id, items.sourceId))
    .where(
      and(
        fresh,
        or(eq(sources.tell, "every"), and(eq(sources.tell, "top"), gte(items.score, TOP_SCORE))),
      ),
    )
    .orderBy(desc(items.score), desc(items.id));
  if (
    alerts.length &&
    (await notifier.notify(
      alerts.length === 1 ? "Learn: 1 new" : `Learn: ${alerts.length} new`,
      body(alerts, p.portal ?? null),
      "action",
    ))
  ) {
    await db
      .update(items)
      .set({ toldAt: p.now })
      .where(
        inArray(
          items.id,
          alerts.map((i) => i.id),
        ),
      );
    told.alerts = alerts.length;
  }
  if (p.hour < DIGEST_HOUR) return told;
  const [sent] = await db.select().from(digests).where(eq(digests.day, p.today));
  if (sent) return told;
  const rest = await db
    .select(pick)
    .from(items)
    .innerJoin(sources, eq(sources.id, items.sourceId))
    .where(and(fresh, sql`${items.verdict} in ('show', 'hold')`))
    .orderBy(desc(items.score), desc(items.id));
  if (rest.length) {
    if (
      !(await notifier.notify(
        `Learn: ${rest.length} to read`,
        body(rest, p.portal ?? null),
        "info",
      ))
    )
      return told;
    await db
      .update(items)
      .set({ toldAt: p.now })
      .where(
        inArray(
          items.id,
          rest.map((i) => i.id),
        ),
      );
    told.digest = rest.length;
  }
  await db
    .insert(digests)
    .values({ day: p.today, items: rest.length, at: p.now })
    .onConflictDoNothing();
  return told;
}
