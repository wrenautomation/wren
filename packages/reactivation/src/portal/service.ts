/**
 * The portal API (R14) as a Restate service on the worker, the way the phone
 * app reads SMS: the edge Worker checks who is asking and passes the viewer,
 * this picks the client and reads its database in a read-only transaction.
 * The demo (R15) needs no login and every answer goes through the mask.
 */
import * as restate from "@restatedev/restate-sdk";
import { type Client, clients } from "@wren/core/clients";
import type { Db, Queryable } from "@wren/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { type CrmHealth, crmHealth } from "../crm/health.js";
import { makeMask } from "./mask.js";
import {
  listNames,
  type Overview,
  type PeopleFilter,
  type PeoplePage,
  type PersonView,
  portalOverview,
  portalPeople,
  portalPerson,
  portalRaw,
  type RawPage,
} from "./views.js";

/**
 * Who is asking: an email Cloudflare Access vouched for, or anyone on the demo
 * host. The Worker marks Wren's own logins as operators: they see every client.
 */
export type Viewer = { email: string; operator?: boolean } | { demo: true };

export interface PortalRequest {
  viewer: Viewer;
  /** Which of the viewer's clients; the first when omitted. */
  client?: string;
}

export interface PortalDeps {
  /** The main database: the client registry. */
  main: Db;
  /** A client's own database (the worker's per-client pool). */
  open(client: Client): Db;
}

export class PortalRefusal extends Error {
  constructor(
    message: string,
    readonly status: 403 | 404,
  ) {
    super(message);
  }
}

export interface Me {
  clients: { id: string; name: string }[];
  demo: boolean;
}

/** The demo's name on screen; the agency it was built from is never named. */
export const DEMO_NAME = "Sample recruiting firm";

async function clientsFor(main: Db, viewer: Viewer): Promise<Client[]> {
  if ("demo" in viewer)
    return main.select().from(clients).where(eq(clients.demo, true)).orderBy(asc(clients.id));
  if (viewer.operator) return main.select().from(clients).orderBy(asc(clients.id));
  const email = viewer.email.trim().toLowerCase();
  if (!email) return [];
  return main
    .select()
    .from(clients)
    .where(and(eq(clients.demo, false), sql`${email} = any(${clients.portalEmails})`))
    .orderBy(asc(clients.id));
}

async function pick(main: Db, req: PortalRequest): Promise<Client> {
  const mine = await clientsFor(main, req.viewer);
  const client = req.client ? mine.find((c) => c.id === req.client) : mine[0];
  if (!client)
    throw new PortalRefusal(
      "demo" in req.viewer ? "no demo is set up" : "this login has no client",
      "demo" in req.viewer ? 404 : 403,
    );
  return client;
}

/** Read one client's database, read-only, masked when it is the demo. */
async function read<T>(
  deps: PortalDeps,
  req: PortalRequest,
  view: (db: Queryable) => Promise<T>,
): Promise<T> {
  const client = await pick(deps.main, req);
  const db = deps.open(client);
  return db.transaction(
    async (tx) => {
      const out = await view(tx);
      return client.demo ? makeMask(await listNames(tx))(out) : out;
    },
    { accessMode: "read only" },
  );
}

/** A browser can send anything: a page offset is a whole number from 0 to 1,000,000. */
const offsetOf = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 1_000_000) : undefined;
};
const textOf = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v : undefined;
/** A person id that isn't a positive whole number names nobody. */
const idOf = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : Number.NaN;
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new PortalRefusal("no such person on this list", 404);
  return n;
};
const opt = <K extends string, V>(k: K, v: V | undefined) =>
  (v === undefined ? {} : { [k]: v }) as Partial<Record<K, V>>;

/** The handlers as plain functions: the service wraps them, tests call them. */
export function portalApi(deps: PortalDeps) {
  return {
    me: async (req: PortalRequest): Promise<Me> => {
      const mine = await clientsFor(deps.main, req.viewer);
      const demo = "demo" in req.viewer;
      return {
        clients: mine.map((c) => ({ id: c.id, name: demo ? DEMO_NAME : c.name })),
        demo,
      };
    },
    overview: (req: PortalRequest): Promise<Overview> => read(deps, req, portalOverview),
    health: (req: PortalRequest): Promise<CrmHealth> => read(deps, req, (db) => crmHealth(db)),
    people: (
      req: PortalRequest & { filter?: PeopleFilter; offset?: number; q?: string },
    ): Promise<PeoplePage> =>
      read(deps, req, (db) =>
        portalPeople(db, {
          ...opt("filter", textOf(req.filter) as PeopleFilter | undefined),
          ...opt("offset", offsetOf(req.offset)),
          ...opt("q", textOf(req.q)),
          searchNames: !("demo" in req.viewer),
        }),
      ),
    person: async (req: PortalRequest & { personId: number }): Promise<PersonView> => {
      const id = idOf(req.personId);
      const view = await read(deps, req, (db) => portalPerson(db, id));
      if (!view) throw new PortalRefusal("no such person on this list", 404);
      return view;
    },
    raw: (
      req: PortalRequest & { via?: string; kind?: string; offset?: number },
    ): Promise<RawPage> =>
      read(deps, req, (db) =>
        portalRaw(db, {
          ...opt("via", textOf(req.via)),
          ...opt("kind", textOf(req.kind)),
          ...opt("offset", offsetOf(req.offset)),
        }),
      ),
  };
}

export type PortalApi = ReturnType<typeof portalApi>;
/** What the answers look like, for the portal's web app. */
export type { CrmHealth } from "../crm/health.js";
export type { RankedContact } from "../ranked.js";
export type { Reason } from "../score.js";
export { PORTAL_ROUTES } from "./routes.js";
export type {
  Now,
  Overview,
  PeopleFilter,
  PeoplePage,
  PersonRow,
  PersonView,
  RawFinding,
  RawPage,
  Source,
} from "./views.js";

/**
 * Plain reads with no journal: a retry just reads again, and pages stay out of
 * Restate's storage. Refusals are terminal, with the status the Worker returns.
 */
export function makeReactivationPortal(deps: PortalDeps) {
  const api = portalApi(deps);
  const answer = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof PortalRefusal)
        throw new restate.TerminalError(err.message, { errorCode: err.status });
      throw err;
    }
  };
  type Req<K extends keyof PortalApi> = Parameters<PortalApi[K]>[0];
  return restate.service({
    name: "ReactivationPortal",
    handlers: {
      me: (_: restate.Context, req: Req<"me">) => answer(() => api.me(req)),
      overview: (_: restate.Context, req: Req<"overview">) => answer(() => api.overview(req)),
      health: (_: restate.Context, req: Req<"health">) => answer(() => api.health(req)),
      people: (_: restate.Context, req: Req<"people">) => answer(() => api.people(req)),
      person: (_: restate.Context, req: Req<"person">) => answer(() => api.person(req)),
      raw: (_: restate.Context, req: Req<"raw">) => answer(() => api.raw(req)),
    },
  });
}
