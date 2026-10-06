/**
 * LinkedIn activity (S5): a person's posts, reposts and comments, from their activity page read as
 * `linkedin@alt` (autobrowse `GET /in/{vanity}/activity`, 10 a day on that account). Any other
 * account means off: no call. Each item is a `post` finding on the person, dated by the page's age
 * label as autobrowse read it (`approx`), its JSON as the raw. Old items are kept; readers filter.
 * A cap parks the person and stops the pass; a failed read throws, which stops it too.
 */
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { SignalDraft } from "../findings.js";
import { Capped, paced, realSleep, refusedBy } from "../pacing.js";
import { linkedinProfile } from "../people/profile-link.js";
import {
  defineCollector,
  type Pass,
  personKey,
  personOf,
  readAccount,
  subjectOf,
} from "./index.js";
import { decides } from "./talks.js";

/** One item as autobrowse answers it. */
export interface ActivityItem {
  urn: string;
  kind: "post" | "comment" | "repost";
  text: string;
  age?: string;
  at?: string;
  approx?: true;
  reactions: number;
  comments: number;
  url: string;
}

const VERB = { post: "Posted", comment: "Commented", repost: "Reposted" } as const;

/** The pass's people with a `/in/` link, decision makers first, else in the pass's order. */
async function withProfile(db: Queryable, pass: Pass): Promise<string[]> {
  if (pass.personIds.length === 0) return [];
  const rows = await db.execute<{ id: number; title: string | null; linkedin_url: string | null }>(
    sql`select p.id, p.title, p.linkedin_url from unnest(array[${sql.join(
      pass.personIds.map((id) => sql`${id}`),
      sql`, `,
    )}]::int[]) with ordinality q(id, ord) join people p on p.id = q.id order by q.ord`,
  );
  const linked = rows.filter((r) => r.linkedin_url && linkedinProfile(r.linkedin_url));
  return [
    ...linked.filter((r) => decides(r.title)),
    ...linked.filter((r) => !decides(r.title)),
  ].map((r) => personKey(Number(r.id)));
}

export const linkedin = defineCollector({
  name: "linkedin",
  subject: "person",
  built: true,
  settings: z.object({
    /** Items read from the top of the page, newest first. */
    max: z.number().int().min(1).max(100).default(20),
  }),
  bucket: { perDay: 10, burst: 2 },
  everyDays: 30,
  metered: true,
  subjects: (db, pass) => withProfile(db, pass),
  async collect(deps, subject, s) {
    const account = readAccount(deps.linkedin);
    if (!account || !deps.sites)
      return {
        state: "unresolved",
        signals: [],
        tried: [
          { step: "account", what: deps.linkedin ?? "-", outcome: "reads only as linkedin@alt" },
        ],
      };
    const key = subjectOf(subject);
    const p = key && "personId" in key ? await personOf(deps.db, key.personId) : null;
    const link = p?.linkedinUrl ? linkedinProfile(p.linkedinUrl) : null;
    if (!p || !link)
      return {
        state: "unresolved",
        signals: [],
        tried: [{ step: "person", what: subject, outcome: p ? "no /in/ link" : "no such person" }],
      };
    const call = paced(deps.sites, () => deps.now, realSleep);
    let items: ActivityItem[];
    try {
      const res = await call<{ activity?: ActivityItem[] }>(
        "linkedin",
        "GET",
        `/in/${link.vanity}/activity`,
        { max: s.max },
        account,
      );
      items = res.activity ?? [];
    } catch (err) {
      if (err instanceof Capped)
        return {
          state: "capped",
          signals: [],
          tried: [
            { step: "capped", what: err.why, outcome: `retry at ${err.retryAt.toISOString()}` },
          ],
          retryAt: err.retryAt,
          stop: `LinkedIn's activity cap: ${err.why}`,
        };
      const status = refusedBy(err);
      if (status === null) throw err;
      return {
        state: "unresolved",
        signals: [],
        tried: [{ step: "activity", what: link.vanity, outcome: `refused: ${status}` }],
      };
    }
    const signals: SignalDraft[] = [];
    let undated = 0;
    for (const item of items) {
      const at = item.at ? new Date(item.at) : null;
      if (!item.urn || !item.url || !at || Number.isNaN(at.getTime())) {
        undated += 1;
        continue;
      }
      const line = item.text.replace(/\s+/g, " ").trim();
      signals.push({
        personId: p.id,
        kind: "post",
        factKey: `p${p.id}:post:${item.urn}`.slice(0, 400),
        value: {
          title: `${VERB[item.kind] ?? "Posted"}: ${line.length > 120 ? `${line.slice(0, 119)}…` : line}`,
          topic: item.kind,
          text: item.text,
          age: item.age ?? null,
          reactions: item.reactions,
          comments: item.comments,
          raw: item,
        },
        confidence: 1,
        via: account,
        sourceUrl: item.url,
        document: null,
        signalAt: at,
        dated: "approx",
      });
    }
    return {
      state: signals.length ? "found" : "none",
      signals,
      tried: [
        {
          step: "activity",
          what: link.vanity,
          outcome: `${items.length} items${undated ? `, ${undated} with no urn or age` : ""}`,
        },
      ],
    };
  },
});
