/**
 * Add a creator from Studio (WA-1416, designs/2026-11-16-creator-add.md): one name or profile link
 * in, every account of that person out. Search hits → profile candidates → a pick's labels → what
 * tracks itself (D3) → the person (D4). The `creator_finds` row holds each step for the sheet.
 */
import { normalizeHandle } from "@wren/core/touches";
import { socialHandles } from "@wren/core/touches-schema";
import type { Db, Queryable } from "@wren/db";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { newPerson, personNamed, trackCreator } from "./creators.js";
import {
  type CreatorFind,
  creatorFinds,
  type FindCandidate,
  type FindState,
  trackedCreators as tc,
} from "./creators-schema.js";

export type { CreatorFind, FindCandidate, FindState } from "./creators-schema.js";

/** platforms a find searches, in the sheet's order */
const FIND_PLATFORMS = ["youtube", "tiktok", "instagram", "x", "linkedin", "threads"] as const;
export type FindPlatform = (typeof FIND_PLATFORMS)[number];

/** the host each site-pinned query keeps to */
const FIND_SITES: Record<FindPlatform, string> = {
  youtube: "youtube.com",
  tiktok: "tiktok.com",
  instagram: "instagram.com",
  x: "x.com",
  linkedin: "linkedin.com",
  threads: "threads.net",
};

/** profile reads unproven (D3): a candidate only */
const NEVER_AUTO: readonly string[] = ["linkedin"];

/** The dedupe key: one open find per key. A link loses scheme, www, query and trailing slash. */
export function findInputKey(input: string): string {
  const t = input.trim().replace(/\s+/g, " ").toLowerCase();
  if (!/^(https?:\/\/|www\.)/.test(t)) return t;
  return t
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
}

/** a typed input that is a link, not a name */
export const isLinkInput = (input: string) => /^(https?:\/\/|www\.)\S+$/i.test(input.trim());

/** first path parts that are site pages, not people */
const RESERVED: Record<string, readonly string[]> = {
  instagram: ["p", "reel", "reels", "popular", "explore", "stories", "tv", "accounts", "about"],
  x: ["i", "search", "hashtag", "home", "explore", "intent", "share", "settings"],
};
/** profile tabs: still the profile */
const TABS: Record<string, readonly string[]> = {
  youtube: ["videos", "shorts", "streams", "featured", "about", "playlists", "community", "live"],
  instagram: ["reels", "tagged"],
  x: ["reposts", "media", "with_replies", "highlights", "likes"],
};

/**
 * A link to a profile page itself, as (platform, handle, url); a post, a playlist, a shop or a
 * topic page is null. `parseHandle` maps a post to its author; a find wants only profiles.
 */
export function profileLink(
  link: string,
): { platform: FindPlatform; handle: string; url: string } | null {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(link) ? link : `https://${link}`);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\.|^m\./, "");
  const parts = u.pathname.split("/").filter(Boolean);
  const [a, b, ...rest] = parts;
  if (!a) return null;
  const tabOk = (p: string) => !b || (TABS[p]?.includes(b.toLowerCase()) && !rest.length);
  let platform: FindPlatform | null = null;
  let handle: string | null = null;
  if (host === "youtube.com") {
    platform = "youtube";
    if (a.startsWith("@") && tabOk("youtube")) handle = a;
    else if ((a === "channel" || a === "c" || a === "user") && b && !rest.length)
      handle = `${a}/${b}`;
  } else if (host === "tiktok.com") {
    platform = "tiktok";
    if (a.startsWith("@") && !b) handle = a.slice(1);
  } else if (host === "instagram.com") {
    platform = "instagram";
    if (!RESERVED.instagram?.includes(a.toLowerCase()) && tabOk("instagram")) handle = a;
  } else if (host === "x.com" || host === "twitter.com") {
    platform = "x";
    if (!RESERVED.x?.includes(a.toLowerCase()) && tabOk("x")) handle = a;
  } else if (host.endsWith("linkedin.com")) {
    platform = "linkedin";
    if (a === "in" && b && !rest.length) handle = b;
  } else if (host === "threads.net" || host === "threads.com") {
    platform = "threads";
    if (a.startsWith("@") && !b) handle = a.slice(1);
  }
  if (!platform || !handle) return null;
  const ref = normalizeHandle(platform, decodeURIComponent(handle));
  if (!ref?.url || ref.handle.includes(":")) return null;
  return { platform, handle: ref.handle, url: ref.url };
}

/**
 * The display name in a hit title: the text before ` (@`, ` - `, ` | ` or ` / `, whichever comes
 * first. "Alex Hormozi (@hormozi) • Instagram" → "Alex Hormozi".
 */
export function nameOfTitle(title: string | null | undefined): string | null {
  const t = (title ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  const cut = [" (@", " - ", " | ", " / "]
    .map((s) => t.indexOf(s))
    .filter((i) => i > 0)
    .sort((x, y) => x - y)[0];
  return (cut === undefined ? t : t.slice(0, cut)).trim() || null;
}

/** lowercase, letters and digits, single spaces: "Alex  Hormozi!" → "alex hormozi" */
export const nameKey = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** One site-pinned query per platform: the find's whole search. */
export const findQueries = (name: string) =>
  FIND_PLATFORMS.map((p) => ({
    terms: name,
    site: FIND_SITES[p],
    why: `${name}'s ${p} accounts`,
  }));

/** One search hit, from weaver (`hit` records) or the YouTube API (`findCreators`). */
export interface FindHit {
  url: string;
  title?: string | null;
  snippet?: string | null;
  sources: string[];
  /** given by an API: beats the title's name */
  name?: string | null;
  followers?: number | null;
  raw?: unknown;
}

/** Profile candidates from hits: one per (platform, handle), sources and raw merged. */
export function candidatesOf(hits: FindHit[]): FindCandidate[] {
  const by = new Map<string, FindCandidate & { raw: unknown[] }>();
  for (const h of hits) {
    const p = profileLink(h.url);
    if (!p) continue;
    const key = `${p.platform}:${p.handle.toLowerCase()}`;
    const name = h.name ?? nameOfTitle(h.title);
    const had = by.get(key);
    if (!had) {
      by.set(key, {
        platform: p.platform,
        handle: p.handle,
        url: p.url,
        name,
        followers: h.followers ?? null,
        label: "not a profile",
        why: "",
        sources: [...new Set(h.sources)],
        creatorId: null,
        tracked: null,
        readError: null,
        raw: [h.raw ?? { url: h.url, title: h.title, snippet: h.snippet }],
      });
      continue;
    }
    had.sources = [...new Set([...had.sources, ...h.sources])];
    if (h.name) had.name = h.name;
    else if (!had.name) had.name = name;
    if (h.followers != null) had.followers = Math.max(had.followers ?? 0, h.followers);
    had.raw.push(h.raw ?? { url: h.url, title: h.title, snippet: h.snippet });
  }
  return [...by.values()];
}

// ---- The pick ----------------------------------------------------------------------------------

const PICK_LABELS = ["main", "alternate", "fan", "other person", "not a profile"] as const;

export const PICK = z.object({
  labels: z.array(
    z.object({
      i: z.number().int(),
      label: z.enum(PICK_LABELS),
      why: z.string(),
    }),
  ),
});

export const PICK_SYSTEM =
  "You sort social accounts found for one person. Answer only with JSON that fits the schema.";

/** The pick's prompt: the person, the given link, each candidate with what the search saw. */
export function pickPrompt(name: string, link: string | null, cands: FindCandidate[]): string {
  const rows = cands.map((c, i) => {
    const seen = (Array.isArray(c.raw) ? c.raw : [c.raw])
      .map((r) => {
        const x = (r ?? {}) as { title?: string; snippet?: string; about?: string };
        return [x.title, x.snippet ?? x.about].filter(Boolean).join(" — ");
      })
      .filter(Boolean)
      .slice(0, 2)
      .join(" / ")
      .slice(0, 400);
    return `${i}. ${c.platform} ${c.handle} (${c.url}) name "${c.name ?? "?"}"${
      c.followers != null ? `, ${c.followers} followers` : ""
    }${seen ? `: ${seen}` : ""}`;
  });
  return [
    `Person: ${name}${link ? `\nTheir own link, given: ${link}` : ""}`,
    "",
    "Label each account:",
    "- main: this person's own main account on that platform",
    "- alternate: another account this person or their team runs (clips, a second channel, a language)",
    "- fan: run by someone else about this person (fan page, daily clips by a stranger)",
    "- other person: a different person (same surname, same name, a relative)",
    "- not a profile: a page that is not one person's account",
    "Give each a why of at most 12 words.",
    "",
    ...rows,
    "",
    'JSON: {"labels": [{"i": 0, "label": "main", "why": "..."}]}',
  ].join("\n");
}

/** The pick's labels on the candidates; a candidate the pick skipped stays `not a profile`. */
export function applyPick(cands: FindCandidate[], pick: z.infer<typeof PICK>): FindCandidate[] {
  const out = cands.map((c) => ({ ...c }));
  for (const l of pick.labels) {
    const c = out[l.i];
    if (c) Object.assign(c, { label: l.label, why: l.why });
  }
  return out;
}

/**
 * D3: the candidates that track themselves. Label `main`; name equal to the person's word for word
 * (the handle never counts); the only such one on its platform. Two on YouTube: the one with more
 * subscribers. Two elsewhere: neither. LinkedIn never.
 */
export function autoTracks(cands: FindCandidate[], person: string): FindCandidate[] {
  const want = nameKey(person);
  if (!want) return [];
  const pass = cands.filter(
    (c) => c.label === "main" && nameKey(c.name) === want && !NEVER_AUTO.includes(c.platform),
  );
  const out: FindCandidate[] = [];
  for (const p of new Set(pass.map((c) => c.platform))) {
    const on = pass.filter((c) => c.platform === p);
    if (on.length === 1) out.push(on[0] as FindCandidate);
    else if (p === "youtube") {
      const counted = on.filter((c) => c.followers != null);
      const top = counted.sort((x, y) => (y.followers ?? 0) - (x.followers ?? 0));
      if (top[0] && top[0].followers !== top[1]?.followers) out.push(top[0]);
    }
  }
  return out;
}

// ---- The person (D4) ----------------------------------------------------------------------------

/** Each candidate's tracked creator, when it has one: (platform:handle lowercased) → row. */
export async function trackedOf(
  db: Queryable,
  cands: Pick<FindCandidate, "platform" | "handle">[],
): Promise<Map<string, { id: number; personId: number }>> {
  const out = new Map<string, { id: number; personId: number }>();
  if (!cands.length) return out;
  const keys = cands.map((c) => `${c.platform}:${c.handle.toLowerCase()}`);
  const rows = await db
    .select({
      id: tc.id,
      personId: tc.personId,
      platform: socialHandles.platform,
      handle: socialHandles.handle,
    })
    .from(tc)
    .innerJoin(socialHandles, eq(socialHandles.id, tc.handleId))
    .where(inArray(sql`${socialHandles.platform} || ':' || lower(${socialHandles.handle})`, keys));
  for (const r of rows)
    out.set(`${r.platform}:${r.handle.toLowerCase()}`, { id: r.id, personId: r.personId });
  return out;
}

/**
 * D4: the person of a passing candidate already tracked; else the person with this name; else a
 * new person. Only candidates that pass D3 lend a person (never "Leila").
 */
export async function personForFind(
  db: Queryable,
  o: { name: string; passing: Pick<FindCandidate, "platform" | "handle">[]; addedBy: string },
): Promise<{ id: number; how: "tracked" | "named" | "new" }> {
  const had = await trackedOf(db, o.passing);
  for (const c of o.passing) {
    const t = had.get(`${c.platform}:${c.handle.toLowerCase()}`);
    if (t) return { id: t.personId, how: "tracked" };
  }
  const named = await personNamed(db, o.name);
  if (named) return { id: named.id, how: "named" };
  return { id: (await newPerson(db, { name: o.name, addedBy: o.addedBy })).id, how: "new" };
}

// ---- The find row -------------------------------------------------------------------------------

/** a claimed find with no step for this long has stopped (the desk's own cap, D7) */
const FIND_STALE_MS = 10 * 60_000;
export const STALE_WHY = "The Mac stopped answering after 10 minutes";
const staleAt = () => new Date(Date.now() - FIND_STALE_MS);

/** A new find, or the open one with the same input key in its place. */
export async function openFind(
  db: Queryable,
  o: { input: string; niche: string; requestedBy: string },
): Promise<{ find: CreatorFind; opened: boolean }> {
  const inputKey = findInputKey(o.input);
  // a stopped find frees its key, so Try again opens a new one; a waiting one waits on the Mac
  await db
    .update(creatorFinds)
    .set({ state: "failed", step: null, error: STALE_WHY, updatedAt: new Date() })
    .where(
      and(
        eq(creatorFinds.inputKey, inputKey),
        eq(creatorFinds.state, "finding"),
        lt(creatorFinds.updatedAt, staleAt()),
      ),
    );
  const [made] = await db
    .insert(creatorFinds)
    .values({ input: o.input.trim(), inputKey, niche: o.niche, requestedBy: o.requestedBy })
    .onConflictDoNothing()
    .returning();
  if (made) return { find: made, opened: true };
  const [open] = await db
    .select()
    .from(creatorFinds)
    .where(
      and(eq(creatorFinds.inputKey, inputKey), inArray(creatorFinds.state, ["waiting", "finding"])),
    )
    .limit(1);
  if (!open) throw new Error(`find for "${o.input}" neither made nor open`);
  return { find: open, opened: false };
}

export async function findById(db: Queryable, id: number): Promise<CreatorFind | null> {
  const [f] = await db.select().from(creatorFinds).where(eq(creatorFinds.id, id)).limit(1);
  return f ?? null;
}

/** One step's write: the state, the step text, the candidates, the run, the error. */
export async function setFind(
  db: Queryable,
  id: number,
  patch: Partial<{
    state: FindState;
    step: string | null;
    name: string;
    personId: number;
    candidates: FindCandidate[];
    runId: string;
    usd: number;
    error: string | null;
  }>,
): Promise<void> {
  await db
    .update(creatorFinds)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(creatorFinds.id, id));
}

// ---- The sheet ----------------------------------------------------------------------------------

/** a tracked candidate's read, as the sheet shows it */
export interface FindRead {
  readAt: string | null;
  readFails: number;
  readError: string | null;
  active: boolean;
}

/** The find with each tracked candidate's read state. */
export async function findShown(db: Queryable, id: number) {
  const found = await findById(db, id);
  if (!found) return null;
  const f =
    found.state === "finding" && found.updatedAt < staleAt()
      ? { ...found, state: "failed" as const, step: null, error: STALE_WHY }
      : found;
  const ids = f.candidates.map((c) => c.creatorId).filter((n): n is number => n != null);
  const reads = ids.length
    ? await db
        .select({
          id: tc.id,
          readAt: tc.readAt,
          readFails: tc.readFails,
          readError: tc.readError,
          active: tc.active,
        })
        .from(tc)
        .where(inArray(tc.id, ids))
    : [];
  const by = new Map(reads.map((r) => [r.id, r]));
  return {
    ...f,
    candidates: f.candidates.map(({ raw: _raw, ...c }) => {
      const r = c.creatorId != null ? by.get(c.creatorId) : undefined;
      const read: FindRead | null = r
        ? {
            readAt: r.readAt?.toISOString() ?? null,
            readFails: r.readFails,
            readError: r.readError,
            active: r.active,
          }
        : null;
      return { ...c, read };
    }),
  };
}

/**
 * The ticked candidates tracked to the find's person (a portal write, D2 step 4). An account
 * tracked before keeps its person. Answers the ids to read.
 */
export async function trackTicked(
  db: Db,
  o: { id: number; picks: { platform: string; handle: string }[]; by: string },
): Promise<number[]> {
  const f = await findById(db, o.id);
  if (!f) throw new Error(`no find ${o.id}`);
  if (f.state !== "found") throw new Error("only a found find takes ticks");
  const cands = f.candidates.map((c) => ({ ...c }));
  const want = new Set(o.picks.map((p) => `${p.platform}:${p.handle.toLowerCase()}`));
  const picked = cands.filter((c) => want.has(`${c.platform}:${c.handle.toLowerCase()}`));
  const before = await trackedOf(db, picked);
  const personId =
    f.personId ??
    (await personForFind(db, { name: f.name ?? f.input, passing: [], addedBy: o.by })).id;
  const read: number[] = [];
  for (const c of picked) {
    if (c.tracked) continue;
    const had = before.get(`${c.platform}:${c.handle.toLowerCase()}`);
    if (had) {
      Object.assign(c, { creatorId: had.id, tracked: "before" });
      continue;
    }
    const t = await trackCreator(db, {
      platform: c.platform,
      handle: c.handle,
      niches: [f.niche],
      note: `Studio add: ticked, ${c.label}`,
      addedBy: o.by,
      personId,
    });
    Object.assign(c, { creatorId: t.id, tracked: "tick" });
    read.push(t.id);
  }
  await setFind(db, o.id, { personId, candidates: cands });
  return read;
}

/** what the Add sheet reads: the find with each tracked candidate's read */
export type FindShown = NonNullable<Awaited<ReturnType<typeof findShown>>>;
export type FindShownCandidate = FindShown["candidates"][number];
