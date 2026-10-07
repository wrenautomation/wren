/**
 * LinkedIn activity (S5): a person's posts, search first (designs/2026-10-07-linkedin-search-first.md).
 * Exa's index of `linkedin.com/posts` (`web GET /linkedin/posts`), then Google
 * `site:linkedin.com/posts/{vanity}` when Exa is thin. A post counts only when its URL is theirs
 * (`/posts/{vanity}_`); its urn and date come from the URL's activity id (`published`). Only when
 * search found fewer than `enough` recent posts, and the account has room, is their activity page
 * read as the pool account (`readAccount`; autobrowse `GET /in/{vanity}/activity`): those items
 * are dated by the page's age label (`approx`). Wren's outreach account never reads. Each item is
 * a `post` finding on the person, its JSON as the raw; old items are kept, readers filter. A
 * search that fails is said in `tried` and passed; an account cap parks the person only when
 * search found nothing; a failed account read throws, which stops the pass.
 */
import { SiteCallError } from "@wren/core/content";
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { SignalDraft } from "../findings.js";
import { idTime, postOfUrl, type ReadSource, vendorOfSource } from "../linkedin-reads.js";
import { Capped, paced, realSleep, refusedBy, searchStopped } from "../pacing.js";
import { linkedinProfile } from "../people/profile-link.js";
import {
  defineCollector,
  type Pass,
  personKey,
  personOf,
  readAccount,
  subjectOf,
  type Tried,
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
const DAY_MS = 86_400_000;
/** Results a search asks for. */
const SEARCH_N = 10;

/** One post search found: theirs by its URL, dated by its id (or Exa's day). */
export interface SearchedPost {
  urn: string;
  url: string;
  text: string;
  at: Date;
  dated: "published" | "approx";
  via: "exa" | "google";
  raw: unknown;
}

interface ExaPosts {
  posts?: { url: string; title: string | null; publishedDate: string | null; text: string }[];
}
interface Serp {
  results?: { title: string; url: string; snippet?: string }[];
}

type Call = ReturnType<typeof paced>;

/** A search leg's failure, said and passed: search never stops the read. */
function searchFailed(err: unknown, tried: Tried[], step: string, what: string): void {
  if (!(err instanceof SiteCallError) && !(err instanceof Capped)) throw err;
  const stopped = searchStopped(err, "web");
  const status = refusedBy(err);
  const outcome = stopped
    ? `stopped: ${stopped.why}`
    : status !== null
      ? `refused: ${status}`
      : `failed: ${err.message}`;
  tried.push({ step, what, outcome });
}

/**
 * Their posts from search: Exa, then Google when Exa found fewer than `enough` recent ones and
 * Google has room. Deduped by urn, Exa's first.
 */
export async function postsBySearch(
  call: Call,
  who: { vanity: string; name: string; firm: string | null },
  o: { since: Date; enough: number; google: boolean; now: Date },
): Promise<{ posts: SearchedPost[]; tried: Tried[] }> {
  const vanity = who.vanity.toLowerCase();
  const tried: Tried[] = [];
  const posts = new Map<string, SearchedPost>();
  const keep = (p: SearchedPost) => {
    if (!posts.has(p.urn)) posts.set(p.urn, p);
  };
  const recent = () => [...posts.values()].filter((p) => p.at >= o.since).length;

  const q = [who.name, who.firm].filter(Boolean).join(" ");
  try {
    const res = await call<ExaPosts>("web", "GET", "/linkedin/posts", {
      q,
      n: SEARCH_N,
      since: o.since.toISOString().slice(0, 10),
    });
    let theirs = 0;
    for (const r of res.posts ?? []) {
      const post = postOfUrl(r.url);
      if (!post || post.vanity !== vanity) continue;
      const byId = idTime(post.id, o.now);
      const day = r.publishedDate ? new Date(r.publishedDate) : null;
      const at = byId ?? (day && !Number.isNaN(day.getTime()) ? day : null);
      if (!at) continue;
      theirs += 1;
      keep({
        urn: post.urn,
        url: r.url,
        text: r.text || r.title || "",
        at,
        dated: byId ? "published" : "approx",
        via: "exa",
        raw: r,
      });
    }
    tried.push({
      step: "exa",
      what: q,
      outcome: `${res.posts?.length ?? 0} posts, ${theirs} theirs`,
    });
  } catch (err) {
    searchFailed(err, tried, "exa", q);
  }

  if (recent() < o.enough && o.google) {
    const g = `site:linkedin.com/posts/${vanity}`;
    try {
      const res = await call<Serp>("web", "GET", "/google", { q: g, n: SEARCH_N });
      let theirs = 0;
      for (const r of res.results ?? []) {
        const post = postOfUrl(r.url);
        const at = post && post.vanity === vanity ? idTime(post.id, o.now) : null;
        if (!post || !at) continue;
        theirs += 1;
        keep({
          urn: post.urn,
          url: r.url,
          text: r.snippet || r.title,
          at,
          dated: "published",
          via: "google",
          raw: r,
        });
      }
      tried.push({
        step: "google",
        what: g,
        outcome: `${res.results?.length ?? 0} results, ${theirs} theirs`,
      });
    } catch (err) {
      searchFailed(err, tried, "google", g);
    }
  }
  return { posts: [...posts.values()], tried };
}

const lineOf = (text: string) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
};

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

/** Wren's own LinkedIn logins: a client's pass never reads as one of these on its own login. */
export const WREN_LINKEDIN: ReadonlySet<string> = new Set([
  "linkedin",
  "linkedin@wren",
  "linkedin@alt",
  "linkedin@research",
]);

/** A client pass's account as given, but never Wren's outreach login. */
const clientReads = (a: string | null) =>
  a?.trim() && a.trim() !== "linkedin@wren" ? a.trim() : null;

/**
 * A client's own LinkedIn login (`clients.accounts.linkedin`), or null when it has none or it
 * names one of Wren's.
 */
export function clientLinkedin(accounts: Readonly<Record<string, string>> | null): string | null {
  const a = accounts?.linkedin?.trim();
  return a && !WREN_LINKEDIN.has(a) ? a : null;
}

export const linkedin = defineCollector({
  name: "linkedin",
  subject: "person",
  built: true,
  settings: z.object({
    /** Items read from the top of the activity page, newest first. */
    max: z.number().int().min(1).max(100).default(20),
    /** Recent posts search must find before the account isn't asked. */
    enough: z.number().int().min(0).max(20).default(2),
    /** A post this young counts toward `enough`. */
    recentDays: z.number().int().min(1).max(365).default(90),
  }),
  // Search reads are cheap; the account's share is bounded by the shared 20 a day.
  bucket: { perDay: 20, burst: 4 },
  everyDays: 30,
  metered: true,
  vendors: [vendorOfSource("search")],
  subjects: (db, pass) => withProfile(db, pass),
  async collect(deps, subject, s) {
    if (!deps.sites)
      return {
        state: "unresolved",
        signals: [],
        tried: [{ step: "sites", what: "-", outcome: "no site client" }],
      };
    const account =
      deps.linkedinReads === undefined
        ? readAccount(deps.linkedin)
        : clientReads(deps.linkedinReads);
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
    const since = new Date(deps.now.getTime() - s.recentDays * DAY_MS);
    const found = await postsBySearch(
      call,
      { vanity: link.vanity, name: p.fullName, firm: p.firm.name },
      { since, enough: s.enough, google: deps.googleLeft > 0, now: deps.now },
    );
    const tried: Tried[] = [...found.tried];
    const signals: SignalDraft[] = found.posts.map((post) => ({
      personId: p.id,
      kind: "post",
      factKey: `p${p.id}:post:${post.urn}`.slice(0, 400),
      value: {
        title: `Posted: ${lineOf(post.text)}`,
        topic: "post",
        text: post.text,
        age: null,
        reactions: null,
        comments: null,
        raw: post.raw,
      },
      confidence: 1,
      via: post.via,
      sourceUrl: post.url,
      document: null,
      signalAt: post.at,
      dated: post.dated,
    }));
    const recent = found.posts.filter((x) => x.at >= since).length;

    // The account, only when search is thin and it has room.
    let source: ReadSource = "search";
    let capped: Capped | null = null;
    let refused = false;
    const room =
      recent >= s.enough || !account
        ? 0
        : deps.linkedinRoom
          ? await deps.linkedinRoom()
          : Number.POSITIVE_INFINITY;
    if (recent >= s.enough)
      tried.push({ step: "account", what: "-", outcome: `search found ${recent}: not asked` });
    else if (!account)
      tried.push({
        step: "account",
        what:
          deps.linkedinReads === undefined ? (deps.linkedin ?? "-") : (deps.linkedinReads ?? "-"),
        outcome: "no account to read as: search only",
      });
    else if (room < 1)
      tried.push({
        step: "account",
        what: account,
        outcome: "no account reads left today: search only",
      });
    else {
      let items: ActivityItem[] | null = null;
      try {
        const res = await call<{ activity?: ActivityItem[] }>(
          "linkedin",
          "GET",
          `/in/${link.vanity}/activity`,
          { max: s.max },
          account,
        );
        items = res.activity ?? [];
        source = "account";
      } catch (err) {
        if (err instanceof Capped) {
          capped = err;
          tried.push({
            step: "capped",
            what: err.why,
            outcome: `retry at ${err.retryAt.toISOString()}`,
          });
        } else {
          const status = refusedBy(err);
          if (status === null) throw err;
          source = "account";
          refused = true;
          tried.push({ step: "activity", what: link.vanity, outcome: `refused: ${status}` });
        }
      }
      if (items) {
        let undated = 0;
        const seen = new Set(found.posts.map((x) => x.urn));
        for (const item of items) {
          const at = item.at ? new Date(item.at) : null;
          if (!item.urn || !item.url || !at || Number.isNaN(at.getTime())) {
            undated += 1;
            continue;
          }
          // The account's read is richer (counts, kind): it replaces search's copy of a post.
          if (seen.has(item.urn)) {
            const i = signals.findIndex(
              (d) => d.factKey === `p${p.id}:post:${item.urn}`.slice(0, 400),
            );
            if (i >= 0) signals.splice(i, 1);
          }
          signals.push({
            personId: p.id,
            kind: "post",
            factKey: `p${p.id}:post:${item.urn}`.slice(0, 400),
            value: {
              title: `${VERB[item.kind] ?? "Posted"}: ${lineOf(item.text)}`,
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
        tried.push({
          step: "activity",
          what: link.vanity,
          outcome: `${items.length} items${undated ? `, ${undated} with no urn or age` : ""}`,
        });
      }
    }
    return {
      state: signals.length ? "found" : capped ? "capped" : refused ? "unresolved" : "none",
      signals,
      tried,
      ...(capped && !signals.length ? { retryAt: capped.retryAt } : {}),
      spent: [vendorOfSource(source)],
    };
  },
});
