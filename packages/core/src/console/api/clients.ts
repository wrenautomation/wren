/** Clients and the team: a new client, Wren's team seats, a client's portal look. */
import { CLIENT_ID, type Queryable, serializable, setAuditActor } from "@wren/db";
import { eq } from "drizzle-orm";
import { TEAM_ROLES, WREN } from "../../access.js";
import {
  addClient,
  clients,
  isOwner,
  LastAdmin,
  normalEmail,
  removeTeamSeat,
  setTeamSeat,
} from "../../clients/index.js";
import { roleFits, roleRefusal } from "../../grants.js";
import {
  isDemo,
  PortalRefusal,
  type PortalRequest,
  pickClient,
  type SignedViewer,
  teamSeat,
  whoIs,
} from "../../portal.js";
import { SANDBOX } from "../../view-as.js";
import type { ConsoleContext } from "./context.js";
import {
  type AddClientRequest,
  type SetLookRequest,
  showcaseIn,
  type TeamSeatRequest,
} from "./requests.js";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** A stored look stays small: inputs, not tokens. */
const LOOK_MAX = 4000;

export function clientsHandlers(ctx: ConsoleContext) {
  const { main, mainUrl, team } = ctx;
  /** A team change in one transaction, logged as the admin's. */
  const teamWrite = async <T>(
    req: TeamSeatRequest,
    change: (tx: Queryable, email: string) => Promise<T>,
  ): Promise<T> => {
    team(req);
    const email = typeof req.email === "string" ? normalEmail(req.email) : "";
    if (!EMAIL.test(email) || email.length > 254)
      throw new PortalRefusal("that isn't an email", 400);
    try {
      return await serializable(main, async (tx) => {
        await setAuditActor(tx, (req.viewer as SignedViewer).email);
        return change(tx, email);
      });
    } catch (err) {
      if (err instanceof LastAdmin) throw new PortalRefusal(err.message, 409);
      throw err;
    }
  };
  /**
   * A seat's client list, each a client or `wren`; undefined leaves it as it is. A form's text
   * ("acme, wren") splits on commas; blank or "all" is every client.
   */
  const clientsOf = async (tx: Queryable, given: unknown): Promise<string[] | null | undefined> => {
    const list =
      typeof given === "string"
        ? given.trim() === "" || given.trim().toLowerCase() === "all"
          ? null
          : given
              .split(",")
              .map((c) => c.trim())
              .filter(Boolean)
        : given;
    if (list === undefined || list === null) return list;
    if (!Array.isArray(list) || !list.every((c) => typeof c === "string"))
      throw new PortalRefusal("clients: a list of client ids, or null for all", 400);
    const known = new Set(
      (await tx.select({ id: clients.id }).from(clients)).map((c) => c.id).concat(WREN),
    );
    const unknown = list.filter((c) => !known.has(c));
    if (unknown.length) throw new PortalRefusal(`no such client: ${unknown.join(", ")}`, 400);
    return list;
  };
  /**
   * A seat change by a teammate below admin (a manager holding `team`): the role given and the
   * one it replaces must both be ones they could hand out, and the clients only ones they see.
   */
  const seatFits = async (
    tx: Queryable,
    req: PortalRequest,
    email: string,
    role: string | undefined,
    list: string[] | null | undefined,
  ) => {
    const by = await whoIs(main, req.viewer);
    if (by && "team" in by && by.team === "admin") return;
    const was = await teamSeat(main, email);
    for (const r of [role ?? (was ? undefined : "operator"), was?.role]) {
      const no = r ? await roleRefusal(tx, by, r, WREN) : null;
      if (no) throw new PortalRefusal(no, 403);
    }
    const mine = by && "team" in by ? by.clients : [];
    const given = list === undefined && !was ? null : list;
    if (
      mine !== null &&
      given !== undefined &&
      (given === null || given.some((c) => !mine.includes(c)))
    )
      throw new PortalRefusal("you can only give clients you see yourself", 403);
  };
  return {
    /** A new client from `req`, checked before any step runs: team only, a plain id, a name. */
    newClient(req: AddClientRequest): { id: string; name: string; by: string } {
      team(req);
      if (!mainUrl) throw new PortalRefusal("this worker can't make databases", 503);
      const id = typeof req.id === "string" ? req.id.trim() : "";
      if (!CLIENT_ID.test(id))
        throw new PortalRefusal("id: a lowercase letter, then up to 39 of a-z, 0-9, _", 400);
      if (id === SANDBOX) throw new PortalRefusal("that id is View as's sandbox", 400);
      const name = typeof req.name === "string" ? req.name.trim() : "";
      if (!name || name.length > 200) throw new PortalRefusal("say the client's name", 400);
      return { id, name, by: (req.viewer as SignedViewer).email };
    },
    /** Make it, or finish a make that failed partway; a client already there comes back as it is. */
    async addClient({ id, name, by }: { id: string; name: string; by: string }) {
      if (!mainUrl) throw new PortalRefusal("this worker can't make databases", 503);
      const c = await addClient(main, mainUrl, { id, name }, by);
      return { id: c.id, name: c.name, demo: c.demo };
    },

    /**
     * Wren's team, by an admin (the guard checks `team`): invite or change a seat, or remove one.
     * The last admin stays; a narrower seat or a removal signs the person out.
     */
    teamSet: (req: TeamSeatRequest) =>
      teamWrite(req, async (tx, email) => {
        const role = req.role;
        if (role !== undefined && (typeof role !== "string" || !(await roleFits(tx, role, WREN))))
          throw new PortalRefusal(`role: one of ${TEAM_ROLES.join(", ")}, or one of Wren's`, 400);
        const list = await clientsOf(tx, req.clients);
        await seatFits(tx, req, email, role, list);
        return setTeamSeat(tx, email, {
          ...(role ? { role } : {}),
          ...(list === undefined ? {} : { clients: list }),
        });
      }),
    teamRemove: (req: TeamSeatRequest) =>
      teamWrite(req, async (tx, email) => {
        await seatFits(tx, req, email, undefined, undefined);
        if (!(await removeTeamSeat(tx, email)))
          throw new PortalRefusal("they aren't on the team", 404);
        return { removed: email };
      }),

    /** Checked here, read by `readTheme` in the browser, which drops what it can't use. */
    async setLook(req: SetLookRequest): Promise<{ client: string; look: unknown }> {
      const viewer = req.viewer;
      if (isDemo(viewer)) throw new PortalRefusal("the demo is read-only", 403);
      const look = req.look;
      const shape = look === null || typeof look === "string" || typeof look === "object";
      if (!shape || Array.isArray(look) || JSON.stringify(look).length > LOOK_MAX)
        throw new PortalRefusal("a look is a preset's name or an object of tokens", 400);
      if (showcaseIn(look))
        throw new PortalRefusal("showcase looks are Wren's own; a client's stays plain", 400);
      // An operator may pick any client; anyone else only their own.
      const client = await pickClient(main, req);
      if (!viewer.operator && !(await isOwner(main, client.id, viewer.email)))
        throw new PortalRefusal("only an owner of this account can do that", 403);
      await serializable(main, async (tx) => {
        await setAuditActor(tx, viewer.email);
        await tx.update(clients).set({ look }).where(eq(clients.id, client.id));
      });
      return { client: client.id, look };
    },
  };
}
