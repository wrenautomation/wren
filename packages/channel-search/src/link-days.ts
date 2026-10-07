/**
 * `link_days`: the lander's export per day and `/go/` link (designs/2026-10-07-content-analytics.md).
 * A link is its utm source, campaign and content, so a post's own link (`/go/li/trust/<id8>`) or a
 * video's footer (`/go/yt/<video slug>`) keeps its clicks. A form, a booked call and a won client
 * count under both the first and the last touch of the person behind them, matched by email.
 * The whole export is re-read and each row upserted, so a re-read never double counts.
 */
import type { SiteApplication, SiteHit } from "@wren/channel-email";
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { linkDays } from "./schema.js";
import type { BookedCall } from "./site-days.js";

export type LinkDayRow = Omit<typeof linkDays.$inferSelect, "syncedAt">;

interface Link {
  source: string;
  campaign: string;
  content: string;
}

/** A client whose invoices were paid: its members' emails, the first paid day, the cents (USD). */
export interface WonClient {
  emails: string[];
  day: string;
  cents: number;
}

const clean = (v: unknown, max: number) =>
  typeof v === "string" ? v.trim().toLowerCase().slice(0, max) : "";

/** The link a touch came by; null when it came by none (direct, search, an email code). */
export function linkOf(t: Record<string, unknown> | null | undefined): Link | null {
  if (!t) return null;
  const source = clean(t.utm_source, 40);
  if (!source || clean(t.r, 40)) return null;
  return { source, campaign: clean(t.utm_campaign, 100), content: clean(t.utm_content, 100) };
}

const parse = (json: string | null | undefined): Record<string, unknown> | null => {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** Day rows from every hit and application the lander holds, our calls and our won clients. */
export function rollupLinks(
  hits: readonly SiteHit[],
  applications: readonly SiteApplication[],
  calls: readonly BookedCall[] = [],
  won: readonly WonClient[] = [],
): LinkDayRow[] {
  const rows = new Map<string, LinkDayRow>();
  const row = (day: string, l: Link) => {
    const key = `${day}|${l.source}|${l.campaign}|${l.content}`;
    let r = rows.get(key);
    if (!r) {
      r = {
        day,
        ...l,
        clicks: 0,
        hops: 0,
        formsFirst: 0,
        formsLast: 0,
        callsFirst: 0,
        callsLast: 0,
        wonFirst: 0,
        wonLast: 0,
        revenueFirst: 0,
        revenueLast: 0,
      };
      rows.set(key, r);
    }
    return r;
  };
  const seen = new Set<string>();
  for (const h of hits) {
    const l = linkOf(h as unknown as Record<string, unknown>);
    if (!l) continue;
    const day = h.ts.slice(0, 10);
    if (h.page.startsWith("youtube:")) {
      row(day, l).hops += 1;
      continue;
    }
    // A visitor is one click per link per day, however many pages they open.
    const who = `${day}|${l.source}|${l.campaign}|${l.content}|${h.visitor ?? `hit:${h.id}`}`;
    if (seen.has(who)) continue;
    seen.add(who);
    row(day, l).clicks += 1;
  }
  const touches = new Map<string, { first: Link | null; last: Link | null }>();
  for (const a of [...applications].sort((x, y) => x.id - y.id)) {
    const first = linkOf(parse(a.first_touch));
    const last = linkOf(parse(a.last_touch)) ?? first;
    const day = a.ts.slice(0, 10);
    if (first) row(day, first).formsFirst += 1;
    if (last) row(day, last).formsLast += 1;
    const email = clean(a.email, 320);
    if (email && !touches.has(email)) touches.set(email, { first, last });
  }
  for (const c of calls) {
    if (c.code) continue;
    const t = touches.get(clean(c.email, 320));
    if (t?.first) row(c.day, t.first).callsFirst += 1;
    if (t?.last) row(c.day, t.last).callsLast += 1;
  }
  for (const w of won) {
    const t = w.emails.map((e) => touches.get(clean(e, 320))).find(Boolean);
    if (t?.first) {
      const r = row(w.day, t.first);
      r.wonFirst += 1;
      r.revenueFirst += w.cents;
    }
    if (t?.last) {
      const r = row(w.day, t.last);
      r.wonLast += 1;
      r.revenueLast += w.cents;
    }
  }
  return [...rows.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/** Upsert day rows. Returns rows written. */
export async function upsertLinkDays(db: Queryable, rows: readonly LinkDayRow[]): Promise<number> {
  const x = (c: string) => sql.raw(`excluded.${c}`);
  for (let i = 0; i < rows.length; i += 1000)
    await db
      .insert(linkDays)
      .values(rows.slice(i, i + 1000))
      .onConflictDoUpdate({
        target: [linkDays.day, linkDays.source, linkDays.campaign, linkDays.content],
        set: {
          clicks: x("clicks"),
          hops: x("hops"),
          formsFirst: x("forms_first"),
          formsLast: x("forms_last"),
          callsFirst: x("calls_first"),
          callsLast: x("calls_last"),
          wonFirst: x("won_first"),
          wonLast: x("won_last"),
          revenueFirst: x("revenue_first"),
          revenueLast: x("revenue_last"),
          syncedAt: sql`now()`,
        },
      });
  return rows.length;
}

/** Clients with a paid invoice, their members' emails, for `rollupLinks`. Delivery's tables, by name. */
export async function wonClients(db: Queryable): Promise<WonClient[]> {
  // Paid per client first: joined to its members, a sum would count each invoice once per member.
  const rows = await db.execute(sql`SELECT p.day, p.cents,
      coalesce((SELECT array_agg(lower(m.email)) FROM client_members m
        WHERE m.client_id = p.client_id), '{}') emails
    FROM (SELECT e.client_id, to_char(min(i.paid_on), 'YYYY-MM-DD') AS day,
        coalesce(sum(i.cents) FILTER (WHERE i.currency = 'USD'), 0)::int cents
      FROM delivery.invoices i JOIN delivery.engagements e ON e.id = i.engagement_id
      WHERE i.status = 'paid' AND i.paid_on IS NOT NULL
      GROUP BY e.client_id) p`);
  return rows as unknown as WonClient[];
}
