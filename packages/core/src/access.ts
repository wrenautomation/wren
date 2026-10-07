/**
 * Who may do what (designs/2026-10-05-access.md, 2026-10-06-scoped-access.md): eight fixed
 * verbs, built-in roles on each side, custom roles and extra grants, one check. Every answer is a
 * list of grants that match: there are no deny rules. No imports, so the edge Worker and the web
 * bundle it alone.
 */

export const PERMISSIONS = [
  "read",
  "act",
  "run",
  "effect",
  "money",
  "manage",
  "team",
  "comment",
] as const;
/**
 * - `read`: open apps, records and exports.
 * - `act`: record actions and queue decisions (approve, drop, pause an inbox).
 * - `run`: start and stop loops, handler forms with no effect.
 * - `effect`: handler forms with an effect (send, spend), the kill switch, opener stops.
 * - `money`: Wren's Money app and books accounts; on a client, its invoices and plan prices.
 * - `manage`: people and roles, the look, asking for components. Installs stay team-only.
 * - `team`: the Team page.
 * - `comment`: raise an issue on something you can read, without changing it.
 */
export type Permission = (typeof PERMISSIONS)[number];

/** Wren's team: an `operators` row's built-in role. */
export const TEAM_ROLES = ["admin", "operator", "viewer"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

/** A client's people: a `client_members` row's built-in role. */
export const MEMBER_ROLES = ["owner", "member", "viewer"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/**
 * A role a seat or membership holds: a built-in above, or a custom role's id
 * (`<client>.<slug>`, `wren.<slug>` for Wren's team), whose grants are rows.
 */
export type RoleId = string;

/** The id in an operator's `clients` that stands for Wren's own apps: Wren is client zero. */
export const WREN = "wren";

export const TEAM_GRANTS: Readonly<Record<TeamRole, readonly Permission[]>> = {
  admin: PERMISSIONS,
  operator: ["read", "act", "run", "comment"],
  viewer: ["read"],
};

export const MEMBER_GRANTS: Readonly<Record<MemberRole, readonly Permission[]>> = {
  owner: ["read", "act", "money", "manage", "comment"],
  member: ["read", "act", "comment"],
  viewer: ["read"],
};

/** On Wren's own apps these stay with admins, whatever a grant says: money and spend are William's. */
export const ADMIN_ONLY_AT_WREN: readonly Permission[] = ["effect", "money"];

/** The built-in roles as the `roles` table seeds them: names and one line each. */
export const BUILT_IN_ROLES: readonly {
  id: TeamRole | MemberRole;
  name: string;
  about: string;
  side: "team" | "client" | "both";
}[] = [
  { id: "admin", name: "Admin", about: "Does everything, on every client.", side: "team" },
  {
    id: "operator",
    name: "Operator",
    about: "Works its clients. No money, sends, installs or team.",
    side: "team",
  },
  {
    id: "owner",
    name: "Owner",
    about: "Runs the account: people, invoices, the look.",
    side: "client",
  },
  { id: "member", name: "Member", about: "Uses the apps and acts in them.", side: "client" },
  { id: "viewer", name: "Viewer", about: "Reads only.", side: "both" },
];
export const isBuiltIn = (role: string): role is TeamRole | MemberRole =>
  BUILT_IN_ROLES.some((r) => r.id === role);

/** The apps a scope names: each app's id in the portal, and what a sentence calls it. */
export const APPS: Readonly<Record<string, string>> = {
  work: "Work",
  reactivation: "Reactivation",
  leads: "Leads",
  texts: "Texts",
  marketplace: "Marketplace",
  marketing: "Marketing",
  workflows: "Workflows",
  outbound: "Outbound",
  inbox: "Inbox",
  loops: "Loops",
  money: "Money",
  pipeline: "Pipeline",
  clients: "Clients",
  team: "Team",
  handlers: "Handlers",
  review: "Review",
  ask: "Ask",
  library: "Library",
  calendar: "Calendar",
  voice: "Voice",
  account: "Account",
};
export type App = keyof typeof APPS & string;

/** The channels a scope names: where a record's work goes out or comes in. */
export const ACCESS_CHANNELS = [
  "youtube",
  "linkedin",
  "x",
  "tiktok",
  "instagram",
  "facebook",
  "reddit",
  "email",
  "sms",
  "phone",
] as const;
export type AccessChannel = (typeof ACCESS_CHANNELS)[number];
export const CHANNEL_NAMES: Readonly<Record<AccessChannel, string>> = {
  youtube: "YouTube",
  linkedin: "LinkedIn",
  x: "X",
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  reddit: "Reddit",
  email: "email",
  sms: "texts",
  phone: "phone",
};
export const isChannel = (v: unknown): v is AccessChannel =>
  typeof v === "string" && (ACCESS_CHANNELS as readonly string[]).includes(v);

/**
 * Where a grant holds. Left out means all: no `apps` is every app, no `channels` every channel,
 * no `record` every record. `record` is `<type>:<id>`, one record (the ACL). `client` is a client
 * id or `wren`; left out, every client the seat reaches.
 */
export interface Scope {
  client?: string | undefined;
  apps?: readonly string[];
  channels?: readonly string[];
  record?: string;
}

/**
 * Who may do which verbs, where, until when. A built-in role is one grant over its whole scope;
 * a custom role is its rows; an extra is one row of `grants`. `until` and `usesLeft` end it.
 */
export interface Grant {
  verbs: readonly Permission[];
  scope: Scope;
  /** ISO time it ends; null or left out, never. */
  until?: string | null;
  /** Uses it has left; null or left out, any number. */
  usesLeft?: number | null;
  /** The `grants` row, for an extra; spending a counted one names it. */
  id?: number;
  /** The role it comes from; an extra has none. */
  role?: RoleId;
  /** A built-in role's: holds over everything inside the seat's or membership's fence. */
  builtIn?: true;
  reason?: string | null;
}

/**
 * What a check is about. A part left out is "anywhere": the guard asks whether the login holds a
 * verb somewhere in a client before the handler knows which row. `null` is "none": a record with
 * no channel is covered only by a grant not limited to channels. A string is that one.
 */
export interface Target {
  client?: string | undefined;
  app?: string | null;
  channel?: string | null;
  record?: string | null;
}

/**
 * Who is asking, read fresh from the database: the demo, a team seat (`clients` null is every
 * client), a membership on one client, or nobody (null). `team` and `member` are the role: a
 * built-in, or a custom role whose rows are in `grants` with the person's extra grants.
 */
export type Who =
  | { demo: true }
  | { team: RoleId; clients: readonly string[] | null; grants?: readonly Grant[] }
  | { member: RoleId; client: string; grants?: readonly Grant[] }
  | null;

/** Does this scope reach that target? Left out on either side matches; `null` needs no limit. */
export function covers(scope: Scope, at: Target): boolean {
  if (at.client !== undefined && scope.client !== undefined && scope.client !== at.client)
    return false;
  const part = (limit: readonly string[] | undefined, v: string | null | undefined) =>
    v === undefined || limit === undefined || (v !== null && limit.includes(v));
  if (!part(scope.apps, at.app)) return false;
  if (!part(scope.channels, at.channel)) return false;
  if (at.record !== undefined && scope.record !== undefined && scope.record !== at.record)
    return false;
  return true;
}

/** Not ended and not used up at `now`. Ended grants drop out here, so nothing sweeps them. */
export const live = (g: Grant, now: Date = new Date()): boolean =>
  (g.until == null || Date.parse(g.until) > now.getTime()) &&
  (g.usesLeft == null || g.usesLeft > 0);

const targetOf = (at: string | Target | undefined): Target =>
  typeof at === "string" ? { client: at } : (at ?? {});

/** Every grant this login holds: its built-in role as one grant, then its rows. */
export function grantsOf(who: Who): Grant[] {
  if (!who || "demo" in who) return [];
  if ("team" in who) {
    const base = (TEAM_GRANTS as Record<string, readonly Permission[] | undefined>)[who.team];
    return [
      ...(base ? [{ verbs: base, scope: {}, role: who.team, builtIn: true as const }] : []),
      ...(who.grants ?? []),
    ];
  }
  const base = (MEMBER_GRANTS as Record<string, readonly Permission[] | undefined>)[who.member];
  return [
    ...(base
      ? [{ verbs: base, scope: { client: who.client }, role: who.member, builtIn: true as const }]
      : []),
    ...(who.grants ?? []),
  ];
}

/**
 * The grants that let `who` do `p` at `at`: empty is no. A string is a client, as before; left
 * out, the role alone (the client is picked later, inside the login's fence). A team seat's
 * `clients` fence every grant (an admin's reaches everything); a member's grants never leave
 * their client; on Wren's apps `effect` and `money` come from the admin role only.
 */
export function why(who: Who, p: Permission, at?: string | Target, now = new Date()): Grant[] {
  if (!who) return [];
  const t = targetOf(at);
  if ("demo" in who) return p === "read" ? [{ verbs: ["read"], scope: {}, role: "demo" }] : [];
  if ("team" in who) {
    const fenced = who.team !== "admin" && who.clients !== null && t.client !== undefined;
    if (fenced && !who.clients?.includes(t.client as string)) return [];
  } else if (t.client !== undefined && t.client !== who.client) return [];
  const adminOnly = t.client === WREN && ADMIN_ONLY_AT_WREN.includes(p);
  return grantsOf(who).filter(
    (g) =>
      g.verbs.includes(p) &&
      (g.builtIn || ("member" in who ? g.scope.client === who.client : true)) &&
      covers(g.scope, t) &&
      live(g, now) &&
      (!adminOnly || (g.builtIn === true && g.role === "admin")),
  );
}

/** May `who` do `p` at `at`? See `why`, which lists the grants that say yes. */
export const can = (who: Who, p: Permission, at?: string | Target, now?: Date): boolean =>
  why(who, p, at, now).length > 0;

/** Every verb `who` holds at `at`, anywhere inside it: what `portalMe` sends the web. */
export const granted = (who: Who, at?: string | Target): Permission[] =>
  PERMISSIONS.filter((p) => can(who, p, at));

/**
 * Does `who` hold `p` over all of `client`, every app, channel and record? Then nothing past the
 * guard narrows it: a built-in role, or a grant with no limit but its client.
 */
export const whole = (who: Who, p: Permission, client?: string): boolean =>
  can(who, p, { client, app: null, channel: null, record: null });

/**
 * A grant must be spent to do this: every grant that says yes is counted. Null when one with no
 * count says yes (nothing to spend), else the counted grants in order, the one ending soonest
 * first. Empty: no.
 */
export function toSpend(who: Who, p: Permission, at: Target, now = new Date()): Grant[] | null {
  const yes = why(who, p, at, now);
  if (yes.some((g) => g.usesLeft == null)) return null;
  return yes
    .filter((g) => g.id !== undefined)
    .sort((a, b) => (a.until ?? "~").localeCompare(b.until ?? "~"));
}

/**
 * Which rows of a record type `who` may `p`: null is every row; else the rows on `channels`
 * (when the type keeps its channel per row) or with one of `ids` (a grant on one record).
 * Neither is none. `type` is the record type's id; its channel is one, a field, or none.
 */
export interface Reach {
  channels: readonly AccessChannel[];
  ids: readonly string[];
}
export function reach(
  who: Who,
  p: Permission,
  at: { client?: string | undefined; app: string; type: string; channel: string | object | null },
  now = new Date(),
): Reach | null {
  const base = { client: at.client, app: at.app, record: null };
  if (can(who, p, { ...base, channel: null }, now)) return null;
  if (typeof at.channel === "string" && can(who, p, { ...base, channel: at.channel }, now))
    return null;
  const channels =
    at.channel !== null && typeof at.channel === "object"
      ? ACCESS_CHANNELS.filter((c) => can(who, p, { ...base, channel: c }, now))
      : [];
  const prefix = `${at.type}:`;
  const ids = grantsOf(who)
    .map((g) => g.scope.record)
    .filter((r): r is string => !!r?.startsWith(prefix))
    .filter((record) => can(who, p, { client: at.client, app: at.app, record }, now))
    .map((r) => r.slice(prefix.length));
  return { channels, ids: [...new Set(ids)] };
}

/** The channels a handler's input names (`channel`, `platform`, `platforms`): each is checked. */
export function channelsIn(input: unknown): AccessChannel[] {
  if (!input || typeof input !== "object") return [];
  const o = input as Record<string, unknown>;
  const named = [o.channel, o.platform, ...(Array.isArray(o.platforms) ? o.platforms : [])];
  return [...new Set(named.filter(isChannel))];
}

/**
 * Where a route works: an app, an app on one channel (the email console is all email), or null,
 * "the handler checks" (records and calls, whose app comes from the record type).
 */
export type RouteAt = string | { app: string; channel: AccessChannel } | null;
/** Each route's place, from its service's routes map: `"*"` for the routes it doesn't name. */
export type RouteApps<R> = { readonly "*": RouteAt } & { readonly [K in keyof R]?: RouteAt };
/** A route's place as a check's target: its app and channel, each left out when it has none. */
export function routeAt(apps: RouteApps<object>, route: string): Target {
  const at = Object.hasOwn(apps, route)
    ? ((apps as Record<string, RouteAt | undefined>)[route] ?? null)
    : apps["*"];
  if (at === null) return {};
  return typeof at === "string" ? { app: at } : { app: at.app, channel: at.channel };
}

/** The targets a scope spans: one per app and channel it names, `null` where it names none. */
export function targetsOf(s: Scope): Target[] {
  const out: Target[] = [];
  for (const app of s.apps ?? [null])
    for (const channel of s.channels ?? [null])
      out.push({ client: s.client, app, channel, record: s.record ?? null });
  return out;
}

/**
 * Why `by` may not hand out `g`, or null when it may. A person grants only verbs and scopes they
 * hold, plus `manage` over that scope; an owner never past their own client; on Wren's apps
 * `effect` and `money` are never handed out.
 */
export function refusal(
  by: Who,
  g: Pick<Grant, "verbs" | "scope">,
  now = new Date(),
): string | null {
  if (!g.verbs.length) return "say what they may do";
  const bad = g.verbs.filter((v) => !(PERMISSIONS as readonly string[]).includes(v));
  if (bad.length) return `no such verb: ${bad.join(", ")}`;
  if (g.scope.client === undefined) return "say which client";
  if (g.scope.apps?.some((a) => !Object.hasOwn(APPS, a))) return "no such app";
  if (g.scope.channels?.some((c) => !isChannel(c))) return "no such channel";
  if (g.scope.client === WREN && g.verbs.some((v) => ADMIN_ONLY_AT_WREN.includes(v)))
    return "money and sends on Wren's apps stay with admins";
  for (const t of targetsOf(g.scope)) {
    if (!can(by, "manage", t, now)) return "you don't manage that";
    const lacking = g.verbs.filter((v) => !can(by, v, t, now));
    if (lacking.length) return `you can't ${lacking.join(", ")} there yourself`;
  }
  return null;
}

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

const VERB_WORDS: Record<Permission, string> = {
  read: "see",
  act: "act on",
  run: "run",
  effect: "send and spend on",
  money: "see money on",
  manage: "manage",
  team: "manage the team on",
  comment: "raise issues on",
};

/** Words for a list: "a, b and c". */
const listed = (xs: readonly string[]) =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;

/**
 * A grant as a sentence a person reads: "Can act on LinkedIn in Marketing until Fri, 5 PM."
 * `zone` is the reader's; the server's is UTC.
 */
export function sentence(g: Grant, now = new Date(), zone?: string): string {
  const verbs = PERMISSIONS.filter((v) => g.verbs.includes(v)).map((v) => VERB_WORDS[v]);
  const where: string[] = [];
  if (g.scope.record) where.push(`one record (${g.scope.record.replace(":", " ")})`);
  else if (g.scope.channels?.length)
    where.push(listed(g.scope.channels.map((c) => CHANNEL_NAMES[c as AccessChannel] ?? c)));
  else where.push("everything");
  if (g.scope.apps?.length) where.push(`in ${listed(g.scope.apps.map((a) => APPS[a] ?? a))}`);
  let s = `Can ${listed(verbs)} ${where.join(" ")}`;
  if (g.usesLeft != null) s += g.usesLeft === 1 ? ", once" : `, ${g.usesLeft} more times`;
  if (g.until) {
    const end = new Date(g.until);
    s +=
      end.getTime() <= now.getTime()
        ? ". Ended"
        : ` until ${end.toLocaleString("en-US", {
            weekday: "short",
            ...(end.getTime() - now.getTime() > 6 * 864e5
              ? { month: "short", day: "numeric" }
              : {}),
            hour: "numeric",
            minute: "2-digit",
            ...(zone ? { timeZone: zone } : {}),
          })}`;
  }
  return `${s}.`;
}
