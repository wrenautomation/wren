/**
 * LinkedIn as an `OutreachChannel`, over autobrowse's `linkedin` site (the
 * signed-in page on the Mac). One adapter = one real account: build it over
 * `asAccount(sites, "linkedin@wren")`. No account is ever made here:
 * LinkedIn allows one profile per person and removes duplicates.
 *
 * find: people search (`founder recruiting agency`), or `company/<handle>
 * [words]` for one company's people. enrich: the profile with experience.
 * relationship: from the profile's buttons (connected, pending, none).
 * connect: an invite, with a note when given. message: a 1st-degree message;
 * the loop asks `relationship` first and never messages a pending invite.
 * replies: the unread conversations in the inbox (one row per thread; the
 * preview is the text we have).
 */
import type { SiteClient } from "@wren/core/content";
import {
  type AccountHealth,
  type FindQuery,
  type Found,
  HANDLE_RE,
  handleOf,
  type OutreachChannel,
  type Profile,
  type Relationship,
  type Reply,
  type Sent,
} from "@wren/core/outreach";

export const LINKEDIN_SITE = "linkedin";

export interface LinkedInOutreachOptions {
  account: string;
  /** When the account started reaching out under wren (the ramp's day one). */
  startedOn?: string | null;
  now?: () => Date;
}

/** autobrowse's `Person`, `Profile`, `Conversation`: only what is read here. */
interface Person {
  name: string;
  vanity: string;
  url: string;
  degree?: string;
  headline?: string;
  location?: string;
  current?: string;
}
interface Role {
  title: string;
  company: string;
  companyUrl?: string;
  current?: boolean;
  when?: string;
}
interface LiProfile extends Person {
  connections?: string;
  about?: string;
  roles?: Role[];
  company?: { name?: string; website?: string; industry?: string; size?: string };
}
interface Conversation {
  url: string;
  name: string;
  vanity?: string;
  preview: string;
  when: string;
  unread: boolean;
}

/** `company/acme founder` → { company: "acme", words: "founder" }. */
export function parseFindQuery(query: string): { company: string | null; words: string } {
  const m = /^\s*company\/([A-Za-z0-9._-]+)\b\s*(.*)$/i.exec(query);
  if (m) return { company: m[1] ?? null, words: (m[2] ?? "").trim() };
  return { company: null, words: query.trim() };
}

export function linkedinOutreach(sites: SiteClient, o: LinkedInOutreachOptions): OutreachChannel {
  const now = o.now ?? (() => new Date());
  const call = <T>(
    method: "GET" | "POST",
    path: string,
    input: Record<string, unknown> = {},
  ): Promise<T> => sites.call<T>(LINKEDIN_SITE, method, path, input);
  const via = (method: "GET" | "POST", path: string) =>
    sites.via(LINKEDIN_SITE, method, path).then((v) => (v === "browser" ? "browser" : "api"));
  const vanityOf = (handle: string) => {
    const v = handleOf("linkedin", handle);
    if (!HANDLE_RE.linkedin.test(v)) throw new Error(`linkedin: not a profile handle: ${handle}`);
    return v;
  };
  const prospect = (p: Person, foundIn: string) => ({
    handle: p.vanity,
    url: p.url,
    name: p.name || null,
    headline: p.headline ?? p.current ?? null,
    foundIn,
  });

  return {
    platform: "linkedin",
    account: o.account,

    async find(q: FindQuery): Promise<Found> {
      const { company, words } = parseFindQuery(q.query);
      if (company) {
        const r = await call<{ people: Person[] }>("GET", `/company/${company}/people`, {
          ...(words ? { keywords: words } : {}),
          max: Math.min(Math.max(q.limit, 1), 100),
        });
        return {
          prospects: r.people.map((p) => prospect(p, `company/${company}`)),
          cursor: null,
          fetchedWith: await via("GET", "/company/{company}/people"),
        };
      }
      // One page per call (10 rows); the cursor is the next page number.
      const page = q.cursor ? Number(q.cursor) : 1;
      const r = await call<{ people: Person[]; pages: number }>("GET", "/search/results/people", {
        keywords: words,
        page,
        pages: 1,
      });
      const prospects = r.people.slice(0, q.limit).map((p) => prospect(p, `search:${words}`));
      return {
        prospects,
        cursor: r.people.length >= 10 ? String(page + 1) : null,
        fetchedWith: await via("GET", "/search/results/people"),
      };
    },

    async enrich(handle: string): Promise<Profile> {
      const vanity = vanityOf(handle);
      const p = await call<LiProfile>("GET", `/in/${vanity}`, { experience: true });
      const current = p.roles?.find((r) => r.current) ?? p.roles?.[0] ?? null;
      return {
        handle: p.vanity || vanity,
        url: p.url || `https://www.linkedin.com/in/${vanity}/`,
        name: p.name || null,
        headline: p.headline ?? null,
        foundIn: "enrich",
        about: p.about ?? null,
        current: current ? `${current.title} at ${current.company}` : (p.current ?? null),
        company: p.company?.name ?? current?.company ?? null,
        location: p.location ?? null,
        recent: [],
        raw: p as unknown as Record<string, unknown>,
        fetchedAt: now().toISOString(),
        fetchedWith: await via("GET", "/in/{vanity}"),
      };
    },

    async relationship(handle: string): Promise<Relationship> {
      const r = await call<{ relationship: Relationship }>(
        "GET",
        `/in/${vanityOf(handle)}/relationship`,
      );
      return r.relationship ?? "unknown";
    },

    async connect(handle, note): Promise<Sent> {
      const vanity = vanityOf(handle);
      await call("POST", `/in/${vanity}/connect`, note ? { note: note.slice(0, 200) } : {});
      return { ref: null, at: now().toISOString(), fetchedWith: await via("POST", "/in/{vanity}/connect") };
    },

    async message(handle, text): Promise<Sent> {
      const vanity = vanityOf(handle);
      await call("POST", `/in/${vanity}/message`, { text });
      return { ref: null, at: now().toISOString(), fetchedWith: await via("POST", "/in/{vanity}/message") };
    },

    async replies(): Promise<Reply[]> {
      const r = await call<{ conversations: Conversation[] }>("GET", "/messaging", { unread: true });
      const at = now().toISOString();
      return r.conversations
        .filter((c) => c.unread && c.vanity)
        .map((c) => ({
          // The list shows no message id: the thread plus its time label dedupes a reply.
          ref: `${c.url}#${c.when}`,
          handle: c.vanity as string,
          name: c.name || null,
          text: c.preview,
          at,
          threadUrl: c.url,
        }));
    },

    async health(): Promise<AccountHealth> {
      // LinkedIn shows no standing score; the ramp runs on the day outreach started.
      return {
        handle: o.account,
        createdAt: o.startedOn ?? null,
        karma: null,
        suspended: false,
        acceptsMessages: null,
        raw: {},
        asOf: now().toISOString(),
      };
    },
  };
}
