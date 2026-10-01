/**
 * Who is asking the portal, and which client they get. Every portal service
 * (delivery, and one per product) picks the client here, so a login only ever
 * reaches its own clients. The edge Worker sets the viewer; the browser can't.
 */
import * as restate from "@restatedev/restate-sdk";
import type { Db } from "@wren/db";
import { and, asc, eq } from "drizzle-orm";
import { normalEmail, touchMember } from "./clients/index.js";
import { type Client, clientMembers, clients } from "./clients/schema.js";

/** An email our sign-in vouched for (operators see every client), or anyone on the demo host. */
export type Viewer = { email: string; operator?: boolean } | { demo: true };
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
    readonly status: 400 | 403 | 404 | 409,
  ) {
    super(message);
  }
}

export const isDemo = (v: Viewer): v is { demo: true } => "demo" in v;
export const isOperator = (v: Viewer): boolean => !isDemo(v) && v.operator === true;
/** Sees what only Wren's team sees: an operator, unless they asked to look as the client. */
export const seesInternal = (req: PortalRequest): boolean =>
  isOperator(req.viewer) && req.asClient !== true;

/** The clients this viewer may open: the demo's, every one for an operator, else their memberships. */
export async function clientsFor(main: Db, viewer: Viewer): Promise<Client[]> {
  if (isDemo(viewer))
    return main.select().from(clients).where(eq(clients.demo, true)).orderBy(asc(clients.id));
  if (viewer.operator) return main.select().from(clients).orderBy(asc(clients.id));
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
  clients: { id: string; name: string }[];
  demo: boolean;
  /** Wren's team: every client, and the tools to post to them. */
  operator: boolean;
}

/** Who you are to the portal. The demo host sees its client as `demoName`, never its real name. */
export async function portalMe(main: Db, viewer: Viewer, demoName: string): Promise<Me> {
  const mine = await clientsFor(main, viewer);
  if (!isDemo(viewer)) await touchMember(main, viewer.email);
  return {
    clients: mine.map((c) => ({ id: c.id, name: isDemo(viewer) ? demoName : c.name })),
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
