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
  type Need,
  needOf,
  type Permission,
  type TeamRole,
  type Who,
  WREN,
} from "./access.js";
import { normalEmail, touchMember } from "./clients/index.js";
import { type Client, clientMembers, clients, operators } from "./clients/schema.js";
import { handlerForm, serviceHandler } from "./restate/form.js";

/** A team login's row, read fresh: its role and its clients (null = every client). */
export interface TeamSeat {
  role: TeamRole;
  clients: readonly string[] | null;
}

/**
 * An email our sign-in vouched for, or anyone on the demo host. `operator` comes from the token;
 * the access guard overwrites it, and sets `team`, from a fresh read before any handler runs.
 */
export type Viewer = { email: string; operator?: boolean; team?: TeamSeat } | { demo: true };
export type SignedViewer = Exclude<Viewer, { demo: true }>;

export interface PortalRequest {
  viewer: Viewer;
  /** Which of the viewer's clients; the first when omitted. */
  client?: string;
  /** An operator looking as the client would: no internal notes, no team tools. */
  asClient?: boolean;
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
  if (seat) return { team: seat.role, clients: seat.clients };
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
  return row ? { member: row.role, client: row.client } : null;
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
 * checked at Wren's own apps whatever client is named.
 */
export async function guard<R extends PortalRequest>(
  main: Db,
  need: Need,
  req: R,
  unnamed: Unnamed,
): Promise<R> {
  const { permission, wren } = needOf(need);
  const named = typeof req.client === "string" ? req.client : undefined;
  const viewer = req.viewer;
  if (!viewer || typeof viewer !== "object") throw new PortalRefusal("sign in", 403);
  const who = await whoIs(main, viewer, wren ? undefined : named);
  // `wren` is for the team: a client's people naming no client stay on their own.
  const team = who !== null && "team" in who;
  const client = wren ? WREN : (named ?? (unnamed === "wren" && team ? WREN : undefined));
  if (!can(who, permission, client))
    throw new PortalRefusal(
      isDemo(viewer)
        ? "the demo is read-only"
        : can(who, "read", client)
          ? "your role can't do that"
          : "no access",
      403,
    );
  if (isDemo(viewer)) return req;
  const fresh: SignedViewer =
    who && "team" in who
      ? { email: viewer.email, operator: true, team: { role: who.team, clients: who.clients } }
      : { email: viewer.email };
  return { ...req, viewer: fresh };
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
      fn(ctx, await answer(() => guard(o.main, need, req, o.unnamed)));
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
export function teamCan(req: PortalRequest, p: Permission, client: string): boolean {
  if (!seesInternal(req) || isDemo(req.viewer)) return false;
  const team = req.viewer.team;
  return can({ team: team?.role ?? "admin", clients: team?.clients ?? null }, p, client);
}

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
  clients: { id: string; name: string; demo?: true; look?: unknown; installed: string[] }[];
  demo: boolean;
  /** Wren's team: every client, and the tools to post to them. */
  operator: boolean;
}

/** Who you are to the portal. The demo host sees its client as `demoName`, never its real name. */
export async function portalMe(main: Db, viewer: Viewer, demoName: string): Promise<Me> {
  const mine = await clientsFor(main, viewer);
  if (!isDemo(viewer)) await touchMember(main, viewer.email);
  return {
    clients: mine.map((c) => ({
      id: c.id,
      name: isDemo(viewer) ? demoName : c.name,
      ...(c.demo ? { demo: true as const } : {}),
      ...(c.look != null ? { look: c.look } : {}),
      installed: Object.keys(c.products),
    })),
    demo: isDemo(viewer),
    operator: isOperator(viewer),
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
