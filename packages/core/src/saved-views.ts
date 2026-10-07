/**
 * What a viewer keeps of the portal (designs/2026-10-06-library-and-views.md): saved views, a
 * list's filters, search, sort and columns under a name, the viewer's own or shared with the
 * workspace; and prefs, what he arranged, by key. A workspace is a client's id, or "wren".
 * Callers check who may share; these only scope by workspace and viewer.
 */
import type { Queryable } from "@wren/db";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { PortalRefusal } from "./portal.js";
import { savedViews, viewerPrefs } from "./schema.js";

export interface SavedViewLine {
  id: number;
  name: string;
  /** The list's address as a query string: `state=open&sort=-at`. */
  params: string;
  shared: boolean;
  /** The viewer made it: he may rename, move and delete it. */
  mine: boolean;
}

export interface Scope {
  workspace: string;
  viewer: string;
}

/** A list's address worth keeping: no paging, no open record, at most 2,000 characters. */
const NAME_MAX = 60;
const PARAMS_MAX = 2000;

const line = (r: typeof savedViews.$inferSelect, viewer: string): SavedViewLine => ({
  id: r.id,
  name: r.name,
  params: r.params,
  shared: r.shared,
  mine: r.viewer === viewer,
});

/** The viewer's own views of a record and the shared ones, in tab order. */
export async function savedViewsOf(
  db: Queryable,
  { workspace, viewer }: Scope,
  record: string,
): Promise<SavedViewLine[]> {
  const rows = await db
    .select()
    .from(savedViews)
    .where(
      and(
        eq(savedViews.workspace, workspace),
        eq(savedViews.record, record),
        or(eq(savedViews.viewer, viewer), eq(savedViews.shared, true)),
      ),
    )
    .orderBy(asc(savedViews.position), asc(savedViews.id));
  // His own order of the tabs when he moved them (`views:<record>`); new ones go last.
  const order = (await prefsOf(db, { workspace, viewer }, [orderKey(record)]))[orderKey(record)];
  const at = new Map(Array.isArray(order) ? order.map((id, i) => [id, i]) : []);
  const place = (id: number) => at.get(id) ?? Number.MAX_SAFE_INTEGER;
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => place(a.r.id) - place(b.r.id) || a.i - b.i)
    .map(({ r }) => line(r, viewer));
}
const orderKey = (record: string) => `views:${record}`;

const cleanName = (name: unknown) => {
  const n = typeof name === "string" ? name.trim() : "";
  if (!n) throw new PortalRefusal("name it", 400);
  if (n.length > NAME_MAX) throw new PortalRefusal(`a name fits ${NAME_MAX} characters`, 400);
  return n;
};
const cleanParams = (params: unknown) => {
  if (typeof params !== "string") throw new PortalRefusal("say what it keeps", 400);
  if (params.length > PARAMS_MAX) throw new PortalRefusal("that view keeps too much", 400);
  const kept = new URLSearchParams(params);
  for (const k of ["after", "sv", "tab"]) kept.delete(k);
  return kept.toString();
};

/** One the viewer may change: his own, or a shared one when he may share. */
async function changeable(db: Queryable, s: Scope, id: number, share: boolean) {
  const [row] = await db
    .select()
    .from(savedViews)
    .where(and(eq(savedViews.id, id), eq(savedViews.workspace, s.workspace)));
  if (!row || (row.viewer !== s.viewer && !row.shared))
    throw new PortalRefusal("no such view", 404);
  if (row.viewer !== s.viewer && !share)
    throw new PortalRefusal("changing a shared view needs manage", 403);
  return row;
}

export interface SaveView {
  /** Set: change that view. Left out: a new one, last in order. */
  id?: number | undefined;
  record: string;
  name?: string | undefined;
  params?: string | undefined;
  shared?: boolean | undefined;
}

/** Make or change a view. `share`: the viewer may share in this workspace. */
export async function saveView(
  db: Queryable,
  s: Scope,
  v: SaveView,
  share: boolean,
): Promise<SavedViewLine> {
  if (v.shared && !share) throw new PortalRefusal("sharing a view needs manage", 403);
  if (v.id !== undefined) {
    const row = await changeable(db, s, v.id, share);
    if (v.shared === false && row.shared && !share)
      throw new PortalRefusal("unsharing a view needs manage", 403);
    const [out] = await db
      .update(savedViews)
      .set({
        ...(v.name !== undefined ? { name: cleanName(v.name) } : {}),
        ...(v.params !== undefined ? { params: cleanParams(v.params) } : {}),
        ...(v.shared !== undefined ? { shared: v.shared } : {}),
        updatedAt: new Date(),
      })
      .where(eq(savedViews.id, row.id))
      .returning();
    return line(out as typeof row, s.viewer);
  }
  if (!v.record || v.record.length > 64) throw new PortalRefusal("say which list", 400);
  const [last] = await db
    .select({ n: sql<number>`coalesce(max(${savedViews.position}), -1)::int` })
    .from(savedViews)
    .where(and(eq(savedViews.workspace, s.workspace), eq(savedViews.record, v.record)));
  const [out] = await db
    .insert(savedViews)
    .values({
      workspace: s.workspace,
      viewer: s.viewer,
      record: v.record,
      name: cleanName(v.name),
      params: cleanParams(v.params ?? ""),
      shared: v.shared ?? false,
      position: (last?.n ?? -1) + 1,
    })
    .returning();
  if (!out) throw new Error("saved view not written");
  return line(out, s.viewer);
}

export async function removeView(db: Queryable, s: Scope, id: number, share: boolean) {
  const row = await changeable(db, s, id, share);
  await db.delete(savedViews).where(eq(savedViews.id, row.id));
}

/** Put a record's tabs in this order, for him alone: shared ones move only on his screen. */
export async function moveViews(
  db: Queryable,
  s: Scope,
  record: string,
  ids: number[],
): Promise<SavedViewLine[]> {
  const shown = new Set((await savedViewsOf(db, s, record)).map((v) => v.id));
  await setPref(
    db,
    s,
    orderKey(record),
    ids.filter((id) => shown.has(id)),
  );
  return savedViewsOf(db, s, record);
}

/** A viewer's prefs by key; only `keys` when given. */
export async function prefsOf(
  db: Queryable,
  { workspace, viewer }: Scope,
  keys?: string[],
): Promise<Record<string, unknown>> {
  const rows = await db
    .select({ key: viewerPrefs.key, value: viewerPrefs.value })
    .from(viewerPrefs)
    .where(
      and(
        eq(viewerPrefs.workspace, workspace),
        eq(viewerPrefs.viewer, viewer),
        keys?.length ? inArray(viewerPrefs.key, keys) : undefined,
      ),
    );
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

const PREF_KEY = /^[a-z][\w.:-]{0,99}$/i;
const PREF_MAX = 20_000;

/** Keep one pref, or reset it to the default with null. */
export async function setPref(db: Queryable, s: Scope, key: string, value: unknown) {
  if (!PREF_KEY.test(key)) throw new PortalRefusal("no such setting", 400);
  const where = and(
    eq(viewerPrefs.workspace, s.workspace),
    eq(viewerPrefs.viewer, s.viewer),
    eq(viewerPrefs.key, key),
  );
  if (value === null || value === undefined) {
    await db.delete(viewerPrefs).where(where);
    return;
  }
  if (JSON.stringify(value).length > PREF_MAX)
    throw new PortalRefusal("that's too much to keep", 400);
  await db
    .insert(viewerPrefs)
    .values({ ...s, key, value })
    .onConflictDoUpdate({
      target: [viewerPrefs.workspace, viewerPrefs.viewer, viewerPrefs.key],
      set: { value, updatedAt: new Date() },
    });
}
