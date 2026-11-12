/**
 * An agent chat's changes and their undo (designs/2026-11-11-agent-panel.md, D1). Lines are audit
 * events tagged with the chat (`wren.chat`); undo writes each event's before back, generic over
 * any audited table with a key. The undo's own events carry turn `undo:<event id>`, which marks
 * the line "Undone".
 */
import { type Queryable, serializable, setAuditActor } from "@wren/db";
import { type SQL, sql } from "drizzle-orm";
import { PortalRefusal } from "./portal.js";

/** One line of a chat's Changes list: an `audit_lines` row. */
export interface AgentChangeLine {
  id: string;
  at: string;
  turn: string | null;
  who: string;
  table: string;
  area: string;
  op: "insert" | "update" | "delete" | "truncate";
  row: string | null;
  change: string | null;
  undone: boolean;
  /** Has a key: undo can find its row. */
  keyed: boolean;
  /** Record types its table feeds (`recordsOfTables`): the pages to mark. */
  records?: string[];
}

/** Lines one read returns: a chat's whole run of writes, newest first. */
const LINES_MAX = 500;

export const STALE = "It changed since. Undo the newer change first.";
export const NO_KEY = "Can't undo: this table has no key.";
export const UNDONE = "Undone already.";

const UNDO = "undo:";

/** The person whose chat it is: the CLI's actor `claude-code:<person>`; null for an older chat. */
export async function chatOwner(db: Queryable, chat: string): Promise<string | null> {
  const [r] = (await db.execute(sql`
    SELECT actor FROM audit_events WHERE chat = ${chat} AND actor LIKE 'claude-code:%'
    ORDER BY id LIMIT 1`)) as unknown as { actor: string }[];
  return r ? r.actor.slice("claude-code:".length) : null;
}

/**
 * The chat's lines, newest first. Hidden: the undo's own writes, and `changes` rows (an edit
 * through `editRecord` is one line, its record's).
 */
export async function agentChanges(db: Queryable, chat: string): Promise<AgentChangeLine[]> {
  const rows = (await db.execute(sql`
    SELECT l.id, l.at, l.turn, l.who, l."table", l.area, l.op, l."row", l.change,
      e.row_key IS NOT NULL keyed,
      EXISTS (SELECT 1 FROM audit_events u WHERE u.chat = l.chat AND u.turn = ${UNDO} || l.id) undone
    FROM audit_lines l JOIN audit_events e ON e.id = l.id::bigint
    WHERE l.chat = ${chat} AND l."table" <> 'changes' AND coalesce(l.turn, '') NOT LIKE ${`${UNDO}%`}
    ORDER BY l.id::bigint DESC LIMIT ${LINES_MAX}`)) as unknown as (Omit<AgentChangeLine, "at"> & {
    at: Date | string;
  })[];
  return rows.map((r) => ({ ...r, at: new Date(r.at).toISOString() }));
}

/** Per view list: the schema moves only with a deploy (a new process). */
const FED = new Map<string, Promise<Map<string, string[]>>>();

/**
 * Table → the record types its rows feed, through each type's view and the views under it (the
 * view rules in `pg_depend`). A changed table marks the pages that list those types.
 */
export function recordsOfTables(
  db: Queryable,
  types: readonly { id: string; view?: string | undefined }[],
): Promise<Map<string, string[]>> {
  const views = types.filter((t) => t.view).map((t) => [t.id, t.view as string] as const);
  const key = views.map((v) => v.join("=")).join(",");
  const had = FED.get(key);
  if (had) return had;
  const got = (async () => {
    const rows = (await db.execute(sql`
      WITH RECURSIVE start AS (
        SELECT v.id, to_regclass(v.view) oid
        FROM jsonb_to_recordset(${JSON.stringify(views.map(([id, view]) => ({ id, view })))}::jsonb)
          v(id text, view text)
      ), dep AS (
        SELECT id, oid FROM start WHERE oid IS NOT NULL
        UNION
        SELECT dep.id, d.refobjid
        FROM dep JOIN pg_rewrite r ON r.ev_class = dep.oid
          JOIN pg_depend d ON d.classid = 'pg_rewrite'::regclass AND d.objid = r.oid
            AND d.refclassid = 'pg_class'::regclass AND d.refobjid <> dep.oid
      )
      SELECT DISTINCT dep.id, dep.oid::regclass::text "table"
      FROM dep JOIN pg_class c ON c.oid = dep.oid WHERE c.relkind IN ('r', 'p')`)) as unknown as {
      id: string;
      table: string;
    }[];
    const out = new Map<string, string[]>();
    for (const r of rows) out.set(r.table, [...(out.get(r.table) ?? []), r.id]);
    return out;
  })();
  FED.set(key, got);
  got.catch(() => FED.delete(key));
  return got;
}

interface AuditRow {
  id: string;
  era: number;
  tx: string;
  at: Date;
  chat: string | null;
  table_name: string;
  op: AgentChangeLine["op"];
  row_key: Record<string, unknown> | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
}

/** `books.spend` or bare `leads` (public): each part quoted. */
const tableOf = (name: string): SQL =>
  sql.join(
    name.split(".").map((p) => sql.identifier(p)),
    sql.raw("."),
  );

/** Columns a write may set: no generated ones. */
async function writable(tx: Queryable, table: string): Promise<Set<string>> {
  const rows = (await tx.execute(sql`
    SELECT attname FROM pg_attribute
    WHERE attrelid = to_regclass(${table}) AND attnum > 0 AND NOT attisdropped
      AND attgenerated = ''`)) as unknown as { attname: string }[];
  return new Set(rows.map((r) => r.attname));
}

/** `t.k1 = r.k1 AND …` for the row the key names, typed through the table's own row type. */
const keyMatch = (key: Record<string, unknown>): SQL =>
  sql.join(
    Object.keys(key).map((k) => sql`t.${sql.identifier(k)} = r.${sql.identifier(k)}`),
    sql.raw(" AND "),
  );

/** A later write to the row that still stands: not an undo, and not undone. */
async function laterStanding(tx: Queryable, e: AuditRow): Promise<boolean> {
  const [r] = (await tx.execute(sql`
    SELECT 1 FROM audit_events l
    WHERE l.table_name = ${e.table_name} AND l.at >= ${e.at} AND l.id > ${e.id}
      AND l.row_key = ${JSON.stringify(e.row_key)}::jsonb
      AND coalesce(l.turn, '') NOT LIKE ${`${UNDO}%`}
      AND NOT EXISTS (SELECT 1 FROM audit_events u
        WHERE u.chat IS NOT DISTINCT FROM l.chat AND u.turn = ${UNDO} || l.id::text)
    LIMIT 1`)) as unknown as unknown[];
  return !!r;
}

/** A write the database refused (a key taken, a row still pointed at): the row moved on. */
const moved = (err: unknown): boolean => {
  const code =
    (err as { code?: unknown; cause?: { code?: unknown } })?.code ??
    (err as { cause?: { code?: unknown } })?.cause?.code;
  return typeof code === "string" && /^23/.test(code);
};

/**
 * Undo through the record's own edit path: the `changes` row the event's transaction wrote.
 * Given by the caller that knows the record types; without it, undo writes the row directly.
 */
export type UndoThroughChange = (tx: Queryable, change: number, by: string) => Promise<void>;

/** Put one event's before back, in one serializable transaction. */
export async function undoEvent(
  db: Queryable,
  o: { chat: string; event: string; by: string; viaChange?: UndoThroughChange | undefined },
): Promise<void> {
  if (!/^\d{1,19}$/.test(o.event)) throw new PortalRefusal("say which change", 400);
  await serializable(db, async (tx) => {
    const [e] = (await tx.execute(sql`
      SELECT id::text, era, tx::text, at, chat, table_name, op, row_key, old_values, new_values
      FROM audit_events WHERE id = ${o.event}::bigint AND chat = ${o.chat}`)) as unknown as AuditRow[];
    if (!e) throw new PortalRefusal("no such change in this chat", 404);
    const [done] = (await tx.execute(sql`
      SELECT 1 FROM audit_events WHERE chat = ${o.chat} AND turn = ${UNDO + e.id}
      LIMIT 1`)) as unknown as unknown[];
    if (done) throw new PortalRefusal(UNDONE, 409);
    if (!e.row_key || e.op === "truncate") throw new PortalRefusal(NO_KEY, 409);
    await tx.execute(sql`SELECT set_config('wren.chat', ${o.chat}, true),
      set_config('wren.turn', ${UNDO + e.id}, true)`);
    await setAuditActor(tx, o.by);
    const t = tableOf(e.table_name);
    const key = JSON.stringify(e.row_key);
    const match = keyMatch(e.row_key);
    try {
      if (e.op === "update") {
        const [change] = (await tx.execute(sql`
          SELECT (row_key ->> 'id')::int id FROM audit_events
          WHERE era = ${e.era} AND tx = ${e.tx}::bigint AND table_name = 'changes' AND op = 'insert'
          LIMIT 1`)) as unknown as { id: number }[];
        if (change && o.viaChange) return await o.viaChange(tx, change.id, o.by);
        const after = e.new_values ?? {};
        const [live] = (await tx.execute(sql`
          SELECT array(
            SELECT k FROM jsonb_object_keys(${JSON.stringify(after)}::jsonb) k
            WHERE to_jsonb(want) -> k IS DISTINCT FROM to_jsonb(t) -> k
          ) differ
          FROM ${t} t, jsonb_populate_record(NULL::${t}, ${key}::jsonb) r,
            jsonb_populate_record(NULL::${t}, ${JSON.stringify(after)}::jsonb) want
          WHERE ${match} FOR UPDATE OF t`)) as unknown as { differ: string[] }[];
        if (!live || live.differ.length) throw new PortalRefusal(STALE, 409);
        const cols = [...(await writable(tx, e.table_name))].filter(
          (c) => e.old_values && c in e.old_values,
        );
        if (!cols.length) return;
        const list = sql.join(
          cols.map((c) => sql.identifier(c)),
          sql.raw(", "),
        );
        const from = sql.join(
          cols.map((c) => sql`b.${sql.identifier(c)}`),
          sql.raw(", "),
        );
        await tx.execute(sql`
          UPDATE ${t} t SET (${list}) = (SELECT ${from}
            FROM jsonb_populate_record(NULL::${t}, ${JSON.stringify(e.old_values)}::jsonb) b)
          FROM jsonb_populate_record(NULL::${t}, ${key}::jsonb) r WHERE ${match}`);
      } else if (e.op === "insert") {
        if (await laterStanding(tx, e)) throw new PortalRefusal(STALE, 409);
        await tx.execute(sql`
          DELETE FROM ${t} t USING jsonb_populate_record(NULL::${t}, ${key}::jsonb) r
          WHERE ${match}`);
      } else {
        const before = e.old_values ?? {};
        const cols = [...(await writable(tx, e.table_name))].filter((c) => c in before);
        const list = sql.join(
          cols.map((c) => sql.identifier(c)),
          sql.raw(", "),
        );
        const from = sql.join(
          cols.map((c) => sql`b.${sql.identifier(c)}`),
          sql.raw(", "),
        );
        await tx.execute(sql`
          INSERT INTO ${t} (${list}) OVERRIDING SYSTEM VALUE SELECT ${from}
          FROM jsonb_populate_record(NULL::${t}, ${JSON.stringify(before)}::jsonb) b`);
      }
    } catch (err) {
      if (moved(err)) throw new PortalRefusal(STALE, 409);
      throw err;
    }
  });
}

export interface TurnUndone {
  undone: string[];
  /** The line it stopped at, and why. */
  refused?: { event: string; why: string } | undefined;
}

/** Undo a turn's lines newest first (children before parents); stop at the first refusal. */
export async function undoTurn(
  db: Queryable,
  o: { chat: string; turn: string; by: string; viaChange?: UndoThroughChange | undefined },
): Promise<TurnUndone> {
  if (o.turn.startsWith(UNDO)) throw new PortalRefusal("say which turn", 400);
  const lines = (await agentChanges(db, o.chat)).filter((l) => l.turn === o.turn && !l.undone);
  if (!lines.length) throw new PortalRefusal(UNDONE, 409);
  const undone: string[] = [];
  for (const l of lines) {
    try {
      await undoEvent(db, { chat: o.chat, event: l.id, by: o.by, viaChange: o.viaChange });
      undone.push(l.id);
    } catch (err) {
      if (!(err instanceof PortalRefusal)) throw err;
      return { undone, refused: { event: l.id, why: err.message } };
    }
  }
  return { undone };
}
