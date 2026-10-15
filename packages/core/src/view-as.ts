/**
 * View as's console calls (designs/2026-10-14-view-as.md): who the picker offers, and the
 * sandbox, a blank new client made once and wiped on demand. The guard itself is `viewAsOf` in
 * ./portal.ts. The sandbox is synthetic: no people, no accounts, sends off for good (a check on
 * `clients` holds it), so nothing there contacts anyone.
 */
import type * as restate from "@restatedev/restate-sdk";
import { atomic, type Db, dropDatabase, setAuditActor } from "@wren/db";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { MEMBER_GRANTS, type RoleId, TEAM_GRANTS, WREN } from "./access.js";
import { addClient, findClient } from "./clients/index.js";
import {
  clientMembers,
  clients as clientRows,
  grants,
  operators,
  roles,
} from "./clients/schema.js";
import type { Component, LoopKey } from "./components.js";
import {
  answer,
  clientsFor,
  isDemo,
  PortalRefusal,
  type PortalRequest,
  type SignedViewer,
  seesInternal,
  teamCan,
  viewingAs,
} from "./portal.js";

/** The sandbox's id: reserved, so no real client takes it. */
export const SANDBOX = "sandbox";
/** What the picker calls it. */
export const SANDBOX_NAME = "New client";

export interface ViewAsPerson {
  email: string;
  role: RoleId;
}
export interface ViewAsRole {
  id: RoleId;
  name: string;
}
export interface ViewAsPlace {
  id: string;
  name: string;
  kind: "client" | "demo" | "sandbox";
  people: ViewAsPerson[];
  roles: ViewAsRole[];
}
/** What the picker offers: the clients this seat reaches, and Wren's team for an admin. */
export interface ViewAsChoices {
  clients: ViewAsPlace[];
  team?: { people: ViewAsPerson[]; roles: ViewAsRole[] };
  /** The sandbox is made. */
  sandbox: boolean;
  /** This viewer may Act: an admin. */
  act: boolean;
}

export function viewAsApi({
  main,
  mainUrl,
  components = [],
  bound = () => true,
}: {
  main: Db;
  mainUrl?: string | undefined;
  components?: readonly Component[] | undefined;
  bound?: ((service: string) => boolean) | undefined;
}) {
  /** The team's own, never under View as: the picker is the operator's. */
  const operator = (req: PortalRequest): SignedViewer => {
    if (!seesInternal(req) || isDemo(req.viewer))
      throw new PortalRefusal("that's for Wren's team", 403);
    if (viewingAs(req)) throw new PortalRefusal("exit View as first", 403);
    return req.viewer;
  };
  /** The sandbox's maker: an admin, on a worker that can make databases. */
  const admin = (req: PortalRequest): { by: string; url: string } => {
    const v = operator(req);
    if (!teamCan(req, "manage", WREN)) throw new PortalRefusal("only an admin can do that", 403);
    if (!mainUrl) throw new PortalRefusal("this worker can't make databases", 503);
    return { by: v.email, url: mainUrl };
  };
  const make = (url: string, by: string) =>
    addClient(main, url, { id: SANDBOX, name: SANDBOX_NAME, sandbox: true }, by);

  return {
    /** Who the picker offers. */
    async viewAsList(req: PortalRequest): Promise<ViewAsChoices> {
      const v = operator(req);
      const list = await clientsFor(main, v);
      const ids = list.map((c) => c.id);
      const members = ids.length
        ? await main
            .select({
              client: clientMembers.clientId,
              email: clientMembers.email,
              role: clientMembers.role,
            })
            .from(clientMembers)
            .where(inArray(clientMembers.clientId, ids))
            .orderBy(asc(clientMembers.email))
        : [];
      const roleRows = await main
        .select({ id: roles.id, client: roles.client, name: roles.name })
        .from(roles)
        .where(or(isNull(roles.client), inArray(roles.client, [...ids, WREN])))
        .orderBy(asc(roles.createdAt), asc(roles.id));
      const rolesOf = (client: string): ViewAsRole[] => {
        const side: Record<string, unknown> = client === WREN ? TEAM_GRANTS : MEMBER_GRANTS;
        const built = Object.keys(side).flatMap((id) => {
          const r = roleRows.find((x) => x.client === null && x.id === id);
          return [{ id, name: r?.name ?? id }];
        });
        const own = roleRows
          .filter((r) => r.client === client)
          .map((r) => ({ id: r.id, name: r.name }));
        return [...built, ...own];
      };
      const clients: ViewAsPlace[] = list.map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.sandbox ? "sandbox" : c.demo ? "demo" : "client",
        people: members
          .filter((m) => m.client === c.id)
          .map((m) => ({ email: m.email, role: m.role })),
        roles: rolesOf(c.id),
      }));
      const team = teamCan(req, "team", WREN)
        ? {
            people: (
              await main
                .select({ email: operators.email, role: operators.role })
                .from(operators)
                .orderBy(asc(operators.email))
            ).filter((p) => p.email !== v.email),
            roles: rolesOf(WREN),
          }
        : undefined;
      return {
        clients,
        ...(team ? { team } : {}),
        sandbox: list.some((c) => c.id === SANDBOX && c.sandbox),
        act: teamCan(req, "team", WREN),
      };
    },

    /** Make the sandbox once; made, it comes back as it is. */
    async sandboxMake(req: PortalRequest): Promise<{ id: string; name: string }> {
      const { by, url } = admin(req);
      const found = await findClient(main, SANDBOX);
      if (found && !found.sandbox)
        throw new PortalRefusal("a real client holds the sandbox's id", 409);
      const c = found ?? (await make(url, by));
      return { id: c.id, name: c.name };
    },

    /**
     * Start over: the sandbox's row, its people, roles and grants, and its database go, then a
     * blank one is made in their place. Returns the loops its parts ran, for the caller to stop.
     */
    async sandboxReset(req: PortalRequest): Promise<{ id: string; name: string; stop: LoopKey[] }> {
      const { by, url } = admin(req);
      const found = await findClient(main, SANDBOX);
      if (found && !found.sandbox)
        throw new PortalRefusal("a real client holds the sandbox's id", 409);
      const stop = found
        ? components
            .filter((x) => x.id in found.products)
            .flatMap((x) => {
              const parsed = x.settings.safeParse(found.products[x.id]);
              return parsed.success
                ? x.clientLoops(SANDBOX, parsed.data as Record<string, unknown>)
                : [];
            })
            .filter((l) => bound(l.service))
        : [];
      if (found) {
        await atomic(main, async (tx) => {
          await setAuditActor(tx, by);
          // Members go with the row (cascade); then the roles they held, and grants there.
          await tx
            .delete(clientRows)
            .where(and(eq(clientRows.id, SANDBOX), eq(clientRows.sandbox, true)));
          await tx.delete(roles).where(eq(roles.client, SANDBOX));
          await tx.delete(grants).where(eq(grants.client, SANDBOX));
        });
        await dropDatabase(main, found.database);
      }
      const c = await make(url, by);
      return { id: c.id, name: c.name, stop };
    },
  };
}

export type ViewAsApi = ReturnType<typeof viewAsApi>;

/** What `stop` on a loop object takes. */
type LoopStop = { stop: (ctx: restate.ObjectContext) => Promise<unknown> };

/** The Restate handlers: a make or a reset is one journaled step, so a retry finds it done. */
export function viewAsHandlers(api: ViewAsApi) {
  return {
    viewAsList: (_: restate.Context, req: PortalRequest) => answer(() => api.viewAsList(req)),
    sandboxMake: (ctx: restate.Context, req: PortalRequest) =>
      answer(() => ctx.run("make sandbox", () => answer(() => api.sandboxMake(req)))),
    sandboxReset: async (ctx: restate.Context, req: PortalRequest) => {
      const out = await answer(() =>
        ctx.run("start sandbox over", () => answer(() => api.sandboxReset(req))),
      );
      for (const l of out.stop) ctx.objectSendClient<LoopStop>({ name: l.service }, l.key).stop();
      return { id: out.id, name: out.name };
    },
  };
}
