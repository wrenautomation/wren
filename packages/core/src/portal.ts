/**
 * Who is asking the portal, and which client they get. Every portal service
 * (delivery, and one per product) picks the client here, so a login only ever
 * reaches its own clients. The edge Worker sets the viewer; the browser can't.
 */
import * as restate from "@restatedev/restate-sdk";
import type { Db } from "@wren/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  can,
  channelsIn,
  type Grant,
  granted,
  type Need,
  needOf,
  type Permission,
  type RoleId,
  type RouteApps,
  routeAt,
  type Target,
  type Who,
  WREN,
} from "./access.js";
import { normalEmail, touchMember } from "./clients/index.js";
import { type Client, clientMembers, clients, operators } from "./clients/schema.js";
import { evaluateFlags, subjectOf } from "./flags.js";
import { grantsFor } from "./grants.js";
import { handlerForm, serviceHandler } from "./restate/form.js";
import { flags } from "./schema.js";

/** A team login's row, read fresh: its role and its clients (null = every client). */
export interface TeamSeat {
  role: RoleId;
  clients: readonly string[] | null;
}

/**
 * An email our sign-in vouched for, or anyone on the demo host. `operator` comes from the token;
 * the access guard overwrites it, and sets `team` and `access`, from a fresh read before any
 * handler runs. `access` is the whole answer, grants and all, that `canAt` checks targets with.
 */
export type Viewer =
  | { email: string; operator?: boolean; team?: TeamSeat; access?: Who }
  | { demo: true };
export type SignedViewer = Exclude<Viewer, { demo: true }>;

export interface PortalRequest {
  viewer: Viewer;
  /** Which of the viewer's clients; the first when omitted. */
  client?: string;
  /** An operator looking as the client would: no internal notes, no team tools. */
  asClient?: boolean;
  /** View as: an admin or owner reads as one of their people, read only (`viewAsOf`). */
  viewAs?: string;
}

/** A refusal the Worker passes on with its status. */
export class PortalRefusal extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 503,
  ) {
    super(message);
  }
}

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
  const seat = await teamSeat(main, viewer.email);
  if (seat) {
    const grants = await grantsFor(main, viewer.email, seat.role);
    return { team: seat.role, clients: seat.clients, ...(grants.length ? { grants } : {}) };
  }
  const [row] = await main
    .select({ role: clientMembers.role, client: clientMembers.clientId })
    .from(clientMembers)
    .innerJoin(clients, eq(clientMembers.clientId, clients.id))
    .where(
      and(
        eq(clients.demo, false),
        eq(clientMembers.email, normalEmail(viewer.email)),
        client === undefined ? undefined : eq(clientMembers.clientId, client),
      ),
    )
    .orderBy(asc(clients.id))
    .limit(1);
  if (!row) return null;
  const grants = await grantsFor(main, viewer.email, row.role, row.client);
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
  const viewer =
    asked === undefined || asked === null || asked === ""
      ? req.viewer
      : await viewAsOf(main, req.viewer, asked, permission);
  const who = await whoIs(main, viewer, wren ? undefined : named);
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
        }
      : { email: viewer.email, ...(who ? { access: who } : {}) };
  return { ...req, viewer: fresh };
}

/**
 * View as (designs/2026-10-06-scoped-access.md): the person `as`, for a route that only reads.
 * An admin may view as a teammate; an admin or owner as a client's person, when they manage
 * every client that person is in, so nothing beyond their own workspaces shows.
 */
export async function viewAsOf(
  main: Db,
  real: Viewer,
  as: unknown,
  permission: Permission,
): Promise<SignedViewer> {
  if (isDemo(real)) throw new PortalRefusal("the demo is read-only", 403);
  if (typeof as !== "string" || as.length > 254) throw new PortalRefusal("view as: say who", 400);
  if (permission !== "read") throw new PortalRefusal("view as is read-only", 403);
  const email = normalEmail(as);
  if (await teamSeat(main, email)) {
    if (!can(await whoIs(main, real), "team", WREN))
      throw new PortalRefusal("only an admin views as a teammate", 403);
    return { email, operator: true };
  }
  const where = await main
    .select({ client: clientMembers.clientId })
    .from(clientMembers)
    .where(eq(clientMembers.email, email));
  if (!where.length) throw new PortalRefusal("no such person", 404);
  for (const { client } of where)
    if (!can(await whoIs(main, real, client), "manage", { client }))
      throw new PortalRefusal("you can view as your own people only", 403);
  return { email };
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
    const run = async (ctx: restate.Context, req: PortalRequest) =>
      fn(ctx, await answer(() => guard(o.main, need, req, o.unnamed, routeAt(o.apps, key))));
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
      : (
          await main
            .select({ client: clientMembers.clientId, role: clientMembers.role })
            .from(clientMembers)
            .where(eq(clientMembers.email, normalEmail(viewer.email)))
        ).map((r) => [r.client, r.role]),
  );
  const extras = new Map<string, Grant[]>();
  if (!seat && !isDemo(viewer))
    for (const [id, role] of roles) extras.set(id, await grantsFor(main, viewer.email, role, id));
  const whoAt = (id: string): Who => {
    if (isDemo(viewer)) return { demo: true };
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

/** Run a handler; a refusal becomes Restate's terminal error with the status the Worker returns. */
export async function answer<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof PortalRefusal)
      throw new restate.TerminalError(err.message, { errorCode: err.status });
    throw err;
  }
}
