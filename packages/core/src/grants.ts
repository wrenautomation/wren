/**
 * Roles and grants on the main database (designs/2026-10-06-scoped-access.md): read a login's
 * grants fresh, hand one out, end one, spend a counted one, keep custom roles. `@wren/core/access`
 * answers from what this reads; nothing here decides.
 */
import type { Queryable } from "@wren/db";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  BUILT_IN_ROLES,
  type Grant,
  isBuiltIn,
  MEMBER_GRANTS,
  PERMISSIONS,
  type Permission,
  type RoleId,
  refusal,
  type Scope,
  type Target,
  TEAM_GRANTS,
  toSpend,
  type Who,
  WREN,
} from "./access.js";
import { normalEmail } from "./clients/index.js";
import { clientMembers, grants, operators, roleGrants, roles } from "./clients/schema.js";
import { PortalRefusal } from "./portal.js";

type Row = {
  id: number | null;
  verbs: string[];
  apps: string[] | null;
  channels: string[] | null;
  record: string | null;
  client: string | null;
  until: Date | string | null;
  uses_left: number | null;
  role: string | null;
  reason: string | null;
};

const iso = (v: Date | string | null): string | null =>
  v === null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString();

const grantOf = (r: Row, client: string | undefined): Grant => {
  const scope: Scope = {};
  const at = r.client ?? client;
  if (at !== undefined && at !== null) scope.client = at;
  if (r.apps) scope.apps = r.apps;
  if (r.channels) scope.channels = r.channels;
  if (r.record) scope.record = r.record;
  return {
    verbs: r.verbs.filter((v): v is Permission => (PERMISSIONS as readonly string[]).includes(v)),
    scope,
    ...(r.id !== null ? { id: r.id } : {}),
    ...(r.role ? { role: r.role } : {}),
    ...(r.until !== null ? { until: iso(r.until) } : {}),
    ...(r.uses_left !== null ? { usesLeft: r.uses_left } : {}),
    ...(r.reason ? { reason: r.reason } : {}),
  };
};

/**
 * A login's live grants, one indexed read: its custom role's rows (none for a built-in) and its
 * extra grants that haven't ended or run out. `client` given: a member's, there only, and the
 * role's rows land on that client. Left out: a team seat's, at every client and `wren`.
 */
export async function grantsFor(
  db: Queryable,
  email: string,
  role: RoleId,
  client?: string,
): Promise<Grant[]> {
  const e = normalEmail(email);
  const rows = await db.execute<Row>(sql`
    select null::int id, rg.verbs, rg.apps, rg.channels, rg.record, null::text client,
      null::timestamptz until, null::int uses_left, rg.role, null::text reason
    from ${roleGrants} rg where rg.role = ${isBuiltIn(role) ? "" : role}
    union all
    select g.id, g.verbs, g.apps, g.channels, g.record, g.client, g.until, g.uses_left,
      null::text, g.reason
    from ${grants} g
    where g.email = ${e} ${client === undefined ? sql`` : sql`and g.client = ${client}`}
      and (g.until is null or g.until > now()) and (g.uses_left is null or g.uses_left > 0)`);
  return rows.map((r) => grantOf(r, client));
}

/**
 * Spend a counted grant for this, in the caller's transaction: when only counted grants say yes,
 * the one ending soonest loses a use, or the call is refused when none is left (a racing use
 * took it). Nothing to spend when the role or an uncounted grant says yes.
 */
export async function spendGrant(
  tx: Queryable,
  who: Who,
  verb: Permission,
  at: Target,
): Promise<number | null> {
  const counted = toSpend(who, verb, at);
  if (counted === null) return null;
  for (const g of counted) {
    const [hit] = await tx
      .update(grants)
      .set({ usesLeft: sql`${grants.usesLeft} - 1` })
      .where(and(eq(grants.id, g.id as number), sql`${grants.usesLeft} > 0`))
      .returning({ id: grants.id });
    if (hit) return hit.id;
  }
  throw new PortalRefusal("that grant is used up", 403);
}

export interface NewGrant {
  email: string;
  client: string;
  verbs: readonly Permission[];
  apps?: readonly string[] | null;
  channels?: readonly string[] | null;
  record?: string | null;
  until?: string | null;
  usesLeft?: number | null;
  reason?: string | null;
}

const listOf = (v: unknown, what: string): string[] | null => {
  if (v === undefined || v === null || v === "") return null;
  const xs = typeof v === "string" ? v.split(",") : v;
  if (!Array.isArray(xs) || !xs.every((x) => typeof x === "string"))
    throw new PortalRefusal(`${what}: a list`, 400);
  const out = [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
  return out.length ? out : null;
};

/** A grant from a form or a call: lists from commas, a time, a count. Checked by `refusal` next. */
export function grantInput(
  input: Record<string, unknown>,
  client: string,
  email: string,
): NewGrant {
  const verbs = listOf(input.verbs, "verbs") ?? [];
  const until = input.until;
  let end: string | null = null;
  if (until !== undefined && until !== null && until !== "") {
    const t =
      typeof until === "string" || typeof until === "number" ? Date.parse(String(until)) : NaN;
    if (!Number.isFinite(t)) throw new PortalRefusal("until: a time", 400);
    if (t <= Date.now()) throw new PortalRefusal("until: a time to come", 400);
    end = new Date(t).toISOString();
  }
  const uses = input.uses ?? input.usesLeft;
  let count: number | null = null;
  if (uses !== undefined && uses !== null && uses !== "") {
    count = Number(uses);
    if (!Number.isSafeInteger(count) || count < 1 || count > 1000)
      throw new PortalRefusal("uses: 1 to 1000", 400);
  }
  const record =
    typeof input.record === "string" && input.record.trim() ? input.record.trim() : null;
  if (record && (record.length > 200 || !/^[a-z_]+\.[a-z_]+:.+$/.test(record)))
    throw new PortalRefusal("record: <type>:<id>", 400);
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 500) : null;
  return {
    email,
    client,
    verbs: verbs as Permission[],
    apps: listOf(input.apps, "apps"),
    channels: listOf(input.channels, "channels"),
    record,
    until: end,
    usesLeft: count,
    reason: reason || null,
  };
}

const scopeOf = (g: NewGrant): Scope => ({
  client: g.client,
  ...(g.apps ? { apps: g.apps } : {}),
  ...(g.channels ? { channels: g.channels } : {}),
  ...(g.record ? { record: g.record } : {}),
});

/**
 * Hand `g` out as `by`, whose fresh access is `granter`: refused when it reaches past what they
 * hold or manage. The grantee must already sign in there: a team seat, or a member of the client.
 */
export async function addGrant(
  tx: Queryable,
  granter: Who,
  by: string,
  g: NewGrant,
): Promise<{ id: number }> {
  const no = refusal(granter, { verbs: g.verbs, scope: scopeOf(g) });
  if (no) throw new PortalRefusal(no, 403);
  const email = normalEmail(g.email);
  if (!(await seated(tx, email, g.client)))
    throw new PortalRefusal(
      g.client === WREN ? "they aren't on Wren's team" : "they aren't one of this client's people",
      400,
    );
  const [row] = await tx
    .insert(grants)
    .values({
      email,
      client: g.client,
      verbs: [...g.verbs],
      apps: g.apps ? [...g.apps] : null,
      channels: g.channels ? [...g.channels] : null,
      record: g.record ?? null,
      until: g.until ? new Date(g.until) : null,
      usesLeft: g.usesLeft ?? null,
      reason: g.reason ?? null,
      by: normalEmail(by),
    })
    .returning({ id: grants.id });
  if (!row) throw new Error("grant insert returned nothing");
  return row;
}

/** Can `email` sign in at `client`: a team seat for `wren` (or any client), else a membership. */
async function seated(db: Queryable, email: string, client: string): Promise<boolean> {
  const [seat] = await db.select().from(operators).where(eq(operators.email, email));
  if (seat) return client === WREN || seat.clients === null || seat.clients.includes(client);
  if (client === WREN) return false;
  const [m] = await db
    .select()
    .from(clientMembers)
    .where(and(eq(clientMembers.clientId, client), eq(clientMembers.email, email)));
  return !!m;
}

/**
 * End a grant now: its `until` becomes now, so History keeps it. `granter` must manage its scope.
 * The last person with `manage` on a client can't end it on themselves.
 */
export async function endGrant(
  tx: Queryable,
  granter: Who,
  by: string,
  id: number,
): Promise<{ ended: number }> {
  const [g] = await tx.select().from(grants).where(eq(grants.id, id));
  if (!g) throw new PortalRefusal("no such grant", 404);
  const scope = scopeOf({
    email: g.email,
    client: g.client,
    verbs: g.verbs,
    apps: g.apps,
    channels: g.channels,
    record: g.record,
  });
  const no = refusal(granter, { verbs: ["read"], scope });
  if (no) throw new PortalRefusal(no, 403);
  if (
    g.verbs.includes("manage") &&
    g.client !== WREN &&
    normalEmail(by) === g.email &&
    !(await othersManage(tx, g.client, g.email))
  )
    throw new PortalRefusal(
      "you're the last who manages this client; give it to someone first",
      409,
    );
  await tx
    .update(grants)
    .set({ until: sql`least(coalesce(${grants.until}, now()), now())` })
    .where(eq(grants.id, id));
  return { ended: id };
}

/** Does anyone but `email` manage `client` whole: an owner, a custom role or a live grant. */
async function othersManage(db: Queryable, client: string, email: string): Promise<boolean> {
  const [r] = await db.execute<{ ok: boolean }>(sql`
    select exists (
      select 1 from ${clientMembers} m
      where m.client_id = ${client} and m.email <> ${email}
        and (m.role = 'owner' or exists (
          select 1 from ${roleGrants} rg where rg.role = m.role and 'manage' = any(rg.verbs)
            and rg.apps is null and rg.channels is null and rg.record is null))
    ) or exists (
      select 1 from ${grants} g where g.client = ${client} and g.email <> ${email}
        and 'manage' = any(g.verbs) and g.apps is null and g.channels is null and g.record is null
        and (g.until is null or g.until > now()) and (g.uses_left is null or g.uses_left > 0)
    ) ok`);
  return r?.ok === true;
}

export interface RoleView {
  id: string;
  client: string | null;
  name: string;
  about: string | null;
  builtIn: boolean;
  grants: Grant[];
}

/**
 * The roles a workspace picks from: the built-ins for its side (Wren's team or a client's people)
 * as one grant each, then its own custom roles with their rows.
 */
export async function rolesIn(db: Queryable, client: string): Promise<RoleView[]> {
  const rows = await db
    .select()
    .from(roles)
    .where(or(isNull(roles.client), eq(roles.client, client)))
    .orderBy(asc(roles.createdAt), asc(roles.id));
  const custom = rows.filter((r) => r.client !== null).map((r) => r.id);
  const parts = custom.length
    ? await db
        .select()
        .from(roleGrants)
        .where(inArray(roleGrants.role, custom))
        .orderBy(asc(roleGrants.id))
    : [];
  const side: Record<string, readonly Permission[] | undefined> =
    client === WREN ? TEAM_GRANTS : MEMBER_GRANTS;
  const order = (id: string) => {
    const i = BUILT_IN_ROLES.findIndex((b) => b.id === id);
    return i < 0 ? BUILT_IN_ROLES.length : i;
  };
  return rows
    .filter((r) => r.client !== null || side[r.id])
    .sort((a, b) => order(a.id) - order(b.id))
    .map((r) => ({
      id: r.id,
      client: r.client,
      name: r.name,
      about: r.about,
      builtIn: r.client === null,
      grants:
        r.client === null
          ? [{ verbs: side[r.id] ?? [], scope: {}, role: r.id, builtIn: true as const }]
          : parts
              .filter((p) => p.role === r.id)
              .map((p) =>
                grantOf(
                  { ...p, id: null, client: null, until: null, uses_left: null, reason: null },
                  undefined,
                ),
              ),
    }));
}

/** May `role` be a seat's or a member's role at `client`: a built-in of that side, or its own. */
export async function roleFits(db: Queryable, role: string, client: string): Promise<boolean> {
  const side: Record<string, unknown> = client === WREN ? TEAM_GRANTS : MEMBER_GRANTS;
  if (isBuiltIn(role)) return Object.hasOwn(side, role);
  const [r] = await db.select({ client: roles.client }).from(roles).where(eq(roles.id, role));
  return r?.client === client;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 20);

export interface RoleInput {
  /** Left out: a new role. */
  id?: string;
  client: string;
  name: string;
  about?: string | null;
  grants: {
    verbs: readonly Permission[];
    apps?: readonly string[] | null;
    channels?: readonly string[] | null;
  }[];
}

/**
 * Make or change a custom role as `by`: every grant in it must be one they could hand out. A
 * change re-reads for everyone who holds it on their next call.
 */
export async function saveRole(
  tx: Queryable,
  granter: Who,
  by: string,
  r: RoleInput,
): Promise<{ id: string }> {
  const name = r.name.trim();
  if (!name || name.length > 60) throw new PortalRefusal("name: 1 to 60 characters", 400);
  if (!r.grants.length || r.grants.length > 20) throw new PortalRefusal("grants: 1 to 20", 400);
  for (const g of r.grants) {
    const no = refusal(granter, {
      verbs: g.verbs,
      scope: {
        client: r.client,
        ...(g.apps ? { apps: g.apps } : {}),
        ...(g.channels ? { channels: g.channels } : {}),
      },
    });
    if (no) throw new PortalRefusal(no, 403);
  }
  let id = r.id;
  if (id) {
    const [was] = await tx.select().from(roles).where(eq(roles.id, id));
    if (!was || was.client !== r.client) throw new PortalRefusal("no such role here", 404);
    await tx
      .update(roles)
      .set({ name, about: r.about?.trim() || null })
      .where(eq(roles.id, id));
    await tx.delete(roleGrants).where(eq(roleGrants.role, id));
  } else {
    const base = `${r.client}.${slug(name) || "role"}`;
    const taken = new Set(
      (
        await tx
          .select({ id: roles.id })
          .from(roles)
          .where(sql`${roles.id} like ${`${base}%`}`)
      ).map((x) => x.id),
    );
    id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    await tx.insert(roles).values({
      id,
      client: r.client,
      name,
      about: r.about?.trim() || null,
      createdBy: normalEmail(by),
    });
  }
  await tx.insert(roleGrants).values(
    r.grants.map((g) => ({
      role: id as string,
      verbs: [...g.verbs],
      apps: g.apps?.length ? [...g.apps] : null,
      channels: g.channels?.length ? [...g.channels] : null,
    })),
  );
  return { id };
}

/** Remove a custom role nobody holds. */
export async function removeRole(
  tx: Queryable,
  client: string,
  id: string,
): Promise<{ removed: string }> {
  const [was] = await tx.select().from(roles).where(eq(roles.id, id));
  if (!was || was.client !== client) throw new PortalRefusal("no such role here", 404);
  const [held] = await tx.execute<{ n: number }>(sql`
    select (select count(*) from ${clientMembers} where role = ${id})
      + (select count(*) from ${operators} where role = ${id}) n`);
  if (Number(held?.n ?? 0) > 0)
    throw new PortalRefusal("someone holds this role; give them another first", 409);
  await tx.delete(roles).where(eq(roles.id, id));
  return { removed: id };
}
