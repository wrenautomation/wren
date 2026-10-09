/**
 * Touches (designs/2026-10-07-touches.md): one line per social touch, ours or theirs, on the
 * person's timeline. Writers sit at every send and read point (`recordTouch`), the backfill folds
 * the source tables in with the same refs, and outreach reads them back as context: the DM
 * drafter's prompt, compose's `touch.*` facts, the pre-call brief.
 *
 * A handle is one person on one platform. `resolveHandle` links it to a `people` row and a
 * `leads` row from what we hold (reach contacts, LinkedIn URLs, published profiles, a lead's
 * social URL). Core reads those tables by name, so it imports no channel.
 */
import type { Queryable } from "@wren/db";
import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  type HandleLink,
  type SocialHandle,
  socialHandles,
  TOUCH_PLATFORMS,
  type TouchDirection,
  type TouchKind,
  type TouchResponse,
  touches,
} from "./touches-schema.js";

export * from "./touches-schema.js";

const DAY = 86_400_000;
/** An ours touch with no answer after this long reads "no answer". */
export const NO_ANSWER_DAYS = 14;

export const PLATFORM_LABELS: Record<string, string> = {
  linkedin: "LinkedIn",
  x: "X",
  instagram: "Instagram",
  reddit: "Reddit",
  youtube: "YouTube",
  facebook: "Facebook",
  tiktok: "TikTok",
  google_business: "Business Profile",
};
const label = (p: string) => PLATFORM_LABELS[p] ?? p;

// ---- handles ---------------------------------------------------------------------------

/** One person on one platform, normalized, with their profile page when we can say it. */
export interface HandleRef {
  platform: string;
  handle: string;
  url: string | null;
}

const X_RESERVED = new Set(
  "home i intent search share hashtag explore settings messages notifications compose login signup tos privacy".split(
    " ",
  ),
);
const IG_RESERVED = new Set("p reel reels explore accounts tv direct about legal".split(" "));

const pathOf = (text: string, hosts: RegExp): string[] | null => {
  const m = /^(?:https?:\/\/)?([^/?#]+)(\/[^?#]*)?/i.exec(text);
  if (!m || !hosts.test(m[1] ?? "")) return null;
  return (m[2] ?? "").split("/").filter(Boolean);
};

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

function linkedin(text: string): HandleRef | null {
  const urn = /^urn:li:(person|member|fsd_profile):([A-Za-z0-9_-]{2,100})$/i.exec(text);
  if (urn)
    return { platform: "linkedin", handle: `urn:li:${urn[1]?.toLowerCase()}:${urn[2]}`, url: null };
  const segs = pathOf(text, /(^|\.)linkedin\.com$/i);
  const first = segs?.[0]?.toLowerCase();
  if ((first === "company" || first === "school") && segs?.[1]) {
    const slug = decode(segs[1]).trim().toLowerCase();
    return /^[^\s/?#]{1,100}$/.test(slug)
      ? {
          platform: "linkedin",
          handle: `company:${slug}`,
          url: `https://www.linkedin.com/company/${slug}/`,
        }
      : null;
  }
  let vanity: string | undefined;
  if (segs) vanity = first === "in" ? segs[1] : undefined;
  else if (!/[/:]/.test(text.replace(/^\/?in\//i, ""))) vanity = text.replace(/^\/?in\//i, "");
  const v = vanity ? decode(vanity).trim().toLowerCase() : "";
  if (!v || /[\s/?#@]/.test(v) || v.length > 100) return null;
  return { platform: "linkedin", handle: v, url: `https://www.linkedin.com/in/${v}/` };
}

function x(text: string): HandleRef | null {
  const id = /^id:(\d{1,25})$/.exec(text);
  if (id) return { platform: "x", handle: `id:${id[1]}`, url: `https://x.com/i/user/${id[1]}` };
  const segs = pathOf(text, /(^|\.)(x|twitter)\.com$/i);
  const h = (segs ? (segs[0] ?? "") : text).replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_]{1,15}$/.test(h) || X_RESERVED.has(h)) return null;
  return { platform: "x", handle: h, url: `https://x.com/${h}` };
}

function instagram(text: string): HandleRef | null {
  const segs = pathOf(text, /(^|\.)instagram\.com$/i);
  let h = segs ? (segs[0] ?? "") : text;
  if (segs && h.toLowerCase() === "stories") h = segs[1] ?? "";
  h = h.replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(h) || IG_RESERVED.has(h)) return null;
  return { platform: "instagram", handle: h, url: `https://www.instagram.com/${h}/` };
}

function reddit(text: string): HandleRef | null {
  const segs = pathOf(text, /(^|\.)reddit\.com$/i);
  const h = (
    segs
      ? ["u", "user"].includes(segs[0]?.toLowerCase() ?? "")
        ? (segs[1] ?? "")
        : ""
      : text.replace(/^\/?u(ser)?\//i, "")
  ).toLowerCase();
  if (!/^[a-z0-9_-]{3,20}$/.test(h)) return null;
  return { platform: "reddit", handle: h, url: `https://www.reddit.com/user/${h}` };
}

function youtube(text: string): HandleRef | null {
  const segs = pathOf(text, /(^|\.)youtube\.com$/i);
  if (segs?.[0] === "channel" && segs[1])
    return {
      platform: "youtube",
      handle: segs[1],
      url: `https://www.youtube.com/channel/${segs[1]}`,
    };
  const h = (segs ? (segs[0] ?? "") : text).trim().toLowerCase();
  if (!h || h.length > 100 || /[/?#]/.test(h)) return null;
  return {
    platform: "youtube",
    handle: h,
    url: h.startsWith("@") ? `https://www.youtube.com/${h}` : null,
  };
}

function plain(platform: string, text: string): HandleRef | null {
  const h = text.replace(/^@/, "").trim().toLowerCase();
  return h && h.length <= 200 && !/[\s/?#]/.test(h) ? { platform, handle: h, url: null } : null;
}

/**
 * The handle a platform keys on, from a URL, an `@name`, `u/name`, a LinkedIn vanity or URN, or
 * `id:<n>` (an X user id). Null when it isn't one.
 */
export function normalizeHandle(
  platform: string,
  text: string | null | undefined,
): HandleRef | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  switch (platform) {
    case "linkedin":
      return linkedin(t);
    case "x":
      return x(t);
    case "instagram":
      return instagram(t);
    case "reddit":
      return reddit(t);
    case "youtube":
      return youtube(t);
    default:
      return (TOUCH_PLATFORMS as readonly string[]).includes(platform) ? plain(platform, t) : null;
  }
}

const PREFIXES: Record<string, string> = {
  li: "linkedin",
  linkedin: "linkedin",
  x: "x",
  twitter: "x",
  ig: "instagram",
  instagram: "instagram",
  reddit: "reddit",
  youtube: "youtube",
  yt: "youtube",
};

/** A handle from text alone: a profile URL, `u/name`, a LinkedIn URN, or `<platform>:<handle>`. */
export function parseHandle(text: string): HandleRef | null {
  const t = text.trim();
  if (/^urn:li:/i.test(t)) return linkedin(t);
  if (/^\/?u\//i.test(t)) return reddit(t);
  const host = /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)*([a-z0-9-]+)\.com\//i.exec(t)?.[1]?.toLowerCase();
  const byHost: Record<string, string> = {
    linkedin: "linkedin",
    x: "x",
    twitter: "x",
    instagram: "instagram",
    reddit: "reddit",
    youtube: "youtube",
  };
  if (host && byHost[host]) return normalizeHandle(byHost[host] as string, t);
  const p = /^([a-z]+):(.+)$/i.exec(t);
  const platform = p ? PREFIXES[p[1]?.toLowerCase() ?? ""] : undefined;
  return platform && p ? normalizeHandle(platform, p[2] as string) : null;
}

/**
 * A handle the platform's shape doesn't take (a display name where a handle should be): kept as
 * `name:<words>` so the touch isn't lost; it links to no one until `wren touches link`.
 */
export function nameHandle(platform: string, text: string | null | undefined): HandleRef | null {
  const t = (text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!t || !(TOUCH_PLATFORMS as readonly string[]).includes(platform)) return null;
  return { platform, handle: `name:${t}`.slice(0, 200), url: null };
}

/** `urn:`, `id:`, `company:` and `name:` handles name no profile we can match a person on. */
const opaque = (h: string) => h.includes(":");

const likeSafe = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
type Row = Record<string, unknown>;
const rowsOf = async (db: Queryable, q: ReturnType<typeof sql>) =>
  (await db.execute(q)) as unknown as Row[];
const idOf = (r: Row | undefined, k: string): number | null =>
  r && r[k] != null ? Number(r[k]) : null;

interface Links {
  personId: number | null;
  leadId: number | null;
  by: HandleLink | null;
}

/** Who a handle is in what we hold; nulls when we don't know. */
export async function findLinks(db: Queryable, ref: HandleRef): Promise<Links> {
  let personId: number | null = null;
  let by: HandleLink | null = null;
  const h = ref.handle;
  if (opaque(h)) return { personId: null, leadId: null, by: null };
  if (ref.platform === "linkedin" || ref.platform === "reddit") {
    const [c] = await rowsOf(
      db,
      sql`select person_id from reach_contacts where platform = ${ref.platform}
        and lower(handle) = ${h} and person_id is not null order by id limit 1`,
    );
    personId = idOf(c, "person_id");
    if (personId !== null) by = "reach_contact";
  }
  if (personId === null && ref.platform === "linkedin") {
    const [p] = await rowsOf(
      db,
      sql`select id from people where linkedin_url ~* 'linkedin\\.com/in/'
        and lower(substring(linkedin_url from 'linkedin\\.com/in/([^/?#]+)')) = ${h}
        and not is_testimonial order by id desc limit 1`,
    );
    personId = idOf(p, "id");
    if (personId !== null) by = "linkedin_url";
  }
  if (personId === null && ref.url) {
    const kind = ref.platform === "linkedin" ? "linkedin_person" : ref.platform;
    const [cp] = await rowsOf(
      db,
      ref.platform === "linkedin"
        ? sql`select person_id from contact_points where kind = ${kind} and person_id is not null
            and lower(substring(value from 'linkedin\\.com/in/([^/?#]+)')) = ${h} limit 1`
        : sql`select person_id from contact_points where kind = ${kind} and person_id is not null
            and lower(value) = ${ref.url.toLowerCase()} limit 1`,
    );
    personId = idOf(cp, "person_id");
    if (personId !== null) by = "contact_point";
  }
  let leadId: number | null = null;
  if (personId !== null) {
    const [l] = await rowsOf(
      db,
      sql`select id from leads where person_id = ${personId}
        order by (status = 'verified') desc, id desc limit 1`,
    );
    leadId = idOf(l, "id");
  }
  if (leadId === null) {
    const bare = h.replace(/^@/, "");
    const found = await rowsOf(
      db,
      sql`select id, person_id, social_url from leads
        where social_url ilike ${`%${likeSafe(bare)}%`} order by id desc limit 20`,
    );
    const hit = found.find(
      (r) => normalizeHandle(ref.platform, String(r.social_url))?.handle === h,
    );
    if (hit) {
      leadId = Number(hit.id);
      if (personId === null && hit.person_id != null) personId = Number(hit.person_id);
      by ??= "lead_social";
    }
  }
  if (leadId !== null) by ??= "lead_person";
  return { personId, leadId, by };
}

/**
 * The handle's row, made when new, linked to a person and a lead when we hold them. `personId`
 * and `leadId` given win over what's found; a link already made stays.
 */
export async function resolveHandle(
  db: Queryable,
  ref: HandleRef,
  o: { name?: string | null; personId?: number | null; leadId?: number | null } = {},
): Promise<SocialHandle> {
  const [row] = await db
    .insert(socialHandles)
    .values({
      platform: ref.platform,
      handle: ref.handle.slice(0, 200),
      url: ref.url,
      name: o.name?.trim() || null,
    })
    .onConflictDoUpdate({
      target: [socialHandles.platform, socialHandles.handle],
      set: {
        url: sql`coalesce(${socialHandles.url}, excluded.url)`,
        name: sql`coalesce(${socialHandles.name}, excluded.name)`,
      },
    })
    .returning();
  const h = row as SocialHandle;
  if (h.personId !== null && h.leadId !== null) return h;
  const given = o.personId != null || o.leadId != null;
  const found = await findLinks(db, ref);
  const personId = h.personId ?? o.personId ?? found.personId;
  const leadId = h.leadId ?? o.leadId ?? found.leadId;
  if (personId === h.personId && leadId === h.leadId) return h;
  const [linked] = await db
    .update(socialHandles)
    .set({ personId, leadId, linkedBy: given ? "given" : found.by, linkedAt: sql`now()` })
    .where(eq(socialHandles.id, h.id))
    .returning();
  return linked ?? h;
}

/** Link a handle to a person (and lead) by hand: `wren touches link`. */
export async function linkHandle(
  db: Queryable,
  ref: HandleRef,
  to: { personId: number | null; leadId?: number | null },
): Promise<SocialHandle> {
  const h = await resolveHandle(db, ref);
  const [row] = await db
    .update(socialHandles)
    .set({
      personId: to.personId,
      leadId: to.leadId ?? null,
      linkedBy: "given",
      linkedAt: sql`now()`,
    })
    .where(eq(socialHandles.id, h.id))
    .returning();
  return row ?? h;
}

/**
 * Handles not linked yet, tried again: a person or lead added since links now. Run by the
 * backfill and after imports.
 */
export async function relinkHandles(db: Queryable, limit = 500): Promise<number> {
  const open = await db
    .select()
    .from(socialHandles)
    .where(or(isNull(socialHandles.personId), isNull(socialHandles.leadId)))
    .limit(limit);
  let n = 0;
  for (const h of open) {
    const r = await resolveHandle(db, h);
    if (r.personId !== h.personId || r.leadId !== h.leadId) n++;
  }
  return n;
}

// ---- writing ---------------------------------------------------------------------------

export interface TouchIn {
  platform: string;
  /** As the source has it: a URL, `@name`, a vanity, a URN; normalized here. */
  handle: string;
  name?: string | null;
  personId?: number | null;
  leadId?: number | null;
  kind: TouchKind;
  direction: TouchDirection;
  account?: string | null;
  url?: string | null;
  text?: string | null;
  at: Date;
  externalId?: string | null;
  /** Theirs: the platform id of ours it answers (a reply's parent). */
  inReplyTo?: string | null;
  response?: TouchResponse | null;
  responseAt?: Date | null;
  source: string;
  ref: string;
}

const TEXT_MAX = 4000;

/**
 * Keep one touch; a second call with the same `ref` keeps nothing. Theirs with `inReplyTo`
 * answers ours: linked, and ours reads `replied` when the same person wrote. Null when the
 * handle isn't one (an empty author).
 */
export async function recordTouch(
  db: Queryable,
  t: TouchIn,
): Promise<{ id: number; handleId: number; created: boolean } | null> {
  const ref = normalizeHandle(t.platform, t.handle) ?? nameHandle(t.platform, t.handle);
  if (!ref) return null;
  const h = await resolveHandle(db, ref, {
    name: t.name ?? null,
    personId: t.personId ?? null,
    leadId: t.leadId ?? null,
  });
  const answered =
    t.direction === "theirs" && t.inReplyTo
      ? (
          await db
            .select({ id: touches.id, handleId: touches.handleId, response: touches.response })
            .from(touches)
            .where(and(eq(touches.externalId, t.inReplyTo), eq(touches.direction, "ours")))
            .limit(1)
        )[0]
      : undefined;
  const [row] = await db
    .insert(touches)
    .values({
      handleId: h.id,
      kind: t.kind,
      direction: t.direction,
      account: t.account?.slice(0, 120) ?? null,
      url: t.url || null,
      text: t.text ? t.text.slice(0, TEXT_MAX) : null,
      at: t.at,
      response: t.response ?? null,
      responseAt: t.response ? (t.responseAt ?? null) : null,
      answers: answered?.id ?? null,
      externalId: t.externalId?.slice(0, 200) || null,
      source: t.source,
      ref: t.ref.slice(0, 200),
    })
    .onConflictDoNothing()
    .returning({ id: touches.id });
  if (!row) {
    const [had] = await db
      .select({ id: touches.id })
      .from(touches)
      .where(eq(touches.ref, t.ref.slice(0, 200)));
    return had ? { id: had.id, handleId: h.id, created: false } : null;
  }
  if (
    answered &&
    answered.handleId === h.id &&
    (!answered.response || answered.response === "ignored")
  )
    await db
      .update(touches)
      .set({ response: "replied", responseAt: t.at })
      .where(eq(touches.id, answered.id));
  return { id: row.id, handleId: h.id, created: true };
}

/**
 * Their answer to ours: on the touch with `ref`, or on every ours touch of `handleId` of these
 * kinds before `at`. A touch with an answer keeps it, unless it read `ignored` (a late answer
 * still counts). Returns how many changed.
 */
export async function respond(
  db: Queryable,
  where: { ref: string } | { handleId: number; kinds: readonly TouchKind[]; before?: Date },
  response: TouchResponse,
  at: Date,
): Promise<number> {
  const open = or(isNull(touches.response), eq(touches.response, "ignored"));
  const match =
    "ref" in where
      ? eq(touches.ref, where.ref)
      : and(
          eq(touches.handleId, where.handleId),
          inArray(touches.kind, [...where.kinds]),
          where.before ? lte(touches.at, where.before) : undefined,
        );
  const rows = await db
    .update(touches)
    .set({ response, responseAt: at })
    .where(
      and(
        match,
        eq(touches.direction, "ours"),
        response === "ignored" ? isNull(touches.response) : open,
      ),
    )
    .returning({ id: touches.id });
  return rows.length;
}

/** The handle row for a platform and raw handle, if we have one. */
export async function findHandle(
  db: Queryable,
  platform: string,
  raw: string,
): Promise<SocialHandle | null> {
  const ref = normalizeHandle(platform, raw);
  if (!ref) return null;
  const [h] = await db
    .select()
    .from(socialHandles)
    .where(and(eq(socialHandles.platform, ref.platform), eq(socialHandles.handle, ref.handle)));
  return h ?? null;
}

// ---- reading ---------------------------------------------------------------------------

export interface TouchLine {
  id: number;
  platform: string;
  handle: string;
  name: string | null;
  profileUrl: string | null;
  personId: number | null;
  leadId: number | null;
  kind: TouchKind;
  direction: TouchDirection;
  account: string | null;
  url: string | null;
  text: string | null;
  at: Date;
  response: TouchResponse | null;
  responseAt: Date | null;
}

const lineOf = (r: Row): TouchLine => ({
  id: Number(r.id),
  platform: String(r.platform),
  handle: String(r.handle),
  name: (r.name as string | null) ?? null,
  profileUrl: (r.profile_url as string | null) ?? null,
  personId: r.person_id == null ? null : Number(r.person_id),
  leadId: r.lead_id == null ? null : Number(r.lead_id),
  kind: r.kind as TouchKind,
  direction: r.direction as TouchDirection,
  account: (r.account as string | null) ?? null,
  url: (r.url as string | null) ?? null,
  text: (r.text as string | null) ?? null,
  at: new Date(String(r.at instanceof Date ? r.at.toISOString() : r.at)),
  response: (r.response as TouchResponse | null) ?? null,
  responseAt:
    r.response_at == null
      ? null
      : new Date(
          String(r.response_at instanceof Date ? r.response_at.toISOString() : r.response_at),
        ),
});

/**
 * Every touch with someone, newest first: their person's handles, their lead's, and any handles
 * named. A lead brings its person's; a person brings their leads'.
 */
export async function touchesFor(
  db: Queryable,
  who: { personId?: number | null; leadId?: number | null; handleIds?: readonly number[] },
  limit = 50,
): Promise<TouchLine[]> {
  const p = who.personId ?? null;
  const l = who.leadId ?? null;
  const ids = [...(who.handleIds ?? [])];
  if (p === null && l === null && !ids.length) return [];
  const rows = await rowsOf(
    db,
    sql`select t.id, h.platform, h.handle, h.name, h.url profile_url, h.person_id, h.lead_id,
        t.kind, t.direction, t.account, t.url, t.text, t.at, t.response, t.response_at
      from touches t join social_handles h on h.id = t.handle_id
      where ${sql.join(
        [
          ...(p === null
            ? []
            : [
                sql`h.person_id = ${p}`,
                sql`h.lead_id in (select id from leads where person_id = ${p})`,
              ]),
          ...(l === null
            ? []
            : [
                sql`h.lead_id = ${l}`,
                sql`h.person_id = (select person_id from leads where id = ${l})`,
              ]),
          ...(ids.length
            ? [
                sql`h.id in (${sql.join(
                  ids.map((i) => sql`${i}`),
                  sql`, `,
                )})`,
              ]
            : []),
        ],
        sql` or `,
      )}
      order by t.at desc, t.id desc limit ${limit}`,
  );
  return rows.map(lineOf);
}

/** Many people's touches at once, newest first, at most `each` a person: dossier exports. */
export async function touchesForPeople(
  db: Queryable,
  personIds: readonly number[],
  each = 10,
): Promise<Map<number, TouchLine[]>> {
  const out = new Map<number, TouchLine[]>();
  if (!personIds.length) return out;
  const rows = await rowsOf(
    db,
    sql`select * from (
        select t.id, h.platform, h.handle, h.name, h.url profile_url, h.person_id, h.lead_id,
          t.kind, t.direction, t.account, t.url, t.text, t.at, t.response, t.response_at,
          row_number() over (partition by h.person_id order by t.at desc, t.id desc) n
        from touches t join social_handles h on h.id = t.handle_id
        where h.person_id in (${sql.join(
          personIds.map((i) => sql`${i}`),
          sql`, `,
        )})
      ) x where n <= ${each} order by person_id, at desc, id desc`,
  );
  for (const r of rows) {
    const t = lineOf(r);
    if (t.personId === null) continue;
    const list = out.get(t.personId);
    if (list) list.push(t);
    else out.set(t.personId, [t]);
  }
  return out;
}

/** Who a lookup names: a person id, `lead:<id>`, or a handle (URL, `u/name`, `x:@name`). */
export async function lookupTouches(
  db: Queryable,
  query: string,
  limit = 100,
): Promise<{ who: string; handles: SocialHandle[]; touches: TouchLine[] } | null> {
  const q = query.trim();
  const lead = /^lead:(\d+)$/i.exec(q);
  if (/^\d+$/.test(q) || /^(li|person):\d+$/i.test(q)) {
    const personId = Number(q.replace(/^\D+/, ""));
    const handles = await db
      .select()
      .from(socialHandles)
      .where(eq(socialHandles.personId, personId));
    return {
      who: `person ${personId}`,
      handles,
      touches: await touchesFor(db, { personId }, limit),
    };
  }
  if (lead) {
    const leadId = Number(lead[1]);
    const handles = await db.select().from(socialHandles).where(eq(socialHandles.leadId, leadId));
    return { who: `lead ${leadId}`, handles, touches: await touchesFor(db, { leadId }, limit) };
  }
  const ref = parseHandle(q);
  if (!ref) return null;
  const h = await findHandle(db, ref.platform, ref.handle);
  if (!h) return { who: `${ref.platform}:${ref.handle}`, handles: [], touches: [] };
  const handles = h.personId
    ? await db.select().from(socialHandles).where(eq(socialHandles.personId, h.personId))
    : [h];
  return {
    who: h.personId ? `person ${h.personId}` : `${h.platform}:${h.handle}`,
    handles,
    touches: await touchesFor(
      db,
      { personId: h.personId, leadId: h.leadId, handleIds: [h.id] },
      limit,
    ),
  };
}

// ---- words -----------------------------------------------------------------------------

const OURS: Record<TouchKind, string> = {
  follow: "we followed them",
  connect: "we sent a connection invite",
  comment: "we commented on their post",
  reply: "we replied to their comment",
  dm: "we messaged them",
  like: "we liked their post",
  mention: "we mentioned them",
};
const THEIRS: Record<TouchKind, string> = {
  follow: "they followed us",
  connect: "they sent us an invite",
  comment: "they commented on our post",
  reply: "they replied to us",
  dm: "they messaged us",
  like: "they liked our post",
  mention: "they mentioned us",
};
const RESPONSE: Record<TouchResponse, string> = {
  accepted: "they accepted",
  replied: "they replied",
  liked: "they liked it",
  ignored: "no answer",
};

const day = (d: Date) => d.toISOString().slice(0, 10);
const excerpt = (s: string | null, n = 160) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
};

/** The touch's answer as read now: kept, or "no answer" once `NO_ANSWER_DAYS` pass. */
export function answerOf(t: Pick<TouchLine, "direction" | "kind" | "at" | "response">, now: Date) {
  if (t.direction !== "ours") return null;
  if (t.response) return t.response;
  const waits = ["comment", "reply", "dm", "connect"].includes(t.kind);
  return waits && now.getTime() - t.at.getTime() > NO_ANSWER_DAYS * DAY ? "ignored" : null;
}

/** One touch in words, no date or platform: `we commented on their post: "…" (they replied 2026-10-01)`. */
export function touchText(t: TouchLine, now: Date): string {
  const what = (t.direction === "ours" ? OURS : THEIRS)[t.kind];
  const words = excerpt(t.text);
  const answer = answerOf(t, now);
  const answered = answer
    ? ` (${RESPONSE[answer]}${t.responseAt && answer !== "ignored" ? ` ${day(t.responseAt)}` : ""})`
    : "";
  return `${what}${words ? `: "${words}"` : ""}${answered}`;
}

/** One touch as a prompt line: `2026-09-30 LinkedIn: we commented on their post: "…"`. */
export const touchSentence = (t: TouchLine, now: Date): string =>
  `${day(t.at)} ${label(t.platform)}: ${touchText(t, now)}`;

export const platformLabel = label;

/** Earlier touches as a prompt block, newest first; "" when there are none. */
export function touchesContext(rows: readonly TouchLine[], now: Date, max = 6): string {
  if (!rows.length) return "";
  return `Earlier touches with them, newest first:\n${rows
    .slice(0, max)
    .map((t) => `- ${touchSentence(t, now)}`)
    .join("\n")}`;
}

/** Mutual: theirs, or ours they answered. */
const mutual = (t: TouchLine) =>
  t.direction === "theirs" || (t.response !== null && t.response !== "ignored");
/** What an email may cite: anything mutual, or a public comment or reply of ours. */
const citable = (t: TouchLine) => mutual(t) || t.kind === "comment" || t.kind === "reply";

/** A touch as the clause an email to them says: "your comment on our LinkedIn post". */
export function touchClause(t: TouchLine): string {
  const p = label(t.platform);
  if (t.direction === "theirs")
    return {
      follow: `the follow on ${p}`,
      connect: `connecting on ${p}`,
      comment: `your comment on our ${p} post`,
      reply: `your reply on ${p}`,
      dm: `your message on ${p}`,
      like: `the like on our ${p} post`,
      mention: `the mention on ${p}`,
    }[t.kind];
  if (t.response === "accepted") return `connecting on ${p}`;
  return {
    follow: `following you on ${p}`,
    connect: `connecting on ${p}`,
    comment: `my comment on your ${p} post`,
    reply: `my reply to your comment on ${p}`,
    dm: `our chat on ${p}`,
    like: `your ${p} post`,
    mention: `the mention on ${p}`,
  }[t.kind];
}

const whenOf = (days: number) =>
  days < 7
    ? "this week"
    : days < 14
      ? "last week"
      : days < 31
        ? "this month"
        : days < 62
          ? "last month"
          : "a while back";

/**
 * The `touch.*` facts an email reads: `touch.line` (the clause for the best one to cite: mutual
 * first, then newest), `touch.platform`, `touch.when`, `touch.days`, `touch.count`, and
 * `touch.context` (the prompt block, for `<<slots>>`). No touches, no keys: a `(( ))` group that
 * names one drops.
 */
export function touchFacts(rows: readonly TouchLine[], now: Date): Record<string, string | number> {
  if (!rows.length) return {};
  const out: Record<string, string | number> = {
    "touch.count": rows.length,
    "touch.context": touchesContext(rows, now),
  };
  const best = [...rows]
    .filter(citable)
    .sort((a, b) => Number(mutual(b)) - Number(mutual(a)) || b.at.getTime() - a.at.getTime())[0];
  if (best) {
    const days = Math.max(0, Math.floor((now.getTime() - best.at.getTime()) / DAY));
    out["touch.line"] = touchClause(best);
    out["touch.platform"] = label(best.platform);
    out["touch.days"] = days;
    out["touch.when"] = whenOf(days);
  }
  return out;
}

/** A person's `touch.*` facts, for compose. */
export async function touchFactsFor(
  db: Queryable,
  personId: number,
  now = new Date(),
): Promise<Record<string, string | number>> {
  return touchFacts(await touchesFor(db, { personId }, 20), now);
}
