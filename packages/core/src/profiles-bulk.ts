/**
 * The profile backfill (`./profiles-backfill.ts`) a chunk of rows at a time: `wren people backfill
 * --bulk`. The per-row path costs ten round trips a row, so a remote database gives it about two
 * rows a second; this one runs three statements per chunk of a few hundred rows (lock, read,
 * write), the same as one hundred times faster against a database a network away.
 *
 * It gives the result the per-row path gives. Rows are decided in row order, in memory, on what the
 * chunk's keys found in the database: no key known makes a profile, one profile's keys join it,
 * traits follow `putTrait`'s rules (set when new, changed and not older than what is held; each
 * change an event). All of it lands in one statement. A row whose keys name two profiles is a
 * merge, and a merge changes what the rows after it see, so every row of its connected rows (the
 * ones sharing a key or a profile with it) goes through `resolveProfile` one by one, as before.
 * The same holds for a key whose profile was merged away and a time that isn't one.
 *
 * Safe beside the per-row run and live writers: a chunk locks each of its keys by value,
 * `hashtext('kind:value')`, in `resolveProfile`'s order (so no deadlock), before it reads. It holds
 * those locks until it commits, and advisory locks sit in the database's lock table (60 sessions
 * of 64 on prod), so a chunk holds at most `lockBudget` distinct keys, not a whole batch's.
 * Idempotent: a second run finds every key, so it inserts and updates nothing.
 */
import { atomic, type Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import {
  type Key,
  keysOf,
  nameOf,
  type ProfileKey,
  type ResolveOptions,
  resolveProfile,
  TRAIT_KEY,
  traitValue,
} from "./profiles.js";
import { type BackfillCount, SOURCES, type Source } from "./profiles-backfill.js";

export interface BulkCount extends BackfillCount {
  /** Chunks run: each is one transaction of three statements, however many rows. */
  chunks: number;
  /** Rows that went through `resolveProfile` one by one: merges and what touches them. */
  perRow: number;
}

type Value = string | number | boolean;

/** A source row, ready: its keys normalized and sorted as `resolveProfile` locks them. */
interface Prep {
  cursor: string;
  ks: Key[];
  name: string | null;
  at: Date;
  traits: [string, Value][];
  /** What `resolveProfile` takes, for the rows that go one by one. */
  keys: ProfileKey[];
  rest: ResolveOptions;
}

const LOCK_BUDGET = 600;
const BATCH = 5000;

/** The order `resolveProfile` locks in (its `ks.sort`). Keep the two the same. */
const lockName = (k: Key) => `${k.kind}:${k.value}`;
const byLock = (a: Key, b: Key) => (lockName(a) < lockName(b) ? -1 : 1);
const keyId = (k: Key) => `${k.kind}\u0000${k.value}`;

function prepare(r: Record<string, unknown>, s: Source, now: Date): Prep | null {
  const { keys, ...rest } = s.input(r);
  const ks = keysOf(keys).sort(byLock);
  if (!ks.length) return null;
  const traits: [string, Value][] = [];
  for (const [key, raw] of Object.entries(rest.traits ?? {})) {
    const v = traitValue(raw);
    if (TRAIT_KEY.test(key) && v !== null) traits.push([key, v]);
  }
  return {
    cursor: String(r.cursor),
    ks,
    name: nameOf(rest.name),
    at: rest.at ?? now,
    traits,
    keys,
    rest,
  };
}

/** Rows in order, cut where a chunk would hold more than `budget` distinct keys. */
function chunksOf(rows: Prep[], budget: number): Prep[][] {
  const out: Prep[][] = [];
  let cur: Prep[] = [];
  let seen = new Set<string>();
  for (const r of rows) {
    const fresh = r.ks.filter((k) => !seen.has(keyId(k))).length;
    if (cur.length && seen.size + fresh > budget) {
      out.push(cur);
      cur = [];
      seen = new Set();
    }
    cur.push(r);
    for (const k of r.ks) seen.add(keyId(k));
  }
  if (cur.length) out.push(cur);
  return out;
}

/** What a chunk's keys and traits already are in the database. */
interface Held {
  /**
   * Key id to its profile. `stray` when that profile was merged away (its keys should have moved),
   * and `live` is then where `merged_into` ends, the profile `resolveProfile` would use.
   */
  keys: Map<string, { pid: number; live: number; stray: boolean }>;
  /** `pid\0key` to the held trait: its value, and its time in microseconds, as the database has it. */
  traits: Map<string, { value: unknown; us: bigint }>;
}

const parsed = <T>(v: unknown): T => (typeof v === "string" ? JSON.parse(v) : v) as T;

async function lock(tx: Queryable, rows: Prep[]): Promise<void> {
  const seen = new Map<string, Key>();
  for (const r of rows) for (const k of r.ks) seen.set(lockName(k), k);
  const names = [...seen.values()].sort(byLock).map(lockName);
  await tx.execute(sql`
    select pg_advisory_xact_lock(hashtext(s.k))
    from (select k, n from jsonb_array_elements_text(${JSON.stringify(names)}::jsonb) with ordinality t(k, n) order by n) s`);
}

async function read(tx: Queryable, rows: Prep[]): Promise<Held> {
  const keys = new Map<string, Key>();
  const traitKeys = new Set<string>();
  for (const r of rows) {
    for (const k of r.ks) keys.set(keyId(k), k);
    for (const [t] of r.traits) traitKeys.add(t);
  }
  const [got] = await tx.execute<{ keys: unknown; traits: unknown }>(sql`
    with recursive q as (select * from jsonb_to_recordset(${JSON.stringify([...keys.values()])}::jsonb) as x(kind text, value text)),
    f as (
      select k.kind, k.value, k.profile_id pid, p.merged_into m
      from q join profile_keys k on k.kind = q.kind and k.value = q.value
      join profiles p on p.id = k.profile_id),
    walk(root, cur, nxt, hops) as (
      select distinct pid, m, (select merged_into from profiles where id = m), 1 from f where m is not null
      union all
      select w.root, w.nxt, (select merged_into from profiles where id = w.nxt), w.hops + 1
      from walk w where w.nxt is not null and w.hops < 50)
    select
      (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'value', value, 'pid', pid, 'm', m,
          'live', coalesce((select cur from walk where root = f.pid and nxt is null limit 1), pid))), '[]'::jsonb) from f) keys,
      (select coalesce(jsonb_agg(jsonb_build_object('pid', t.profile_id, 'key', t.key, 'value', t.value,
          'us', (extract(epoch from t.at) * 1000000)::bigint::text)), '[]'::jsonb)
       from profile_traits t
       where t.profile_id in (select pid from f where m is null)
         and t.key in (select jsonb_array_elements_text(${JSON.stringify([...traitKeys])}::jsonb))) traits`);
  const held: Held = { keys: new Map(), traits: new Map() };
  for (const f of parsed<
    { kind: string; value: string; pid: number; m: number | null; live: number }[]
  >(got?.keys) ?? [])
    held.keys.set(keyId(f), { pid: f.pid, live: f.live, stray: f.m !== null });
  for (const t of parsed<{ pid: number; key: string; value: unknown; us: string }[]>(got?.traits) ??
    [])
    held.traits.set(`${t.pid}\u0000${t.key}`, { value: t.value, us: BigInt(t.us) });
  return held;
}

/** The rows that share a key or a profile, found with union-find. Roots are row indexes' classes. */
function components(rows: Prep[], held: Held): { root: number[]; forced: Set<number> } {
  const ids = new Map<string, number>();
  const parent: number[] = [];
  const node = (name: string) => {
    let n = ids.get(name);
    if (n === undefined) {
      n = parent.length;
      ids.set(name, n);
      parent.push(n);
    }
    return n;
  };
  const find = (n: number): number => {
    let r = n;
    while (parent[r] !== r) r = parent[r] as number;
    for (let c = n; parent[c] !== r; ) {
      const next = parent[c] as number;
      parent[c] = r;
      c = next;
    }
    return r;
  };
  const nodeOf = (k: Key) => {
    const h = held.keys.get(keyId(k));
    return node(h ? `p${h.live}` : `k${keyId(k)}`);
  };
  for (const r of rows) {
    const first = nodeOf(r.ks[0] as Key);
    for (const k of r.ks) parent[find(nodeOf(k))] = find(first);
  }
  const root = rows.map((r) => find(nodeOf(r.ks[0] as Key)));
  const forced = new Set<number>();
  rows.forEach((r, i) => {
    const stray = r.ks.some((k) => held.keys.get(keyId(k))?.stray);
    if (stray || Number.isNaN(r.at.getTime())) forced.add(root[i] as number);
  });
  return { root, forced };
}

/** One profile as the chunk decides it: a new one (handle below 0) or a held one. */
interface Group {
  h: number;
  name: string | null;
  first: number;
  last: number;
}
interface TraitState {
  h: number;
  key: string;
  value: unknown;
  us: bigint;
  at: Date;
  dirty: boolean;
}
interface Sim {
  made: Group[];
  touched: Group[];
  keys: { h: number; k: Key; at: Date }[];
  traits: TraitState[];
  events: { h: number; key: string; old: unknown; hasOld: boolean; value: Value; at: Date }[];
  /** Components where a row named two profiles. */
  merges: Set<number>;
}

/** Rows in order, as `resolveProfile` would do them, when none is a merge. */
function simulate(items: { p: Prep; root: number }[], held: Held): Sim {
  const group = new Map<string, number>();
  for (const [k, h] of held.keys) if (!h.stray) group.set(k, h.pid);
  const groups = new Map<number, Group>();
  const state = new Map<string, TraitState>();
  const sim: Sim = { made: [], touched: [], keys: [], traits: [], events: [], merges: new Set() };
  for (const { p, root } of items) {
    const named = new Set<number>();
    for (const k of p.ks) {
      const h = group.get(keyId(k));
      if (h !== undefined) named.add(h);
    }
    if (named.size > 1) {
      sim.merges.add(root);
      continue;
    }
    const at = p.at.getTime();
    let h = named.values().next().value as number | undefined;
    if (h === undefined) {
      h = -(sim.made.length + 1);
      const g = { h, name: p.name, first: at, last: at };
      groups.set(h, g);
      sim.made.push(g);
    } else {
      const g = groups.get(h);
      if (g) {
        g.name ??= p.name;
        g.first = Math.min(g.first, at);
        g.last = Math.max(g.last, at);
      } else {
        const t = { h, name: p.name, first: at, last: at };
        groups.set(h, t);
        sim.touched.push(t);
      }
    }
    for (const k of p.ks)
      if (!group.has(keyId(k))) {
        group.set(keyId(k), h);
        sim.keys.push({ h, k, at: p.at });
      }
    const us = BigInt(at) * 1000n;
    for (const [key, value] of p.traits) {
      const id = `${h}\u0000${key}`;
      let cur = state.get(id);
      if (!cur) {
        const held0 = h > 0 ? held.traits.get(id) : undefined;
        if (held0) cur = { h, key, value: held0.value, us: held0.us, at: p.at, dirty: false };
      }
      if (!cur) {
        cur = { h, key, value, us, at: p.at, dirty: true };
        sim.events.push({ h, key, old: null, hasOld: false, value, at: p.at });
      } else if (cur.value !== value && cur.us <= us) {
        sim.events.push({ h, key, old: cur.value, hasOld: true, value, at: p.at });
        Object.assign(cur, { value, us, at: p.at, dirty: true });
      }
      state.set(id, cur);
    }
  }
  sim.traits = [...state.values()].filter((t) => t.dirty);
  return sim;
}

const iso = (d: Date | number) => new Date(d).toISOString();
/** A group's handle as the write statement has it: a held profile's id, or a new one's ordinal. */
const ref = (h: number) => (h > 0 ? { pid: h, vord: null } : { pid: null, vord: -h - 1 });

/** Writes what the rows decided, one statement; what it made is then held, for the rows after. */
async function write(tx: Queryable, source: string, sim: Sim, held: Held): Promise<void> {
  const made = sim.made.map((g, ord) => ({
    ord,
    name: g.name,
    first_seen: iso(g.first),
    last_seen: iso(g.last),
  }));
  const keys = sim.keys.map((x, n) => ({
    n,
    ...ref(x.h),
    kind: x.k.kind,
    value: x.k.value,
    source,
    at: iso(x.at),
  }));
  const touched = sim.touched.map((g) => ({
    id: g.h,
    name: g.name,
    first_seen: iso(g.first),
    last_seen: iso(g.last),
  }));
  const traits = sim.traits.map((t) => ({
    ...ref(t.h),
    key: t.key,
    value: JSON.stringify(t.value),
    source,
    at: iso(t.at),
  }));
  const events = sim.events.map((e, n) => ({
    n,
    ...ref(e.h),
    key: e.key,
    old: e.hasOld ? JSON.stringify(e.old) : null,
    new: JSON.stringify(e.value),
    source,
    at: iso(e.at),
  }));
  if (!made.length && !keys.length && !touched.length && !traits.length) return;
  const j = (v: unknown) => JSON.stringify(v);
  const [got] = await tx.execute<{ ids: unknown; keys: number }>(sql`
    with np as (
      select v.ord, nextval(pg_get_serial_sequence('profiles', 'id')::regclass) id, v.name, v.first_seen, v.last_seen
      from (select * from jsonb_to_recordset(${j(made)}::jsonb)
        as x(ord int, name text, first_seen timestamptz, last_seen timestamptz) order by ord) v),
    ip as (
      insert into profiles (id, name, first_seen, last_seen)
      select id, name, first_seen, last_seen from np returning 1),
    ik as (
      insert into profile_keys (profile_id, kind, value, source, first_seen)
      select coalesce(k.pid, np.id), k.kind, k.value, k.source, k.at
      from jsonb_to_recordset(${j(keys)}::jsonb)
        as k(n int, pid int, vord int, kind text, value text, source text, at timestamptz)
      left join np on np.ord = k.vord
      order by k.n
      on conflict (kind, value) do nothing
      returning 1),
    up as (
      update profiles p
      set name = coalesce(p.name, u.name),
        first_seen = least(p.first_seen, u.first_seen),
        last_seen = greatest(p.last_seen, u.last_seen)
      from jsonb_to_recordset(${j(touched)}::jsonb)
        as u(id int, name text, first_seen timestamptz, last_seen timestamptz)
      where p.id = u.id
        and ((p.name is null and u.name is not null) or u.first_seen < p.first_seen or u.last_seen > p.last_seen)
      returning 1),
    it as (
      insert into profile_traits (profile_id, key, value, source, at)
      select coalesce(t.pid, np.id), t.key, t.value::jsonb, t.source, t.at
      from jsonb_to_recordset(${j(traits)}::jsonb)
        as t(pid int, vord int, key text, value text, source text, at timestamptz)
      left join np on np.ord = t.vord
      on conflict (profile_id, key) do update
        set value = excluded.value, source = excluded.source, at = excluded.at
        where profile_traits.at <= excluded.at
      returning 1),
    ie as (
      insert into profile_trait_events (profile_id, key, old, new, source, at)
      select coalesce(e.pid, np.id), e.key, e.old::jsonb, e.new::jsonb, e.source, e.at
      from jsonb_to_recordset(${j(events)}::jsonb)
        as e(n int, pid int, vord int, key text, old text, new text, source text, at timestamptz)
      left join np on np.ord = e.vord
      order by e.n
      returning 1)
    select (select coalesce(jsonb_agg(id order by ord), '[]'::jsonb) from np) ids,
      (select count(*) from ip)::int made, (select count(*) from ik)::int keys`);
  const ids = parsed<number[]>(got?.ids) ?? [];
  // A key someone else took since the read (a writer that skipped the lock): undo, go one by one.
  if (ids.length !== made.length || got?.keys !== keys.length)
    throw new Error(
      `wrote ${ids.length}/${made.length} profiles and ${got?.keys}/${keys.length} keys`,
    );
  const pid = (h: number) => (h > 0 ? h : (ids[-h - 1] as number));
  for (const x of sim.keys)
    held.keys.set(keyId(x.k), { pid: pid(x.h), live: pid(x.h), stray: false });
  for (const t of sim.traits)
    held.traits.set(`${pid(t.h)}\u0000${t.key}`, { value: t.value, us: t.us });
}

type Tally = Pick<BulkCount, "created" | "merged" | "skipped" | "perRow">;

/** A deadlock or serialization failure: the other writer won, the same work will go in again. */
function retryable(err: unknown): boolean {
  const code = (e: unknown) => (e as { code?: unknown } | null | undefined)?.code;
  const c = code((err as { cause?: unknown } | null)?.cause) ?? code(err);
  return c === "40P01" || c === "40001";
}

/** `fn`, again after a short wait while it loses a deadlock to a writer working beside it. */
async function patiently<T>(fn: () => Promise<T>): Promise<T> {
  for (let tries = 1; ; tries++) {
    try {
      return await fn();
    } catch (err) {
      if (tries >= 5 || !retryable(err)) throw err;
      await new Promise((r) => setTimeout(r, 20 * tries + Math.random() * 40));
    }
  }
}

/** `resolveProfile` for rows one at a time, as the per-row backfill does it. */
async function oneByOne(db: Queryable, source: string, rows: Prep[], t: Tally): Promise<void> {
  for (const p of rows) {
    t.perRow += 1;
    try {
      const got = await patiently(() => resolveProfile(db, p.keys, source, p.rest));
      if (!got) t.skipped += 1;
      else {
        if (got.created) t.created += 1;
        t.merged += got.merged.length;
      }
    } catch (err) {
      t.skipped += 1;
      console.error(`backfill ${source} ${p.cursor}: ${(err as Error).message}`);
    }
  }
}

async function runChunk(db: Queryable, source: string, rows: Prep[]): Promise<Tally> {
  return atomic(db, async (tx) => {
    await lock(tx, rows);
    const held = await read(tx, rows);
    const { root, forced } = components(rows, held);
    const items = rows.map((p, i) => ({ p, root: root[i] as number }));
    // Merges first, on what the database holds: those rows and all that touch them go one by one.
    const flagged = new Set(forced);
    const first = simulate(
      items.filter((x) => !flagged.has(x.root)),
      held,
    );
    const whole = !flagged.size && !first.merges.size ? first : null;
    for (const r of first.merges) flagged.add(r);
    // In row order, so ids and ties fall as they do one by one: a run of rows with no merge in
    // one statement, a merge row on its own.
    const t: Tally = { created: 0, merged: 0, skipped: 0, perRow: 0 };
    for (let i = 0; i < items.length; ) {
      const item = items[i] as (typeof items)[number];
      if (flagged.has(item.root)) {
        await oneByOne(tx, source, [item.p], t);
        i += 1;
        continue;
      }
      let j = i;
      while (j < items.length && !flagged.has((items[j] as (typeof items)[number]).root)) j += 1;
      const sim = whole ?? simulate(items.slice(i, j), held);
      await write(tx, source, sim, held);
      t.created += sim.made.length;
      i = j;
    }
    return t;
  });
}

/**
 * Every source's existing rows into profiles, the result of `backfillProfiles` in a few
 * statements per chunk. `batch` rows are read at a time and cut into chunks of at most
 * `lockBudget` distinct keys each. `sources` is for tests. A chunk that fails is redone row by row.
 */
export async function bulkBackfillProfiles(
  db: Queryable,
  o: {
    dryRun?: boolean;
    only?: readonly string[];
    batch?: number;
    lockBudget?: number;
    sources?: readonly Source[];
    progress?: (c: BulkCount) => void;
  } = {},
): Promise<BulkCount[]> {
  const out: BulkCount[] = [];
  const n = o.batch ?? BATCH;
  const budget = o.lockBudget ?? LOCK_BUDGET;
  for (const s of o.sources ?? SOURCES) {
    if (o.only?.length && !o.only.includes(s.name)) continue;
    const c: BulkCount = {
      source: s.name,
      rows: 0,
      created: 0,
      merged: 0,
      skipped: 0,
      chunks: 0,
      perRow: 0,
    };
    for (let after = s.first; ; ) {
      const batch = await s.rows(db, after, n);
      if (!batch.length) break;
      c.rows += batch.length;
      if (!o.dryRun) {
        const now = new Date();
        const rows: Prep[] = [];
        for (const r of batch) {
          const p = prepare(r, s, now);
          if (p) rows.push(p);
          else c.skipped += 1;
        }
        for (const chunk of chunksOf(rows, budget)) {
          c.chunks += 1;
          try {
            const t = await patiently(() => runChunk(db, s.name, chunk));
            for (const k of ["created", "merged", "skipped", "perRow"] as const) c[k] += t[k];
          } catch (err) {
            console.error(
              `bulk ${s.name} ${chunk[0]?.cursor}: ${(err as Error).message}; redoing ${chunk.length} rows one by one`,
            );
            await oneByOne(db, s.name, chunk, c);
          }
        }
      }
      after = String(batch[batch.length - 1]?.cursor);
      o.progress?.(c);
      if (batch.length < n) break;
    }
    out.push(c);
  }
  return out;
}
