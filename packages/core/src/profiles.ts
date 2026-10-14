/**
 * One profile per person (designs/2026-10-14-customerio-audit.md, B1). Every writer that learns
 * an address hands its keys to `resolveProfile`: none known, a new profile; one, the new keys
 * join it; two or more, they were one person all along and merge into the oldest. Tables in
 * `./profiles-schema.ts`; the timeline is a view over the source tables, so nothing here copies
 * what happened, only who it happened to.
 */
import { atomic, type Queryable } from "@wren/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { profileKeys, profileMerges, profiles, profileTraits } from "./profiles-schema.js";
import { normalizeHandle } from "./touches.js";

/** One address as a writer has it, not yet normalized: `{kind: "phone", value: "(555) 010-0000"}`. */
export interface ProfileKey {
  kind: string;
  value: string | number | null | undefined;
}

/** A key as stored: normalized, at most 320 characters. */
export interface Key {
  kind: string;
  value: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164 = /^\+[1-9][0-9]{7,14}$/;
const SLUG = /^[a-z0-9][a-z0-9_-]{0,31}$/;
/** A trait's key: what segments and workflows will name it by. */
export const TRAIT_KEY = /^[a-z][a-z0-9_]{0,63}$/;

/** An email as a key: trimmed, lowercased, one `@`; null when it isn't one. */
export function emailKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw
    .trim()
    .replace(/^mailto:/i, "")
    .toLowerCase();
  return s.length <= 320 && EMAIL.test(s) ? s : null;
}

/**
 * A phone as a key, in E.164. A number without a `+` is read as North American (ten digits, or
 * eleven starting with 1), as every number we text is; anything else is null.
 */
export function phoneKey(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const s = String(raw).trim();
  if (E164.test(s)) return s;
  const digits = s.replace(/\D/g, "");
  if (s.startsWith("+")) return E164.test(`+${digits}`) ? `+${digits}` : null;
  if (digits.length === 10 && /^[2-9]/.test(digits)) return `+1${digits}`;
  if (digits.length === 11 && /^1[2-9]/.test(digits)) return `+${digits}`;
  return null;
}

/** Any key normalized by its kind; null when its value can't be one. */
export function keyOf(k: ProfileKey): Key | null {
  const raw = k.value;
  if (raw === null || raw === undefined || raw === "") return null;
  if (k.kind === "email") {
    const value = emailKey(raw);
    return value ? { kind: "email", value } : null;
  }
  if (k.kind === "phone") {
    const value = phoneKey(raw);
    return value ? { kind: "phone", value } : null;
  }
  const s = String(raw).trim();
  if (k.kind === "person") return /^[1-9][0-9]{0,9}$/.test(s) ? { kind: "person", value: s } : null;
  if (k.kind === "visitor")
    return /^[A-Za-z0-9_.:-]{6,64}$/.test(s) ? { kind: "visitor", value: s } : null;
  if (k.kind.startsWith("handle:")) {
    const platform = k.kind.slice(7);
    const ref = normalizeHandle(platform, s);
    return ref && ref.handle.length <= 320 ? { kind: k.kind, value: ref.handle } : null;
  }
  if (k.kind.startsWith("crm:") && SLUG.test(k.kind.slice(4)))
    return s && s.length <= 320 ? { kind: k.kind, value: s } : null;
  return null;
}

/** The keys that are keys, normalized, each once. */
export function keysOf(keys: readonly ProfileKey[]): Key[] {
  const seen = new Map<string, Key>();
  for (const k of keys) {
    const key = keyOf(k);
    if (key) seen.set(`${key.kind}\u0000${key.value}`, key);
  }
  return [...seen.values()];
}

export interface ResolveOptions {
  /** A name the source gave; fills an empty one, never overwrites. */
  name?: string | null | undefined;
  /** When the source saw them (its row's time); now when left out. */
  at?: Date | undefined;
  /** Traits the source knows, each key a `TRAIT_KEY`; a newer value wins. */
  traits?: Record<string, unknown> | undefined;
}

export interface Resolved {
  id: number;
  created: boolean;
  /** Keys new to the profile. */
  added: number;
  /** Profiles merged into it now. */
  merged: number[];
}

const nameOf = (s: string | null | undefined) => {
  const t = s?.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, 200) : null;
};

/**
 * The profile these keys belong to, made or merged as needed, inside one transaction (a savepoint
 * in the caller's). Each key is locked by its value first, in one order, so two writers holding
 * the same address never make two profiles. Null when no key was a key.
 */
export async function resolveProfile(
  db: Queryable,
  keys: readonly ProfileKey[],
  source: string,
  o: ResolveOptions = {},
): Promise<Resolved | null> {
  const ks = keysOf(keys).sort((a, b) =>
    `${a.kind}:${a.value}` < `${b.kind}:${b.value}` ? -1 : 1,
  );
  if (!ks.length) return null;
  const at = o.at ?? new Date();
  const name = nameOf(o.name);
  return atomic(db, async (tx) => {
    for (const k of ks)
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${k.kind}:${k.value}`}))`);
    const found = await tx
      .select({
        kind: profileKeys.kind,
        value: profileKeys.value,
        id: profileKeys.profileId,
        firstSeen: profiles.firstSeen,
        mergedInto: profiles.mergedInto,
      })
      .from(profileKeys)
      .innerJoin(profiles, eq(profiles.id, profileKeys.profileId))
      .where(
        sql`(${profileKeys.kind}, ${profileKeys.value}) in (${sql.join(
          ks.map((k) => sql`(${k.kind}, ${k.value})`),
          sql`, `,
        )})`,
      );
    // Keys move on a merge, so each points at a live profile; a stray one is followed anyway.
    const live = new Map<number, { firstSeen: Date; by: string }>();
    for (const f of found) {
      const id = f.mergedInto === null ? f.id : await liveOf(tx, f.mergedInto);
      const seen = f.mergedInto === null ? f.firstSeen : await firstSeenOf(tx, id);
      if (!live.has(id)) live.set(id, { firstSeen: seen, by: `${f.kind}:${f.value}` });
    }
    const order = [...live.entries()].sort(
      ([a, x], [b, y]) => x.firstSeen.getTime() - y.firstSeen.getTime() || a - b,
    );
    let id: number;
    let created = false;
    if (order.length === 0) {
      const [made] = await tx
        .insert(profiles)
        .values({ name, firstSeen: at, lastSeen: at })
        .returning({ id: profiles.id });
      id = (made as { id: number }).id;
      created = true;
    } else id = (order[0] as [number, unknown])[0];
    const merged: number[] = [];
    for (const [from, f] of order.slice(1)) {
      await mergeProfiles(tx, id, from, f.by, source, at);
      merged.push(from);
    }
    const had = new Set(found.map((f) => `${f.kind}\u0000${f.value}`));
    const fresh = ks.filter((k) => !had.has(`${k.kind}\u0000${k.value}`));
    if (fresh.length)
      await tx
        .insert(profileKeys)
        .values(fresh.map((k) => ({ profileId: id, ...k, source, firstSeen: at })))
        .onConflictDoNothing();
    if (!created)
      await tx
        .update(profiles)
        .set({
          name: sql`coalesce(${profiles.name}, ${name})`,
          firstSeen: sql`least(${profiles.firstSeen}, ${at.toISOString()}::timestamptz)`,
          lastSeen: sql`greatest(${profiles.lastSeen}, ${at.toISOString()}::timestamptz)`,
        })
        .where(eq(profiles.id, id));
    if (o.traits) await setTraits(tx, id, o.traits, source, at);
    return { id, created, added: fresh.length, merged };
  });
}

async function liveOf(db: Queryable, id: number): Promise<number> {
  for (let at = id, hops = 0; hops < 50; hops++) {
    const [p] = await db
      .select({ into: profiles.mergedInto })
      .from(profiles)
      .where(eq(profiles.id, at));
    if (!p || p.into === null) return at;
    at = p.into;
  }
  throw new Error(`profile ${id}: merged_into loops`);
}

async function firstSeenOf(db: Queryable, id: number): Promise<Date> {
  const [p] = await db.select({ at: profiles.firstSeen }).from(profiles).where(eq(profiles.id, id));
  return p?.at ?? new Date();
}

/**
 * `from` turned out to be `into`: its keys move, each trait it holds newer than `into`'s is
 * taken (kept as a trait change), and it points at `into`, as do the profiles merged into it
 * before. Nothing is deleted: `from` keeps its row and its traits as they were.
 */
export async function mergeProfiles(
  db: Queryable,
  into: number,
  from: number,
  by: string,
  source: string,
  at = new Date(),
): Promise<{ keys: number; traits: number }> {
  const moved = await db
    .update(profileKeys)
    .set({ profileId: into })
    .where(eq(profileKeys.profileId, from))
    .returning({ id: profileKeys.id });
  const theirs = await db.select().from(profileTraits).where(eq(profileTraits.profileId, from));
  let traits = 0;
  for (const t of theirs) if (await putTrait(db, into, t.key, t.value, t.source, t.at)) traits += 1;
  await db
    .update(profiles)
    .set({ mergedInto: into })
    .where(sql`${profiles.id} = ${from} or ${profiles.mergedInto} = ${from}`);
  const [f] = await db.select().from(profiles).where(eq(profiles.id, from));
  if (f)
    await db
      .update(profiles)
      .set({
        name: sql`coalesce(${profiles.name}, ${f.name})`,
        firstSeen: sql`least(${profiles.firstSeen}, ${f.firstSeen.toISOString()}::timestamptz)`,
        lastSeen: sql`greatest(${profiles.lastSeen}, ${f.lastSeen.toISOString()}::timestamptz)`,
      })
      .where(eq(profiles.id, into));
  await db.insert(profileMerges).values({
    intoId: into,
    fromId: from,
    by: by.slice(0, 400),
    keys: moved.length,
    traits,
    source,
    at,
  });
  return { keys: moved.length, traits };
}

/**
 * One trait set when it changed and isn't older than what's held; the change is kept in
 * `profile_trait_events`. True when it was written.
 */
async function putTrait(
  db: Queryable,
  profileId: number,
  key: string,
  value: unknown,
  source: string,
  at: Date,
): Promise<boolean> {
  const v = JSON.stringify(value);
  const rows = await db.execute<{ wrote: boolean }>(sql`
    -- The statement's snapshot, before \`up\`: a row lock here would skip the row \`up\` changes.
    with old as (select value from profile_traits where profile_id = ${profileId} and key = ${key}),
    up as (
      insert into profile_traits (profile_id, key, value, source, at)
      values (${profileId}, ${key}, ${v}::jsonb, ${source}, ${at.toISOString()}::timestamptz)
      on conflict (profile_id, key) do update
        set value = excluded.value, source = excluded.source, at = excluded.at
        where profile_traits.value is distinct from excluded.value
          and profile_traits.at <= excluded.at
      returning 1),
    ev as (
      insert into profile_trait_events (profile_id, key, old, new, source, at)
      select ${profileId}, ${key}, (select value from old), ${v}::jsonb, ${source}, ${at.toISOString()}::timestamptz
      where exists (select 1 from up)
      returning 1)
    select exists (select 1 from ev) wrote`);
  return Boolean(rows[0]?.wrote);
}

/** A trait's value as kept: a trimmed string, a finite number, a boolean, or null to skip. */
function traitValue(v: unknown): string | number | boolean | null {
  if (typeof v === "string") {
    const s = v.trim();
    return s ? s.slice(0, 2000) : null;
  }
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v;
  return null;
}

/** Traits set on one profile; keys that aren't `TRAIT_KEY`s and empty values are skipped. */
export async function setTraits(
  db: Queryable,
  profileId: number,
  traits: Record<string, unknown>,
  source: string,
  at = new Date(),
): Promise<number> {
  let n = 0;
  for (const [key, raw] of Object.entries(traits)) {
    const value = traitValue(raw);
    if (!TRAIT_KEY.test(key) || value === null) continue;
    if (await putTrait(db, profileId, key, value, source, at)) n += 1;
  }
  return n;
}

/**
 * `resolveProfile` from a writer: a profile is what we know about who, never a reason the
 * source's own write fails. Its error is logged and the backfill (`wren people backfill`) mends
 * the gap. Inside the caller's transaction it runs in a savepoint, so a failure leaves that whole.
 */
export async function noteProfile(
  db: Queryable,
  keys: readonly ProfileKey[],
  source: string,
  o: ResolveOptions = {},
): Promise<Resolved | null> {
  try {
    return await resolveProfile(db, keys, source, o);
  } catch (err) {
    console.error(`profile (${source}): ${(err as Error).message}`);
    return null;
  }
}

/** The live profile an address is, if any. */
export async function profileOf(db: Queryable, key: ProfileKey): Promise<number | null> {
  const k = keyOf(key);
  if (!k) return null;
  const [row] = await db
    .select({ id: profileKeys.profileId })
    .from(profileKeys)
    .where(and(eq(profileKeys.kind, k.kind), eq(profileKeys.value, k.value)));
  return row?.id ?? null;
}

/** The keys a profile goes by, oldest first. */
export async function keysOfProfile(db: Queryable, ids: readonly number[]) {
  if (!ids.length) return [];
  return db
    .select()
    .from(profileKeys)
    .where(inArray(profileKeys.profileId, [...ids]))
    .orderBy(profileKeys.id);
}

/** Every key a form or hook's fields name: email, phone, and the site's visitor cookie. */
export function keysOfFields(
  fields: Record<string, unknown> | null | undefined,
  visitor?: string | null,
): ProfileKey[] {
  const f = fields ?? {};
  return [
    { kind: "email", value: f.email as string | undefined },
    { kind: "phone", value: (f.phone ?? f.phone_number ?? f.mobile) as string | undefined },
    { kind: "visitor", value: visitor },
  ];
}

/** A form's name, by its fields: `name`, else first and last. */
export function nameOfFields(fields: Record<string, unknown> | null | undefined): string | null {
  const f = fields ?? {};
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return s(f.name) || [s(f.first_name), s(f.last_name)].filter(Boolean).join(" ") || null;
}
