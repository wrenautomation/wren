/**
 * The demo's sample project (D12): a lead reactivation a few weeks in, so a
 * visitor sees what a client's Home, plan, timeline, deliverables, asks and
 * results look like. Every word and number is made up, and the portal labels
 * it a sample. Dated from today and reseeded weekly by DeliveryWatch, so
 * nothing on it ever runs late.
 */
import { clients } from "@wren/core/clients";
import type { Db, Queryable } from "@wren/db";
import { and, eq } from "drizzle-orm";
import { addDays, DeliveryRefusal, recordResult, startEngagement } from "./index.js";
import { asks, deliverables, engagements, milestones, updates } from "./schema.js";

/** How many days in the sample sits when seeded. */
export const SAMPLE_DAY = 23;
/** Reseeded once it's this many days older, before anything on it could go late. */
export const SAMPLE_REFRESH_DAYS = 7;
const OFFER = "reactivation";
const BY = "sample";
const CLIENT = "dana@yourfirm.example";

/** [days after the start, text]. */
const UPDATES: [number, string][] = [
  [0, "Kicked off. Your ATS export is in: 4,812 contacts across 1,906 companies."],
  [3, "Cleaned the list: 611 duplicates merged, 388 dead addresses taken out."],
  [7, "Your sending domain is warming up. The first emails are drafted in your recruiter's voice."],
  [14, "You approved the first 50 emails. Sending starts this week."],
  [21, "First week: 240 contacts reached, 9 replies, 2 meetings booked."],
  [22, "Yesterday: 61 contacts reached, 3 replies, 1 meeting booked."],
];
/** [days after the start, title, demo page it links to, step]. */
const DELIVERABLES: [number, string, string, string][] = [
  [4, "Cleaned contact list", "/reactivation/people", "set-up"],
  [12, "The campaign, in your recruiter's voice", "/reactivation/emails", "approve"],
];
/** The client's answer to each opening ask, and the day after the start they gave it. */
const ANSWERS: Record<string, [string, number]> = {
  "An export of past clients and contacts from your ATS or CRM": ["Uploaded the ATS export.", 1],
  "The recruiter whose name and signature go on the emails": ["Dana, our senior recruiter.", 2],
};
const RESULTS: [string, number, string?][] = [
  ["contacts_reached", 540],
  ["replies", 22],
  ["meetings", 6, "$4,000 owed so far: $1,000 setup + $3,000 in meetings"],
  ["job_orders", 1],
  ["fees_usd", 18_000, "One placement from a reactivated client."],
];

const at = (start: string, day: number, hour = 15) =>
  new Date(`${addDays(start, day)}T${String(hour).padStart(2, "0")}:00:00Z`);

/** Replace the demo's work with a fresh sample, `SAMPLE_DAY` days in. Refuses any other client. */
export async function seedSample(db: Queryable, clientId: string, today: string): Promise<number> {
  const [c] = await db.select().from(clients).where(eq(clients.id, clientId));
  if (!c?.demo) throw new DeliveryRefusal("the sample is the demo's only", 409);
  await db.delete(engagements).where(eq(engagements.clientId, clientId));
  const start = addDays(today, -SAMPLE_DAY);
  const e = await startEngagement(db, { clientId, offerId: OFFER, startsOn: start, by: BY });
  const steps = await db.select().from(milestones).where(eq(milestones.engagementId, e.id));
  const stepId = (key: string) => steps.find((m) => m.key === key)?.id ?? null;
  for (const [key, day] of [
    ["set-up", 11],
    ["approve", 16],
  ] as const)
    await db
      .update(milestones)
      .set({ doneOn: addDays(start, day) })
      .where(and(eq(milestones.engagementId, e.id), eq(milestones.key, key)));

  await db.insert(updates).values(
    UPDATES.map(([day, body]) => ({
      engagementId: e.id,
      author: BY,
      body,
      createdAt: at(start, day),
    })),
  );
  await db.insert(deliverables).values(
    DELIVERABLES.map(([day, title, path, step]) => ({
      engagementId: e.id,
      milestoneId: stepId(step),
      title,
      kind: "link" as const,
      url: `https://demo.wrenautomation.com${path}`,
      status: "approved" as const,
      decidedBy: CLIENT,
      decidedAt: at(start, day + 1),
      createdBy: BY,
      createdAt: at(start, day),
    })),
  );
  for (const a of await db.select().from(asks).where(eq(asks.engagementId, e.id))) {
    const [answer, day] = ANSWERS[a.text] ?? ["Approved in the portal.", 14];
    await db
      .update(asks)
      .set({ answer, answeredBy: CLIENT, answeredAt: at(start, day) })
      .where(eq(asks.id, a.id));
  }
  await db.insert(asks).values({
    engagementId: e.id,
    milestoneId: stepId("send"),
    text: "Who takes the hot replies when your recruiter is out?",
    dueOn: addDays(today, SAMPLE_REFRESH_DAYS + 2),
    createdBy: BY,
    createdAt: at(start, SAMPLE_DAY - 1),
  });
  for (const [key, value, note] of RESULTS) await recordResult(db, e, { key, value, note, by: BY });
  return e.id;
}

/** Reseed the demo's sample when it's missing or old enough to start looking stale. */
export async function keepSampleFresh(db: Db, today: string): Promise<boolean> {
  const [demo] = await db.select().from(clients).where(eq(clients.demo, true)).limit(1);
  if (!demo) return false;
  const [e] = await db
    .select({ startsOn: engagements.startsOn })
    .from(engagements)
    .where(eq(engagements.clientId, demo.id))
    .limit(1);
  if (e && e.startsOn >= addDays(today, -(SAMPLE_DAY + SAMPLE_REFRESH_DAYS))) return false;
  await db.transaction((tx) => seedSample(tx, demo.id, today));
  return true;
}
