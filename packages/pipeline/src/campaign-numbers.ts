/**
 * Numbers per campaign (designs/2026-11-02-campaigns.md, phase 2), read off the journeys: a
 * journey is in a campaign when it arrived at a station of it, on the version it was on then.
 * Campaign ids never change across versions, so arrivals on old versions add up.
 *
 * A campaign counts its own stations and those of the campaigns below it. One person in two
 * campaigns counts in both. Acts are read off each loop's stamp (phase 3), keyed by the cap words.
 * Cost waits: a split rule for per-account spend is William's call.
 */
import type { Queryable } from "@wren/db";
import { and, eq, gte, inArray, lte, type SQL, sql } from "drizzle-orm";
import { isMetro } from "./metro.js";
import { type CampaignStatus, campaignsOf, DEFAULT_CAMPAIGN } from "./metro-campaigns.js";
import { type NumberWindow, rangeOf } from "./numbers.js";
import { instances, pipelineDeals, shapeVersions } from "./schema.js";
import type { StoredBody } from "./stored.js";

/** A journey's arrival at a station. */
export interface Arrival {
  journey: string;
  version: number;
  node: string;
  /** `YYYY-MM-DD`, UTC. */
  day: string;
  /** A new version carried it here: it counts for deals, not as people in. */
  carried?: boolean;
}

export interface CampaignNumber {
  campaign: string;
  label: string;
  status: CampaignStatus;
  /** Not in the newest version: numbers from older versions only. */
  gone: boolean;
  /** People who arrived at a station of it in the window. */
  people: number;
  /** Of them, the people who arrived at one of its CTA stations. */
  converted: number;
  /** Open journeys at a station of it now. */
  now: number;
  /** Deals signed in the window on journeys that were ever in it. */
  deals: number;
  /** Acts done in the window, by cap word (`email.opener`, `linkedin.invite`, …). */
  acts: Record<string, number>;
}

/** Done acts of one campaign (null = the default) and one cap word. */
export interface ActCount {
  campaign: string | null;
  act: string;
  n: number;
}

/** Per version: each station's campaigns, nearest first, and each campaign's CTA stations. */
interface VersionMap {
  of: Map<string, string[]>;
  ctas: Map<string, Set<string>>;
}

function versionMap(body: StoredBody | undefined): VersionMap {
  const of = new Map<string, string[]>();
  const ctas = new Map<string, Set<string>>();
  if (!body || !isMetro(body)) return { of, ctas };
  const all = campaignsOf(body);
  const parent = new Map(all.map((c) => [c.id, c.parent] as const));
  for (const c of all)
    for (const s of c.stations) {
      const chain = [c.id];
      for (let p = parent.get(c.id); p && !chain.includes(p); p = parent.get(p)) chain.push(p);
      of.set(s, chain);
    }
  // A CTA counts only on a station inside the campaign: an inherited ladder may point above it.
  for (const c of all)
    ctas.set(c.id, new Set(c.ctas.map((x) => x.station).filter((s) => of.get(s)?.includes(c.id))));
  return { of, ctas };
}

interface CampaignInputs {
  /** The newest version's body: its campaigns are the rows, in its order. */
  newest: StoredBody | null;
  bodies: ReadonlyMap<number, StoredBody>;
  /** Every arrival, all time: a deal in the window may follow an older arrival. */
  arrivals: readonly Arrival[];
  open: readonly { version: number; node: string }[];
  /** Deals signed in the window, by journey. */
  deals: readonly { journey: string }[];
  /** Acts done in the window, by their stamp. */
  acts?: readonly ActCount[];
  /** The window, as `rangeOf` gives it. */
  from?: string;
  to?: string;
}

/** The rows. Pure. Campaigns gone from the newest version follow, by id. */
export function campaignNumbers(x: CampaignInputs): CampaignNumber[] {
  const maps = new Map<number, VersionMap>();
  const mapOf = (v: number) => {
    const known = maps.get(v);
    if (known) return known;
    const m = versionMap(x.bodies.get(v));
    maps.set(v, m);
    return m;
  };
  const chainOf = (v: number, node: string) => mapOf(v).of.get(node) ?? [DEFAULT_CAMPAIGN];

  const people = new Map<string, Set<string>>();
  const converted = new Map<string, Set<string>>();
  const ever = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, k: string, j: string) => {
    const s = m.get(k) ?? new Set<string>();
    s.add(j);
    m.set(k, s);
  };
  for (const a of x.arrivals) {
    const inWindow = (!x.from || a.day >= x.from) && (!x.to || a.day <= x.to);
    for (const c of chainOf(a.version, a.node)) {
      add(ever, c, a.journey);
      if (!inWindow || a.carried) continue;
      add(people, c, a.journey);
      if (mapOf(a.version).ctas.get(c)?.has(a.node)) add(converted, c, a.journey);
    }
  }
  const now = new Map<string, number>();
  for (const o of x.open)
    for (const c of chainOf(o.version, o.node)) now.set(c, (now.get(c) ?? 0) + 1);
  const deals = new Map<string, number>();
  for (const d of x.deals)
    for (const [c, js] of ever) if (js.has(d.journey)) deals.set(c, (deals.get(c) ?? 0) + 1);

  // A stamp's chain: the campaign and those above it in the newest shape.
  const above = new Map<string, string | undefined>();
  if (x.newest && isMetro(x.newest))
    for (const c of campaignsOf(x.newest)) above.set(c.id, c.parent);
  const acts = new Map<string, Record<string, number>>();
  for (const a of x.acts ?? []) {
    const chain = [a.campaign ?? DEFAULT_CAMPAIGN];
    for (let p = above.get(chain[0] as string); p && !chain.includes(p); p = above.get(p))
      chain.push(p);
    for (const c of chain) {
      const m = acts.get(c) ?? {};
      acts.set(c, { ...m, [a.act]: (m[a.act] ?? 0) + a.n });
    }
  }

  const row = (campaign: string, label: string, status: CampaignStatus, gone: boolean) => ({
    campaign,
    label,
    status,
    gone,
    people: people.get(campaign)?.size ?? 0,
    converted: converted.get(campaign)?.size ?? 0,
    now: now.get(campaign) ?? 0,
    deals: deals.get(campaign) ?? 0,
    acts: acts.get(campaign) ?? {},
  });
  // A graph has no groups: the default only.
  const current =
    x.newest && isMetro(x.newest)
      ? campaignsOf(x.newest)
      : [{ id: DEFAULT_CAMPAIGN, label: "Default", status: "live" as const }];
  const seen = new Set(current.map((c) => c.id));
  return [
    ...current.map((c) => row(c.id, c.label, c.status, false)),
    ...[...new Set([...ever.keys(), ...acts.keys()])]
      .filter((c) => !seen.has(c))
      .sort()
      .map((c) => row(c, c, "ended", true)),
  ];
}

/** Every journey's arrival at a station, and each carry to a new version (`node_counts` skips those). */
async function arrivalsOf(db: Queryable): Promise<Arrival[]> {
  const rows = (await db.execute(sql`
    select substr(e.subject, 9) journey,
      substring(e.workflow from '^shape\\.v([0-9]+)$')::int version,
      substr(e.node, 3) node, to_char((e.at at time zone 'UTC')::date, 'YYYY-MM-DD') as day,
      coalesce(e.data -> 'cause' ->> 'kind', '') = 'version' carried
    from events e
    where e.workflow ~ '^shape\\.v[0-9]+$' and e.subject like 'journey:%' and left(e.node, 2) = 's_'`)) as unknown as Arrival[];
  return rows.map((r) => ({ ...r, version: Number(r.version) }));
}

/**
 * Done acts in a window, by stamp and cap word. Each act counts at its own time: an opener or an
 * invite when sent, a comment when made, a post when published.
 */
async function actsOf(db: Queryable, r: { from?: string; to?: string }): Promise<ActCount[]> {
  const inWindow = (col: SQL) =>
    sql`${col} is not null${r.from ? sql` and (${col} at time zone 'UTC')::date >= ${r.from}::date` : sql``}${r.to ? sql` and (${col} at time zone 'UTC')::date <= ${r.to}::date` : sql``}`;
  const rows = (await db.execute(sql`
    select e.campaign, 'email.opener' act, count(*)::int n
      from messages m join enrollments e on e.id = m.enrollment_id
      where m.step = 1 and ${inWindow(sql`m.sent_at`)} group by 1, 2
    union all
    select c.campaign, c.platform || '.invite', count(*)::int
      from reach_messages m join reach_contacts c on c.id = m.contact_id
      where m.kind = 'connect' and m.direction = 'out' and ${inWindow(sql`m.sent_at`)} group by 1, 2
    union all
    select campaign, platform || '.comment', count(*)::int
      from reach_posts where ${inWindow(sql`commented_at`)} group by 1, 2
    union all
    select i.campaign, d.platform || '.post', count(*)::int
      from content_drafts d join content_ideas i on i.id = d.idea_id
      where d.status = 'published' and ${inWindow(sql`d.published_at`)} group by 1, 2
    union all
    select c.campaign, 'sms.opener', count(*)::int
      from sms_messages m join sms_contacts c on c.id = m.contact_id
      where m.kind = 'sequence' and m.step = 1 and ${inWindow(sql`m.sent_at`)} group by 1, 2`)) as unknown as ActCount[];
  return rows.map((a) => ({ ...a, n: Number(a.n) }));
}

/** The numbers per campaign of the newest shape, in a window (left out: all). */
export async function campaignNumbersOf(
  db: Queryable,
  f: { window?: NumberWindow; from?: string; to?: string; now?: Date } = {},
): Promise<CampaignNumber[]> {
  const r = rangeOf(f);
  const [arrivals, open, deals, [newest], acts] = await Promise.all([
    arrivalsOf(db),
    db
      .select({ version: instances.version, node: instances.node })
      .from(instances)
      .where(eq(instances.status, "open")),
    db
      .select({ journey: pipelineDeals.journey })
      .from(pipelineDeals)
      .where(
        and(
          r.from
            ? gte(sql`(${pipelineDeals.signedAt} at time zone 'UTC')::date`, r.from)
            : undefined,
          r.to ? lte(sql`(${pipelineDeals.signedAt} at time zone 'UTC')::date`, r.to) : undefined,
        ),
      ),
    db
      .select({ number: shapeVersions.number, body: shapeVersions.body })
      .from(shapeVersions)
      .orderBy(sql`${shapeVersions.number} desc`)
      .limit(1),
    actsOf(db, r),
  ]);
  const wanted = [...new Set([...arrivals, ...open].map((a) => a.version))];
  const bodies = new Map<number, StoredBody>();
  if (wanted.length > 0)
    for (const v of await db
      .select({ number: shapeVersions.number, body: shapeVersions.body })
      .from(shapeVersions)
      .where(inArray(shapeVersions.number, wanted)))
      bodies.set(v.number, v.body);
  return campaignNumbers({
    newest: newest?.body ?? null,
    bodies,
    arrivals,
    open,
    deals,
    acts,
    ...r,
  });
}
