/**
 * Who may do what (designs/2026-10-05-access.md): seven fixed permissions, three roles a side,
 * one check. No imports, so the edge Worker and the web bundle it alone.
 */

export const PERMISSIONS = ["read", "act", "run", "effect", "money", "manage", "team"] as const;
/**
 * - `read`: open apps, records and exports.
 * - `act`: record actions and queue decisions (approve, drop, pause an inbox).
 * - `run`: start and stop loops, handler forms with no effect.
 * - `effect`: handler forms with an effect (send, spend), the kill switch, opener stops.
 * - `money`: Wren's Money app and books accounts; on a client, its invoices and plan prices.
 * - `manage`: people and roles, the look, asking for components. Installs stay team-only.
 * - `team`: the Team page.
 */
export type Permission = (typeof PERMISSIONS)[number];

/** Wren's team: an `operators` row's role. */
export const TEAM_ROLES = ["admin", "operator", "viewer"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

/** A client's people: a `client_members` row's role. */
export const MEMBER_ROLES = ["owner", "member", "viewer"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/** The id in an operator's `clients` that stands for Wren's own apps: Wren is client zero. */
export const WREN = "wren";

export const TEAM_GRANTS: Readonly<Record<TeamRole, readonly Permission[]>> = {
  admin: PERMISSIONS,
  operator: ["read", "act", "run"],
  viewer: ["read"],
};

export const MEMBER_GRANTS: Readonly<Record<MemberRole, readonly Permission[]>> = {
  owner: ["read", "act", "money", "manage"],
  member: ["read", "act"],
  viewer: ["read"],
};

/**
 * Who is asking, read fresh from the database: the demo, a team row (`clients` null is every
 * client), a membership on one client, or nobody (null).
 */
export type Who =
  | { demo: true }
  | { team: TeamRole; clients: readonly string[] | null }
  | { member: MemberRole; client: string }
  | null;

/**
 * May `who` do `p` at `client`? No client: the role alone (the client is picked later, inside
 * the login's scope). An admin's scope is everything.
 */
export function can(who: Who, p: Permission, client?: string): boolean {
  if (!who) return false;
  if ("demo" in who) return p === "read";
  if ("team" in who) {
    const scoped = who.team !== "admin" && who.clients !== null && client !== undefined;
    if (scoped && !who.clients?.includes(client)) return false;
    return TEAM_GRANTS[who.team].includes(p);
  }
  if (client !== undefined && client !== who.client) return false;
  return MEMBER_GRANTS[who.member].includes(p);
}

/** Every permission `who` holds at `client`: what `portalMe` sends the web. */
export const granted = (who: Who, client?: string): Permission[] =>
  PERMISSIONS.filter((p) => can(who, p, client));

/**
 * What a portal route needs: a permission at the client the request names (or the login's
 * own), or `wren:` and a permission at Wren's own apps whatever client is named.
 */
export type Need = Permission | `wren:${Permission}`;

export function needOf(need: Need): { permission: Permission; wren: boolean } {
  const wren = need.startsWith("wren:");
  return { permission: (wren ? need.slice(5) : need) as Permission, wren };
}

export const isNeed = (v: unknown): v is Need =>
  typeof v === "string" && PERMISSIONS.includes(needOf(v as Need).permission);
