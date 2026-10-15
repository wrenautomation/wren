/**
 * Who is asking the portal, and which client they get. Every portal service
 * (delivery, and one per product) picks the client here, so a login only ever
 * reaches its own clients. The edge Worker sets the viewer; the browser can't.
 */
import * as restate from "@restatedev/restate-sdk";
import { actingAs, type Db } from "@wren/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  type Cap,
  can,
  channelsIn,
  type Grant,
  granted,
  type Need,
  needOf,
  PERMISSIONS,
  type Permission,
  type RoleId,
  type RouteApps,
  routeAt,
  type Target,
  type ViewAs,
  viewAsShape,
  type Who,
  WREN,
} from "./access.js";
import { normalEmail, touchMember } from "./clients/index.js";
import { type Client, clientMembers, clients, operators } from "./clients/schema.js";
import { evaluateFlags, subjectOf } from "./flags.js";
import { grantsFor, roleFits } from "./grants.js";
import { PortalRefusal } from "./refusal.js";
import { handlerForm, serviceHandler } from "./restate/form.js";
import { flags } from "./schema.js";

/** A team login's row, read fresh: its role and its clients (null = every client). */
export interface TeamSeat {
  role: RoleId;
  clients: readonly string[] | null;
}

/**
 * Who a View as came to, set by the guard on the viewer it hands a handler
 * (designs/2026-10-14-view-as.md). The viewer's own `email` is then the person looked as.
 */
export interface Viewing {
  /** The real person signed in: the actor in the audit log. */
  by: string;
  /** The client looked at, or `wren` for a teammate. */
  client: string;
  /** Act: changes go through, logged as `by` acting as this. Else Look, reads only. */
  act: boolean;
  /** Their email, or "someone new as member". */
  who: string;
  /** Their role there. */
  role: RoleId;
  /** In words, for the audit log: `amy@acme.test at acme`. */
  label: string;
  /** The sandbox: nothing there ever sends or spends. */
  sandbox: boolean;
}

/**
 * An email our sign-in vouched for, or anyone on the demo host. `operator` comes from the token;
 * the access guard overwrites it, and sets `team` and `access`, from a fresh read before any
 * handler runs. `access` is the whole answer, grants and all, that `canAt` checks targets with.
 * `cap` is an access token's limit, set by the Worker; it stays on through View as. `as` is set
 * by the guard under View as.
 */
export type Viewer =
  | { email: string; operator?: boolean; team?: TeamSeat; access?: Who; cap?: Cap; as?: Viewing }
  | { demo: true };
export type SignedViewer = Exclude<Viewer, { demo: true }>;

export interface PortalRequest {
  viewer: Viewer;
  /** Which of the viewer's clients; the first when omitted. */
  client?: string;
  /** An operator looking as the client would: no internal notes, no team tools. */
  asClient?: boolean;
  /** View as: which client, who there, Look or Act (`ViewAs`); the guard decides (`viewAsOf`). */
  viewAs?: ViewAs | unknown;
}

/** The View as a call carries, read leniently: anything there that isn't a sound Act is a Look. */
export function viewAsIn(req: PortalRequest): ViewAs | null {
  const v = viewAsShape(req.viewAs);
  return v === "bad" ? { client: "", act: false } : v;
}
/** Under View as at all: nobody's own things, no device cache, no seen mark. */
export const viewingAs = (req: PortalRequest): boolean => viewAsIn(req) !== null;
/** Under View as, Look: a change is refused. */
export const lookingOnly = (req: PortalRequest): boolean => viewAsIn(req)?.act === false;

export { PortalRefusal, type RefusalStatus } from "./refusal.js";

export const isDemo = (v: Viewer): v is { demo: true } => "demo" in v;
export const isOperator = (v: Viewer): boolean => !isDemo(v) && v.operator === true;
/** Sees what only Wren's team sees: an operator, unless they asked to look as the client. */
export const seesInternal = (req: PortalRequest): boolean =>
  isOperator(req.viewer) && req.asClient !== true;

/** This email's `operators` row, or null: Wren's team. */
export async function teamSeat(main: Db, email: string): Promise<TeamSeat | null> {
  const [row] = await main
    .select({ role: operators.role, clients: operators.clients })
    .from(operators)
    .where(eq(operators.email, normalEmail(email)));
  return row ?? null;
}

/**
 * Who this viewer is, read fresh (`can` in `@wren/core/access` takes it): the demo, a team row,
 * the membership at `client` (their first when left out), or null. Demo clients have no members.
 */
export async function whoIs(main: Db, viewer: Viewer, client?: string): Promise<Who> {
  if (isDemo(viewer)) return { demo: true };
  const who = await personOf(main, viewer.email, client);
  return who && viewer.cap ? { ...who, cap: viewer.cap } : who;
}

async function personOf(main: Db, email: string, client?: string): Promise<Who> {
  const seat = await teamSeat(main, email);
  if (seat) {
    const grants = await grantsFor(main, email, seat.role);
    return { team: seat.role, clients: seat.clients, ...(grants.length ? { grants } : {}) };
  }
  const [row] = await main
    .select({ role: clientMembers.role, client: clientMembers.clientId })
    .from(clientMembers)
    .innerJoin(clients, eq(clientMembers.clientId, clients.id))
    .where(
      and(
        eq(clients.demo, false),
        eq(clientMembers.email, normalEmail(email)),
        client === undefined ? undefined : eq(clientMembers.clientId, client),
      ),
    )
    .orderBy(asc(clients.id))
    .limit(1);
  if (!row) return null;
  const grants = await grantsFor(main, email, row.role, row.client);
  return { member: row.role, client: row.client, ...(grants.length ? { grants } : {}) };
}

/**
 * What a route's need is checked at when the request names no client: `first`, the login's own
 * (a member's first client; a team login by role alone, `pickClient` keeps it in scope), or
 * `wren`, Wren's own apps for a team login (the console, the email and books consoles) and still
 * the member's own client for anyone else.
 */
export type Unnamed = "first" | "wren";

/**
 * The access guard: reads who is asking fresh, refuses what `can` refuses, and hands the
 * handler the request with the fresh `operator` and `team` on its viewer. `wren:` needs are
 * checked at Wren's own apps whatever client is named. The need holds at the route's `place` (its
 * app, and channel when the whole service is one) and on every channel the request names.
 */
export async function guard<R extends PortalRequest>(
  main: Db,
  need: Need,
  req: R,
  unnamed: Unnamed,
  place: Target = {},
): Promise<R> {
  const { permission, wren } = needOf(need);
  const named = typeof req.client === "string" ? req.client : undefined;
  if (!req.viewer || typeof req.viewer !== "object") throw new PortalRefusal("sign in", 403);
  const asked = (req as PortalRequest).viewAs;
  const viewing =
    asked === undefined || asked === null || asked === ""
      ? null
      : await viewAsOf(main, req.viewer, asked, permission);
  const viewer = viewing ? capOf(req.viewer, viewing.viewer) : req.viewer;
  const as = viewing?.viewer.as;
  // View as is one client at a time: a call naming another is refused.
  if (as && as.client !== WREN && named !== undefined && named !== as.client)
    throw new PortalRefusal("View as is for one client at a time", 403);
  const who = viewing
    ? narrowed(viewing.who, isDemo(req.viewer) ? undefined : req.viewer.cap)
    : await whoIs(main, viewer, wren ? undefined : named);
  // `wren` is for the team: a client's people naming no client stay on their own.
  const team = who !== null && "team" in who;
  const client = wren ? WREN : (named ?? (unnamed === "wren" && team ? WREN : undefined));
  const at = (channel?: string): Target => ({
    ...place,
    client,
    ...(channel ? { channel } : {}),
  });
  // A handler's input names its channel at the top, or under `input` for a console call.
  const channels = [
    ...new Set([...channelsIn(req), ...channelsIn((req as { input?: unknown }).input)]),
  ];
  const ok = channels.length
    ? channels.every((c) => can(who, permission, at(c)))
    : can(who, permission, at());
  if (!ok)
    throw new PortalRefusal(
      isDemo(viewer)
        ? "the demo is read-only"
        : can(who, "read", at())
          ? "your role can't do that"
          : "no access",
      403,
    );
  if (isDemo(viewer)) return req;
  const fresh: SignedViewer =
    who && "team" in who
      ? {
          email: viewer.email,
          operator: true,
          team: { role: who.team, clients: who.clients },
          access: who,
          ...(viewer.cap ? { cap: viewer.cap } : {}),
          ...(as ? { as } : {}),
        }
      : {
          email: viewer.email,
          ...(who ? { access: who } : {}),
          ...(viewer.cap ? { cap: viewer.cap } : {}),
          ...(as ? { as } : {}),
        };
  return { ...req, viewer: fresh };
}

/** `as` with `real`'s token cap: looking as someone never widens a token. */
const capOf = (real: Viewer, as: SignedViewer): SignedViewer =>
  !isDemo(real) && real.cap ? { ...as, cap: real.cap } : as;

/** `who` under a token's cap too: both limits hold. */
function narrowed(who: Who, cap: Cap | undefined): Who {
  if (!cap || !who || "demo" in who) return who;
  const own = who.cap;
  const apps =
    own?.apps && cap.apps ? own.apps.filter((a) => cap.apps?.includes(a)) : (own?.apps ?? cap.apps);
  return {
    ...who,
    cap: {
      verbs: own ? own.verbs.filter((v) => cap.verbs.includes(v)) : cap.verbs,
      ...(apps ? { apps } : {}),
    },
  };
}

/** The sandbox's limit: everything but `effect`, so nothing there sends or spends. */
const SANDBOX_CAP: Cap = { verbs: PERMISSIONS.filter((p) => p !== "effect") };

/** The address a role-only View as goes by: never a real one. */
const someoneNew = (role: string) =>
  `new.${role.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}@view-as.invalid`;

/**
 * View as (designs/2026-10-14-view-as.md): who the real viewer becomes for this call, and what
 * that person holds, read fresh. Wren's team only: any client its seat reaches, as a person
 * there, a role with nobody in it yet, or (no one named) its owner. Look reads only; Act is an
 * admin's, and a role-only Act only in the sandbox, so a real client's rows never carry a made-up
 * author. An admin views as a teammate too.
 */
export async function viewAsOf(
  main: Db,
  real: Viewer,
  raw: unknown,
  permission: Permission,
): Promise<{ viewer: SignedViewer & { as: Viewing }; who: Who }> {
  if (isDemo(real)) throw new PortalRefusal("the demo is read-only", 403);
  const v = viewAsShape(raw);
  if (v === null || v === "bad") throw new PortalRefusal("view as: say which client", 400);
  if (!v.act && permission !== "read")
    throw new PortalRefusal("Look reads only. Switch to Act to change things.", 403);
  const me = await whoIs(main, real);
  if (me === null || !("team" in me)) throw new PortalRefusal("View as is for Wren's team", 403);
  const admin = can(me, "team", WREN);
  if (v.act && !admin) throw new PortalRefusal("only an admin acts as someone", 403);
  const by = normalEmail(real.email);
  const seen = (client: string, words: string, role: RoleId, sandbox: boolean): Viewing => ({
    by,
    client,
    act: v.act === true,
    who: words,
    role,
    label: `${words} at ${client}`,
    sandbox,
  });

  if (v.client === WREN) {
    if (!admin) throw new PortalRefusal("only an admin views as a teammate", 403);
    let email = v.email;
    let role = v.role;
    if (email) {
      const seat = await teamSeat(main, email);
      if (!seat) throw new PortalRefusal("no such teammate", 404);
      role = seat.role;
      const grants = await grantsFor(main, email, seat.role);
      const who: Who = {
        team: seat.role,
        clients: seat.clients,
        ...(grants.length ? { grants } : {}),
      };
      return {
        viewer: { email, operator: true, as: seen(WREN, email, seat.role, false) },
        who,
      };
    }
    if (!role || !(await roleFits(main, role, WREN)))
      throw new PortalRefusal("view as: a teammate or one of Wren's roles", 400);
    if (v.act)
      throw new PortalRefusal("Someone new acts only in the sandbox. Pick a person to Act.", 403);
    email = someoneNew(role);
    const grants = await grantsFor(main, email, role);
    return {
      viewer: {
        email,
        operator: true,
        as: seen(WREN, `someone new as ${role}`, role, false),
      },
      who: { team: role, clients: null, ...(grants.length ? { grants } : {}) },
    };
  }

  const [client] = await main.select().from(clients).where(eq(clients.id, v.client));
  if (!client) throw new PortalRefusal("no such client", 404);
  if (!can(me, "read", { client: client.id }))
    throw new PortalRefusal("that client isn't one of yours", 403);
  let email = v.email;
  let role = v.role;
  if (!email && !role) {
    const [owner] = await main
      .select({ email: clientMembers.email })
      .from(clientMembers)
      .where(and(eq(clientMembers.clientId, client.id), eq(clientMembers.role, "owner")))
      .orderBy(asc(clientMembers.email))
      .limit(1);
    if (owner) email = owner.email;
    else role = "owner";
  }
  let viewing: Viewing;
  if (email) {
    const [m] = await main
      .select({ role: clientMembers.role })
      .from(clientMembers)
      .where(and(eq(clientMembers.clientId, client.id), eq(clientMembers.email, email)));
    if (!m) throw new PortalRefusal("no such person there", 404);
    role = m.role;
    viewing = seen(client.id, email, m.role, client.sandbox);
  } else {
    if (!role || !(await roleFits(main, role, client.id)))
      throw new PortalRefusal("view as: one of that client's roles", 400);
    if (v.act && !client.sandbox)
      throw new PortalRefusal("Someone new acts only in the sandbox. Pick a person to Act.", 403);
    email = someoneNew(role);
    viewing = seen(client.id, `someone new as ${role}`, role, client.sandbox);
  }
  const grants = await grantsFor(main, email, role as RoleId, client.id);
  const who: Who = {
    member: role as RoleId,
    client: client.id,
    ...(grants.length ? { grants } : {}),
    ...(client.sandbox ? { cap: SANDBOX_CAP } : {}),
  };
  return { viewer: { email, as: viewing }, who };
}

/**
 * `ctx` with each `run` step held to `who`: Restate runs a step's closure from its own loop, so
 * the call's View as wouldn't reach the audit log from inside one otherwise.
 */
function actingCtx<C extends restate.Context>(ctx: C, who: { actor: string; as: string }): C {
  const run = (a: unknown, b?: unknown, c?: unknown) =>
    typeof a === "function"
      ? ctx.run(() => actingAs(who, a as () => Promise<unknown>))
      : ctx.run(a as string, () => actingAs(who, b as () => Promise<unknown>), c as never);
  return new Proxy(ctx, {
    get(t, k) {
      if (k === "run") return run;
      const v = Reflect.get(t, k, t);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
}

/** A portal handler as Restate calls it; `never` takes any request type. */
type PortalHandler = (ctx: restate.Context, req: never) => Promise<unknown>;

/**
 * A portal service: every handler behind the guard, each with its need from `routes`; a handler
 * made with `serviceHandler` keeps its form. A handler with no need doesn't type-check; one not
 * in `routes` throws here, so the worker won't start.
 */
export function portalService<
  N extends string,
  R extends Readonly<Record<string, Need>>,
  H extends { [K in keyof R]: PortalHandler },
>(o: {
  name: N;
  main: Db;
  routes: R;
  /** Each route's app, from its routes map. */
  apps: RouteApps<R>;
  unnamed: Unnamed;
  handlers: H;
}): restate.ServiceDefinition<N, H> {
  const extra = Object.keys(o.handlers).filter((k) => !Object.hasOwn(o.routes, k));
  if (extra.length) throw new Error(`${o.name}: no need for ${extra.join(", ")}`);
  const handlers: Record<string, unknown> = {};
  for (const key of Object.keys(o.routes) as (keyof R & string)[]) {
    const fn = o.handlers[key] as unknown as (
      ctx: restate.Context,
      req: PortalRequest,
    ) => Promise<unknown>;
    const need = o.routes[key] as Need;
    const run = async (ctx: restate.Context, req: PortalRequest) => {
      const fresh = await answer(() => guard(o.main, need, req, o.unnamed, routeAt(o.apps, key)));
      // Under View as, every change this call makes is logged as the real person acting as them.
      const as = isDemo(fresh.viewer) ? undefined : fresh.viewer.as;
      if (!as) return fn(ctx, fresh);
      const who = { actor: as.by, as: as.label };
      return actingAs(who, () => fn(actingCtx(ctx, who), fresh));
    };
    const form = handlerForm(fn);
    handlers[key] = form ? serviceHandler(form, run) : run;
  }
  return restate.service({
    name: o.name,
    handlers: handlers as never,
  }) as unknown as restate.ServiceDefinition<N, H>;
}

/**
 * May this team viewer do `p` at `client`? Their fresh `team` (set by the guard), or an admin
 * when a handler is called straight (tests, the CLI). Never a client's people.
 */
export function teamCan(req: PortalRequest, p: Permission, at: string | Target): boolean {
  if (!seesInternal(req) || isDemo(req.viewer)) return false;
  return can(accessOf(req), p, at);
}

/**
 * What the guard read for this viewer (grants and all); a team viewer called straight (tests, the
 * CLI) is an admin, anyone else nobody until the guard has read them.
 */
export function accessOf(req: PortalRequest): Who {
  const v = req.viewer;
  if (isDemo(v)) return { demo: true };
  if (v.access) return v.access;
  if (v.operator) return { team: v.team?.role ?? "admin", clients: v.team?.clients ?? null };
  return null;
}

/**
 * May this viewer do `p` at this target: the app, channel and record a handler knows once it
 * has the row. Reads the person fresh when the guard didn't (a handler called straight).
 */
export async function canAt(
  main: Db,
  req: PortalRequest,
  p: Permission,
  at: Target,
): Promise<boolean> {
  const v = req.viewer;
  const who =
    !isDemo(v) && !v.access && !v.operator ? await whoIs(main, v, at.client) : accessOf(req);
  return can(who, p, at);
}

/** Every grant a viewer holds, for the web to hide what a target refuses: none for a built-in. */
export const extraGrants = (who: Who): readonly Grant[] =>
  who && !("demo" in who) ? (who.grants ?? []) : [];

/**
 * The clients this viewer may open: the demo's; for an operator every one, or only their
 * `team.clients` (an admin sees all); else their memberships.
 */
export async function clientsFor(main: Db, viewer: Viewer): Promise<Client[]> {
  if (isDemo(viewer))
    return main.select().from(clients).where(eq(clients.demo, true)).orderBy(asc(clients.id));
  // View as a client's person: that client alone, whatever else they're in.
  if (viewer.as && viewer.as.client !== WREN)
    return main.select().from(clients).where(eq(clients.id, viewer.as.client));
  if (viewer.operator) {
    const scope = viewer.team?.role === "admin" ? null : viewer.team?.clients;
    return main
      .select()
      .from(clients)
      .where(scope ? inArray(clients.id, scope.length ? scope : [""]) : undefined)
      .orderBy(asc(clients.id));
  }
  const email = normalEmail(viewer.email);
  if (!email) return [];
  const rows = await main
    .select({ client: clients })
    .from(clients)
    .innerJoin(clientMembers, eq(clientMembers.clientId, clients.id))
    .where(and(eq(clients.demo, false), eq(clientMembers.email, email)))
    .orderBy(asc(clients.id));
  return rows.map((r) => r.client);
}

export async function pickClient(main: Db, req: PortalRequest): Promise<Client> {
  const mine = await clientsFor(main, req.viewer);
  const client = req.client ? mine.find((c) => c.id === req.client) : mine[0];
  if (!client)
    throw new PortalRefusal(
      isDemo(req.viewer) ? "no demo is set up" : "this login has no client",
      isDemo(req.viewer) ? 404 : 403,
    );
  return client;
}

/** A change: never by the demo, never to the demo client. */
export async function pickForWrite(
  main: Db,
  req: PortalRequest,
): Promise<{ client: Client; viewer: SignedViewer }> {
  const viewer = req.viewer;
  if (isDemo(viewer)) throw new PortalRefusal("the demo is read-only", 403);
  const client = await pickClient(main, req);
  if (client.demo) throw new PortalRefusal("the demo is read-only", 403);
  return { client, viewer };
}

export interface Me {
  /** `demo`: the demo firm, which refuses writes wherever it's looked at. */
  /** `look`: the portal's look for that client, when one is set (`clients.look`). */
  /** `installed`: its components (`clients.products` keys); an app shows only for these. */
  /** `can`: what this login may do there (`@wren/core/access`); `role`: a member's role there. */
  clients: {
    id: string;
    name: string;
    demo?: true;
    look?: unknown;
    installed: string[];
    can: Permission[];
    role?: RoleId;
    /** Each portal flag's variant for this login there (`./flags.ts`); none on the demo. */
    flags: Record<string, string>;
    /** Grants past a built-in role (a custom role's rows, extras): the web checks targets with them. */
    grants?: Grant[];
  }[];
  demo: boolean;
  /** Wren's team: every client, and the tools to post to them. */
  operator: boolean;
  /** A team login's role, and what it may do in Wren's own apps. */
  team?: { role: RoleId; wren: Permission[]; flags: Record<string, string>; grants?: Grant[] };
  /** Under View as: who this is, where, and whether changes go through (designs/2026-10-14-view-as.md). */
  as?: {
    client: string;
    /** The client's name, or Wren's. */
    name: string;
    /** Their email, or "someone new as member". */
    who: string;
    role: RoleId;
    act: boolean;
    sandbox: boolean;
  };
}

/** Who you are to the portal. The demo host sees its client as `demoName`, never its real name. */
export async function portalMe(
  main: Db,
  viewer: Viewer,
  demoName: string,
  /** False under View as: looking as someone isn't them signing in. */
  touch = true,
): Promise<Me> {
  const mine = await clientsFor(main, viewer);
  if (!isDemo(viewer) && touch) await touchMember(main, viewer.email);
  const team = isDemo(viewer) ? undefined : viewer.team;
  // Under View as, what the guard read is the whole answer: a role-only view has no rows to read.
  const viewing = isDemo(viewer) ? undefined : viewer.as;
  const held = viewing && !isDemo(viewer) ? viewer.access : undefined;
  const member = held && "member" in held ? held : null;
  const seat = isOperator(viewer)
    ? {
        team: team?.role ?? "admin",
        clients: team?.clients ?? null,
        grants: await grantsFor(main, (viewer as SignedViewer).email, team?.role ?? "admin"),
      }
    : null;
  const roles = new Map(
    seat || isDemo(viewer)
      ? []
      : member
        ? [[member.client, member.member]]
        : (
            await main
              .select({ client: clientMembers.clientId, role: clientMembers.role })
              .from(clientMembers)
              .where(eq(clientMembers.email, normalEmail(viewer.email)))
          ).map((r) => [r.client, r.role]),
  );
  const extras = new Map<string, Grant[]>();
  if (member) extras.set(member.client, [...(member.grants ?? [])]);
  else if (!seat && !isDemo(viewer))
    for (const [id, role] of roles) extras.set(id, await grantsFor(main, viewer.email, role, id));
  const whoAt = (id: string): Who => {
    if (isDemo(viewer)) return { demo: true };
    // The sandbox's cap and the like ride on what the guard read.
    if (held) return member && member.client !== id ? null : held;
    if (seat) return seat;
    const role = roles.get(id);
    return role ? { member: role, client: id, grants: extras.get(id) ?? [] } : null;
  };
  // Portal flags, each login's own: the demo gets none, so it shows released things alone.
  const defs = isDemo(viewer)
    ? []
    : (await main.select().from(flags)).filter((f) => f.surface !== "site");
  const flagsAt = (id: string) =>
    evaluateFlags(defs, subjectOf(whoAt(id), isDemo(viewer) ? null : viewer.email, id));
  return {
    clients: mine.map((c) => {
      const role = roles.get(c.id);
      return {
        id: c.id,
        name: isDemo(viewer) ? demoName : c.name,
        ...(c.demo ? { demo: true as const } : {}),
        ...(c.look != null ? { look: c.look } : {}),
        installed: Object.keys(c.products),
        can: granted(whoAt(c.id), c.id),
        ...(role ? { role } : {}),
        flags: flagsAt(c.id),
        ...(extras.get(c.id)?.length ? { grants: extras.get(c.id) ?? [] } : {}),
      };
    }),
    demo: isDemo(viewer),
    operator: isOperator(viewer),
    ...(viewing
      ? {
          as: {
            client: viewing.client,
            name:
              viewing.client === WREN
                ? "Wren"
                : (mine.find((c) => c.id === viewing.client)?.name ?? viewing.client),
            who: viewing.who,
            role: viewing.role,
            act: viewing.act,
            sandbox: viewing.sandbox,
          },
        }
      : {}),
    ...(seat
      ? {
          team: {
            role: seat.team,
            wren: granted(seat, WREN),
            flags: flagsAt(WREN),
            ...(seat.grants.length ? { grants: seat.grants } : {}),
          },
        }
      : {}),
  };
}

/** A refusal as Restate's terminal error: its status, and its field in the metadata the ingress returns. */
export const terminalOf = (err: PortalRefusal): restate.TerminalError =>
  new restate.TerminalError(err.message, {
    errorCode: err.status,
    ...(err.field || err.code
      ? {
          metadata: {
            ...(err.field ? { field: err.field } : {}),
            ...(err.code ? { code: err.code } : {}),
          },
        }
      : {}),
  });

/** Run a handler; a refusal becomes Restate's terminal error with the status the Worker returns. */
export async function answer<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof PortalRefusal) throw terminalOf(err);
    throw err;
  }
}
