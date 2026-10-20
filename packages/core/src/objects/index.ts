/**
 * The one write path for platform objects (designs/2026-10-20-platform-objects.md). A writer that
 * saw a post or comment calls `resolveObject` and gets back its canonical ref; a reader calls
 * `findObject` with any spelling. `linkRefs` joins two spellings of one object after the fact
 * and moves every role row to the kept one (`./roles.ts`).
 *
 * Every function takes a `Queryable`, so a caller's transaction holds the writes.
 */
import { atomic, type Queryable, setAuditActor, type Tx } from "@wren/db";
import { pgSafe } from "@wren/db/columns";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Platform } from "../content/index.js";
import {
  OBJECT_KINDS,
  type ObjectKind,
  type PlatformObject,
  platformObjectRefs,
  platformObjects,
} from "../objects-schema.js";
import { CanonError, canonRef, fromUrl, looksLikeUrl, normalUrl, preferRef } from "./canon.js";
import { ITEM_HOMES, OBJECT_ROLES, type ObjectRole, ROLE_ITEMS } from "./roles.js";

export * from "./canon.js";
export { ITEM_HOMES, OBJECT_ROLES, type ObjectRole, ROLE_ITEMS, type TwinRule } from "./roles.js";

type Row = Record<string, unknown>;

/** Items per batch: one JSON parameter each, so the limit is the size of the text, not a count. */
const CHUNK = 5000;
/** An alias longer than this is not a spelling worth keeping (a btree entry has a size limit). */
const MAX_ALIAS = 1000;

export interface ObjectInput {
  platform: Platform;
  kind: ObjectKind;
  /** The spelling the writer holds: an API id, a fullname, a URN or a URL. */
  raw: string;
  url?: string | null | undefined;
  /** The root post, on a comment. Any spelling of it. */
  post?: string | null | undefined;
  /** What a comment answers: another comment, or the post. Any spelling. */
  parent?: string | null | undefined;
  author?: string | null | undefined;
  at?: Date | null | undefined;
}

const clean = (s: string | null | undefined, max: number): string | null => {
  const t = typeof s === "string" ? pgSafe(s).trim() : "";
  return t ? t.slice(0, max) : null;
};

/** The spellings of `raw` the alias table may hold: itself, and its normal URL when it is one. */
const spellingsOf = (raw: string): string[] => {
  const s = raw.trim();
  const n = looksLikeUrl(s) ? normalUrl(s) : s;
  return n === s ? [s] : [s, n];
};

/** The URL as an alias: only when it names this object, or names none (no id to derive). */
function urlAlias(
  platform: string,
  kind: ObjectKind,
  ref: string,
  url: string | null | undefined,
): string | null {
  const u = clean(url, 2048);
  if (!u || !looksLikeUrl(u)) return null;
  const found = fromUrl(u);
  // A comment's URL is often its post's page; that page must not become the comment's alias.
  const fits = found ? found.platform === platform && found.ref === ref : kind !== "comment";
  const alias = normalUrl(u);
  return fits && alias !== ref && alias.length <= MAX_ALIAS ? alias : null;
}

interface Look {
  platform: string;
  kind: ObjectKind;
  alias: string;
}
const lookKey = (l: Look): string => `${l.platform}\u0000${l.kind}\u0000${l.alias}`;

interface Planned {
  input: ObjectInput;
  raw: string;
  /** The ref of each spelling, once the alias lookup is in. */
  ref: string;
  post: string | null;
  parent: string | null;
}

/**
 * Resolve many objects with at most three statements per 5,000: the alias lookup, the object
 * upsert, the alias insert. Returns each `raw` as given, mapped to its canonical ref. Throws a
 * `CanonError` for a spelling no rule reads and an alias does not know, before any write.
 * A `raw` that two items give for different platforms or kinds keeps the last one's ref.
 */
export async function resolveObjects(
  db: Queryable,
  items: readonly ObjectInput[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    const refs = await resolveChunk(db, chunk);
    for (const [n, it] of chunk.entries()) out.set(it.raw, refs[n] as string);
  }
  return out;
}

/** One object's canonical ref, made on first sight. See `resolveObjects`. */
export async function resolveObject(db: Queryable, input: ObjectInput): Promise<string> {
  const refs = await resolveChunk(db, [input]);
  return refs[0] as string;
}

/**
 * `resolveObject`, or null when no rule reads the spelling (a `CanonError`, thrown before any
 * write). For a writer that records what already happened, a send or an answer, and must not fail
 * on the id the platform gave.
 */
export async function resolveObjectOrNull(
  db: Queryable,
  input: ObjectInput,
): Promise<string | null> {
  try {
    return await resolveObject(db, input);
  } catch (e) {
    if (e instanceof CanonError) return null;
    throw e;
  }
}

/** A comment a reader saw: its id, what it answers (the post, or another comment) and the rest. */
export interface CommentSeen {
  raw: string;
  /** Null or the post's own spelling: a root comment. */
  parent?: string | null | undefined;
  author?: string | null | undefined;
  at?: Date | null | undefined;
  url?: string | null | undefined;
}

export interface CommentsResolved {
  /** The post's ref. */
  post: string;
  /** Each kept comment's refs, by the `raw` it came in under. */
  refs: Map<string, { ref: string; parent: string }>;
  /** The `raw` of each comment no rule reads: it cannot be kept. */
  unread: string[];
}

/**
 * The post and its comments as objects, in the caller's transaction, for a writer that is about
 * to insert `comments` rows: the post, each comment, and each parent comment a reply names (kept
 * or not). A comment whose id no rule reads is left out and listed in `unread`. A post no rule
 * reads throws a `CanonError`.
 */
export async function resolveComments(
  db: Queryable,
  platform: Platform,
  post: {
    raw: string;
    url?: string | null | undefined;
    author?: string | null | undefined;
    at?: Date | null | undefined;
  },
  seen: readonly CommentSeen[],
): Promise<CommentsResolved> {
  const postRef = await resolveObject(db, { platform, kind: "post", ...post });
  const isRoot = (parent: string | null | undefined): boolean => {
    const p = parent?.trim();
    if (!p || p === post.raw.trim()) return true;
    try {
      return canonRef(platform, "post", p) === postRef;
    } catch {
      return false;
    }
  };
  const items = (list: readonly CommentSeen[]): ObjectInput[] =>
    list.flatMap((c) => {
      const root = isRoot(c.parent);
      const base = { platform, kind: "comment" as const, post: post.raw };
      return [
        {
          ...base,
          raw: c.raw,
          parent: root ? post.raw : c.parent,
          author: c.author,
          at: c.at,
          url: c.url,
        },
        ...(root ? [] : [{ ...base, raw: c.parent as string }]),
      ];
    });
  const refs = new Map<string, { ref: string; parent: string }>();
  const unread: string[] = [];
  const keep = (list: readonly CommentSeen[], got: Map<string, string>) => {
    for (const c of list)
      refs.set(c.raw, {
        ref: got.get(c.raw) as string,
        parent: isRoot(c.parent) ? postRef : (got.get(c.parent as string) as string),
      });
  };
  try {
    keep(seen, await resolveObjects(db, items(seen)));
  } catch (e) {
    if (!(e instanceof CanonError)) throw e;
    // A spelling no rule reads throws before any write: find which comments carry one.
    const good: CommentSeen[] = [];
    for (const c of seen) {
      try {
        await resolveObjects(db, items([c]));
        good.push(c);
      } catch (e2) {
        if (!(e2 instanceof CanonError)) throw e2;
        unread.push(c.raw);
      }
    }
    keep(good, await resolveObjects(db, items(good)));
  }
  return { post: postRef, refs, unread };
}

async function resolveChunk(db: Queryable, items: readonly ObjectInput[]): Promise<string[]> {
  if (!items.length) return [];
  // 1. Every spelling to look up, once: the object's own, its URL, its post and its parent.
  const looks = new Map<string, Look>();
  const want = (platform: string, kind: ObjectKind, raw: string | null | undefined) => {
    const s = raw?.trim();
    if (!s) return;
    for (const alias of spellingsOf(s)) {
      const l = { platform, kind, alias };
      looks.set(lookKey(l), l);
    }
  };
  for (const it of items) {
    if (typeof it.raw !== "string" || !it.raw.trim())
      throw new CanonError(`${it.platform} ${it.kind}: empty`);
    want(it.platform, it.kind, it.raw);
    if (it.url) want(it.platform, it.kind, normalUrl(it.url));
    want(it.platform, "post", it.post);
    want(it.platform, "comment", it.parent);
    want(it.platform, "post", it.parent);
  }
  const known = new Map<string, string>();
  const found = await db.execute<{
    platform: string;
    kind: string;
    alias: string;
    ref: string;
  }>(sql`
    select q.platform, q.kind, q.alias, a.ref
    from jsonb_to_recordset(${JSON.stringify([...looks.values()])}::jsonb) as q(platform text, kind text, alias text)
    join platform_object_refs a on a.platform = q.platform and a.alias = q.alias
    join platform_objects o on o.platform = a.platform and o.ref = a.ref and o.kind = q.kind`);
  for (const f of found) known.set(lookKey({ ...f, kind: f.kind as ObjectKind }), f.ref);
  const hit = (platform: string, kind: ObjectKind, spellings: string[]): string | undefined => {
    for (const alias of spellings) {
      const ref = known.get(lookKey({ platform, kind, alias }));
      if (ref) return ref;
    }
    return undefined;
  };
  // A known alias wins over the rule; otherwise the rule decides (or refuses).
  const refOf = (platform: Platform, kind: ObjectKind, raw: string): string =>
    hit(platform, kind, spellingsOf(raw)) ?? canonRef(platform, kind, raw);

  // 2. Each item's refs.
  const planned: Planned[] = items.map((input) => {
    const raw = input.raw.trim();
    const { platform, kind } = input;
    const ref =
      hit(platform, kind, spellingsOf(raw)) ??
      (input.url ? hit(platform, kind, [normalUrl(input.url)]) : undefined) ??
      canonRef(platform, kind, raw);
    const postRaw = clean(input.post, 2048);
    const post = postRaw ? refOf(platform, "post", postRaw) : null;
    const parentRaw = clean(input.parent, 2048);
    let parent: string | null = null;
    if (parentRaw) {
      if (post && parentRaw === postRaw) parent = post;
      else {
        try {
          parent = refOf(platform, "comment", parentRaw);
        } catch (e) {
          // A root comment names its post as the parent, in the post's own spelling.
          const asPost =
            post && e instanceof CanonError ? refOf(platform, "post", parentRaw) : null;
          if (asPost !== post || !post) throw e;
          parent = post;
        }
      }
    }
    return { input, raw, ref, post, parent };
  });

  // 3. One row per object, one per alias, each in key order so two writers lock in one order.
  const objects = new Map<string, Row>();
  const aliases = new Map<string, Row>();
  for (const p of planned) {
    const { platform, kind } = p.input;
    const key = `${platform}\u0000${p.ref}`;
    const prev = objects.get(key);
    const next = {
      platform,
      ref: p.ref,
      kind,
      url: clean(p.input.url, 2048),
      post: p.post,
      parent: p.parent,
      author: clean(p.input.author, 200),
      at:
        p.input.at instanceof Date && !Number.isNaN(p.input.at.getTime())
          ? p.input.at.toISOString()
          : null,
    };
    objects.set(
      key,
      prev
        ? Object.fromEntries(
            Object.entries(prev).map(([k, v]) => [k, v ?? next[k as keyof typeof next]]),
          )
        : next,
    );
    const spelled = looksLikeUrl(p.raw) ? normalUrl(p.raw) : p.raw;
    const candidates = [
      spelled !== p.ref && spelled.length <= MAX_ALIAS ? spelled : null,
      p.input.url ? urlAlias(platform, kind, p.ref, p.input.url) : null,
    ];
    for (const alias of candidates) {
      if (alias && alias !== p.ref && !aliases.has(`${platform}\u0000${alias}`))
        aliases.set(`${platform}\u0000${alias}`, { platform, alias, ref: p.ref });
    }
  }
  const byKey = (a: Row, b: Row, k: string) =>
    String(a.platform) < String(b.platform)
      ? -1
      : String(a.platform) > String(b.platform)
        ? 1
        : String(a[k]) < String(b[k])
          ? -1
          : String(a[k]) > String(b[k])
            ? 1
            : 0;
  const objectRows = [...objects.values()].sort((a, b) => byKey(a, b, "ref"));
  const aliasRows = [...aliases.values()].sort((a, b) => byKey(a, b, "alias"));

  await db.execute(sql`
    insert into platform_objects (platform, ref, kind, url, post, parent, author, "at")
    select x.platform, x.ref, x.kind, x.url, x.post, x.parent, x.author, x."at"
    from jsonb_to_recordset(${JSON.stringify(objectRows)}::jsonb)
      as x(platform text, ref text, kind text, url text, post text, parent text, author text, "at" timestamptz)
    on conflict (platform, ref) do update set
      last_seen = now(),
      url = coalesce(platform_objects.url, excluded.url),
      post = coalesce(platform_objects.post, excluded.post),
      parent = coalesce(platform_objects.parent, excluded.parent),
      author = coalesce(platform_objects.author, excluded.author),
      "at" = coalesce(platform_objects."at", excluded."at")`);
  if (aliasRows.length)
    await db.execute(sql`
      insert into platform_object_refs (platform, alias, ref)
      select x.platform, x.alias, x.ref
      from jsonb_to_recordset(${JSON.stringify(aliasRows)}::jsonb) as x(platform text, alias text, ref text)
      on conflict (platform, alias) do nothing`);
  return planned.map((p) => p.ref);
}

// ---- Reading ---------------------------------------------------------------------------------

export interface FoundObject extends PlatformObject {
  aliases: string[];
}

/**
 * The object a spelling names: its ref, an alias, a URL (by the id it carries, else by its normal
 * form) or, with a platform, any spelling `canonRef` reads. Null when no object holds it.
 */
export async function findObject(
  db: Queryable,
  spelling: string,
  platform?: string | null,
): Promise<FoundObject | null> {
  const s = spelling.trim();
  if (!s) return null;
  const spellings = spellingsOf(s);
  const only = platform ? sql`and platform = ${platform}` : sql``;
  const [direct] = await db.execute<{ platform: string; ref: string }>(sql`
    select platform, ref from (
      select platform, ref, 1 pri from platform_objects where ref in (${sql.join(
        spellings.map((x) => sql`${x}`),
        sql`, `,
      )}) ${only}
      union all
      select platform, ref, 2 pri from platform_object_refs where alias in (${sql.join(
        spellings.map((x) => sql`${x}`),
        sql`, `,
      )}) ${only}
    ) f order by pri, platform limit 1`);
  let at: { platform: string; ref: string } | undefined = direct;
  if (!at) {
    const cands: { platform: string; ref: string }[] = [];
    const u = fromUrl(s);
    if (u && (!platform || u.platform === platform)) cands.push(u);
    if (platform)
      for (const kind of OBJECT_KINDS) {
        try {
          cands.push({ platform, ref: canonRef(platform, kind, s) });
        } catch {
          // not a spelling of this kind
        }
      }
    for (const c of cands) {
      const [row] = await db
        .select({ platform: platformObjects.platform, ref: platformObjects.ref })
        .from(platformObjects)
        .where(and(eq(platformObjects.platform, c.platform), eq(platformObjects.ref, c.ref)))
        .limit(1);
      if (row) {
        at = row;
        break;
      }
    }
  }
  if (!at) return null;
  const [object] = await db
    .select()
    .from(platformObjects)
    .where(and(eq(platformObjects.platform, at.platform), eq(platformObjects.ref, at.ref)))
    .limit(1);
  if (!object) return null;
  const rows = await db
    .select({ alias: platformObjectRefs.alias })
    .from(platformObjectRefs)
    .where(and(eq(platformObjectRefs.platform, at.platform), eq(platformObjectRefs.ref, at.ref)))
    .orderBy(asc(platformObjectRefs.alias));
  return { ...object, aliases: rows.map((r) => r.alias) };
}

export interface RoleRows {
  table: string;
  column: string;
  count: number;
  /** The first rows' ids (at most 20). */
  ids: string[];
}

const applies = (role: ObjectRole, platform: string): boolean =>
  role.fixed ? role.fixed === platform : true;
const onPlatform = (role: ObjectRole, platform: string, as?: string) =>
  role.platform
    ? as
      ? sql`${sql.identifier(as)}.${sql.identifier(role.platform)} = ${platform}`
      : sql`${sql.identifier(role.platform)} = ${platform}`
    : sql`true`;

/** The role rows that name any of these spellings: which table and which ids hold the object. */
export async function roleRowsOf(
  db: Queryable,
  platform: string,
  refs: readonly string[],
): Promise<RoleRows[]> {
  const out: RoleRows[] = [];
  if (!refs.length) return out;
  const list = sql.join(
    refs.map((r) => sql`${r}`),
    sql`, `,
  );
  for (const role of OBJECT_ROLES) {
    if (!applies(role, platform)) continue;
    const [r] = await db.execute<{ n: number; ids: string[] | null }>(sql`
      select count(*)::int n, (array_agg(id::text order by id))[1:20] ids
      from ${sql.identifier(role.table)}
      where ${onPlatform(role, platform)} and ${sql.identifier(role.column)} in (${list})`);
    if (r && r.n > 0)
      out.push({ table: role.table, column: role.column, count: r.n, ids: r.ids ?? [] });
  }
  return out;
}

// ---- Linking ---------------------------------------------------------------------------------

/** A link the data does not allow: two rows in a table that keeps one row per object. */
export class LinkRefusedError extends Error {
  override name = "LinkRefusedError";
}

export interface LinkMove {
  table: string;
  column: string;
  /** Rows now naming the kept ref. */
  moved: number;
  /** Twin rows folded into the kept row, then removed. */
  folded: number;
}

export interface LinkResult {
  platform: string;
  /** The ref both spellings are now; the one `preferRef` chose. */
  kept: string;
  /** The ref that went; null when both spellings already named one object. */
  dropped: string | null;
  moves: LinkMove[];
}

interface Ground {
  ref: string;
  /** Kinds this spelling may be: the stored one when the object exists. */
  kinds: ObjectKind[];
  exists: boolean;
}

/** What one spelling names on a platform: a stored object, else the refs the rules read from it. */
async function ground(tx: Tx, platform: string, spelling: string): Promise<Ground[]> {
  const s = spelling.trim();
  if (!s) throw new CanonError(`${platform}: empty`);
  const spellings = spellingsOf(s);
  const list = sql.join(
    spellings.map((x) => sql`${x}`),
    sql`, `,
  );
  const [hit] = await tx.execute<{ ref: string; kind: string }>(sql`
    select ref, kind from (
      select ref, kind, 1 pri from platform_objects where platform = ${platform} and ref in (${list})
      union all
      select o.ref, o.kind, 2 pri from platform_object_refs a
        join platform_objects o on o.platform = a.platform and o.ref = a.ref
        where a.platform = ${platform} and a.alias in (${list})
    ) f order by pri limit 1`);
  if (hit) return [{ ref: hit.ref, kinds: [hit.kind as ObjectKind], exists: true }];
  const cands = new Map<string, Ground>();
  const u = fromUrl(s);
  if (u && u.platform === platform)
    cands.set(u.ref, { ref: u.ref, kinds: [u.kind], exists: false });
  let first: unknown;
  for (const kind of OBJECT_KINDS) {
    try {
      const ref = canonRef(platform, kind, s);
      const c = cands.get(ref);
      if (c) {
        if (!c.kinds.includes(kind)) c.kinds.push(kind);
      } else cands.set(ref, { ref, kinds: [kind], exists: false });
    } catch (e) {
      first ??= e;
    }
  }
  if (!cands.size) throw first ?? new CanonError(`${platform}: cannot read ${JSON.stringify(s)}`);
  const stored = await tx.execute<{ ref: string; kind: string }>(sql`
    select ref, kind from platform_objects where platform = ${platform}
      and ref in (${sql.join(
        [...cands.keys()].map((x) => sql`${x}`),
        sql`, `,
      )})`);
  for (const r of stored)
    cands.set(r.ref, { ref: r.ref, kinds: [r.kind as ObjectKind], exists: true });
  return [...cands.values()].sort((a, b) => Number(b.exists) - Number(a.exists));
}

const count = async (q: Promise<Row[]>): Promise<number> =>
  Number(((await q)[0] as Row | undefined)?.n ?? 0);

/** Move a typed draft item (`comment:4`, `onpost:9`) from one row's id to the kept row's. */
async function moveItems(tx: Tx, from: string, to: string): Promise<void> {
  for (const h of ITEM_HOMES) {
    const t = sql.identifier(h.table);
    const c = sql.identifier(h.column);
    if (h.unique) {
      await tx.execute(sql`update ${t} set ${c} = ${to} where ${c} = ${from}
        and not exists (select 1 from ${t} q where q.${c} = ${to})`);
      await tx.execute(sql`delete from ${t} where ${c} = ${from}`);
    } else await tx.execute(sql`update ${t} set ${c} = ${to} where ${c} = ${from}`);
  }
}

/** Move a row's touches to the kept row's: its answers repoint, a free ref moves, the rest go. */
async function moveTouches(tx: Tx, from: string[], to: string[]): Promise<void> {
  for (const [i, f] of from.entries()) {
    const k = to[i] as string;
    await tx.execute(sql`update touches t set answers = kept.id from touches kept, touches gone
      where kept.ref = ${k} and gone.ref = ${f} and t.answers = gone.id`);
    await tx.execute(sql`update touches set ref = ${k} where ref = ${f}
      and not exists (select 1 from touches q where q.ref = ${k})`);
    await tx.execute(sql`delete from touches where ref = ${f}`);
  }
}

/** Both rows of a serial-keyed twin pair, or null when the table lacks one of them. */
async function pair(
  tx: Tx,
  role: ObjectRole,
  platform: string,
  dropped: string,
  kept: string,
): Promise<{ d: number; k: number } | null> {
  const t = sql.identifier(role.table);
  const c = sql.identifier(role.column);
  const [r] = await tx.execute<{ d: number | null; k: number | null }>(sql`
    select (select id from ${t} where ${onPlatform(role, platform)} and ${c} = ${dropped} limit 1) d,
           (select id from ${t} where ${onPlatform(role, platform)} and ${c} = ${kept} limit 1) k`);
  return r?.d != null && r.k != null ? { d: Number(r.d), k: Number(r.k) } : null;
}

/** Fold the dropped comment row into the kept one, as migration 0310 did. */
async function foldComment(tx: Tx, d: number, k: number): Promise<void> {
  await tx.execute(sql`update comments c set state = 'answered', answer = x.answer,
      answer_ref = x.answer_ref, answered_at = x.answered_at
    from comments x where c.id = ${k} and x.id = ${d} and x.state = 'answered' and c.state <> 'answered'`);
  const { item, touches } = ROLE_ITEMS.comment;
  await moveItems(tx, item(d), item(k));
  await moveTouches(tx, touches(d), touches(k));
  // A keyword's DM log is one row per comment: the kept comment keeps the dropped one's.
  await tx.execute(sql`update keyword_hits set comment_id = ${k} where comment_id = ${d}
    and not exists (select 1 from keyword_hits q where q.comment_id = ${k})`);
  await tx.execute(sql`delete from comments where id = ${d}`);
}

/** Fold the dropped reach post into the kept one: its items and touches follow. */
async function foldReach(tx: Tx, d: number, k: number): Promise<void> {
  const { item, touches } = ROLE_ITEMS.reach;
  await moveItems(tx, item(d), item(k));
  await moveTouches(tx, touches(d), touches(k));
  await tx.execute(sql`delete from reach_posts where id = ${d}`);
}

/**
 * Join two spellings of one object. Under one lock per platform and one transaction: the kept
 * object exists, every role row moves from the dropped ref to the kept one (twin rows fold, or the
 * link refuses), the dropped object's aliases point at the kept one, and the dropped ref becomes an
 * alias. Kept is `preferRef`'s pick of the two refs: `a` unless `b` is LinkedIn's API URN. A
 * spelling that already names the same object is a no-op. `by` is the actor on the audit events.
 */
export async function linkRefs(
  db: Queryable,
  platform: string,
  a: string,
  b: string,
  o: { by: string },
): Promise<LinkResult> {
  return atomic(db, async (tx) => {
    await setAuditActor(tx, o.by);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`objects:${platform}`}))`);
    const ga = await ground(tx, platform, a);
    const gb = await ground(tx, platform, b);
    // Two spellings must name one kind of thing; an existing object fixes its spelling's kind.
    let pick: { x: Ground; y: Ground; kind: ObjectKind } | null = null;
    for (const x of ga) {
      for (const y of gb) {
        const kind = x.kinds.find((k) => y.kinds.includes(k));
        if (kind && (!pick || (x.exists && y.exists))) pick = { x, y, kind };
      }
    }
    if (!pick)
      throw new LinkRefusedError(
        `${platform}: ${JSON.stringify(a)} and ${JSON.stringify(b)} name different kinds of object`,
      );
    const { x, y, kind } = pick;
    if (x.ref === y.ref) return { platform, kept: x.ref, dropped: null, moves: [] };
    const kept = preferRef(platform, x.ref, y.ref);
    const dropped = kept === x.ref ? y.ref : x.ref;

    // Refuse before any change: a table that keeps one row per object cannot fold two.
    const roles = OBJECT_ROLES.filter((r) => applies(r, platform));
    for (const r of roles.filter((r) => r.twin === "refuse")) {
      const t = sql.identifier(r.table);
      const c = sql.identifier(r.column);
      const [twin] = await tx.execute<{ d: string; k: string }>(sql`
        select d.id::text d, k.id::text k from ${t} d join ${t} k on true
        where ${onPlatform(r, platform, "d")} and ${onPlatform(r, platform, "k")}
          and d.${c} = ${dropped} and k.${c} = ${kept} limit 1`);
      if (twin)
        throw new LinkRefusedError(
          `${r.table} holds both ${platform} spellings: row ${twin.d} (${dropped}) and row ${twin.k} (${kept}). Nothing changed. Merge the rows first.`,
        );
    }

    // 1. The kept object exists, with the best of both rows.
    const have = new Set(
      (
        await tx.execute<{ ref: string }>(sql`
        select ref from platform_objects where platform = ${platform} and ref in (${dropped}, ${kept})`)
      ).map((r) => r.ref),
    );
    if (have.has(dropped) && have.has(kept))
      await tx.execute(sql`update platform_objects k set
          url = coalesce(k.url, d.url), post = coalesce(k.post, d.post),
          parent = coalesce(k.parent, d.parent), author = coalesce(k.author, d.author),
          "at" = coalesce(k."at", d."at"),
          first_seen = least(k.first_seen, d.first_seen), last_seen = greatest(k.last_seen, d.last_seen)
        from platform_objects d
        where k.platform = ${platform} and k.ref = ${kept} and d.platform = ${platform} and d.ref = ${dropped}`);
    else if (have.has(dropped))
      await tx.execute(sql`insert into platform_objects
          (platform, ref, kind, url, post, parent, author, "at", first_seen, last_seen)
        select platform, ${kept}, kind, url, post, parent, author, "at", first_seen, last_seen
        from platform_objects where platform = ${platform} and ref = ${dropped}`);
    else if (!have.has(kept))
      await tx.execute(sql`insert into platform_objects (platform, ref, kind)
        values (${platform}, ${kept}, ${kind})`);

    // 2. The role rows.
    const moves: LinkMove[] = [];
    for (const r of roles) {
      const t = sql.identifier(r.table);
      const c = sql.identifier(r.column);
      let folded = 0;
      if (r.twin === "comment" || r.twin === "reach") {
        const both = await pair(tx, r, platform, dropped, kept);
        if (both) {
          if (r.twin === "comment") await foldComment(tx, both.d, both.k);
          else await foldReach(tx, both.d, both.k);
          folded = 1;
        }
      } else if (r.twin === "drop") {
        const same = (r.key ?? []).map(
          (col) => sql` and x.${sql.identifier(col)} is not distinct from k.${sql.identifier(col)}`,
        );
        folded = await count(
          tx.execute(sql`with gone as (
              delete from ${t} x using ${t} k
              where ${onPlatform(r, platform, "x")} and ${onPlatform(r, platform, "k")}
                and x.${c} = ${dropped} and k.${c} = ${kept} ${sql.join(same, sql``)}
              returning 1)
            select count(*)::int n from gone`),
        );
      }
      const moved = await count(
        tx.execute(sql`with m as (
            update ${t} set ${c} = ${kept}
            where ${onPlatform(r, platform)} and ${c} = ${dropped} returning 1)
          select count(*)::int n from m`),
      );
      if (moved || folded) moves.push({ table: r.table, column: r.column, moved, folded });
    }

    // 3. The dropped object's aliases, its own ref, and every object that names it.
    await tx.execute(sql`update platform_object_refs set ref = ${kept}
      where platform = ${platform} and ref = ${dropped}`);
    await tx.execute(sql`update platform_objects set post = ${kept}
      where platform = ${platform} and post = ${dropped}`);
    await tx.execute(sql`update platform_objects set parent = ${kept}
      where platform = ${platform} and parent = ${dropped}`);
    await tx.execute(
      sql`delete from platform_objects where platform = ${platform} and ref = ${dropped}`,
    );
    await tx.execute(
      sql`delete from platform_object_refs where platform = ${platform} and alias = ${kept}`,
    );
    await tx.execute(sql`insert into platform_object_refs (platform, alias, ref)
      values (${platform}, ${dropped}, ${kept})
      on conflict (platform, alias) do update set ref = excluded.ref`);
    return { platform, kept, dropped, moves };
  });
}
