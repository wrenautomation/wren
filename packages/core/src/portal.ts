/**
 * Who is asking the portal, and which client they get. Every portal service
 * (delivery, and one per product) picks the client here, so a login only ever
 * reaches its own clients. The edge Worker sets the viewer; the browser can't.
 */
import * as restate from "@restatedev/restate-sdk";
import type { Db } from "@wren/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { TeamRole, Who } from "./access.js";
import { normalEmail, touchMember } from "./clients/index.js";
import { type Client, clientMembers, clients, operators } from "./clients/schema.js";

/** A team login's row, read fresh: its role and its clients (null = every client). */
export interface TeamSeat {
  role: TeamRole;
  clients: string[] | null;
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
