/** Notes handlers for who sees a note and where it lives: share, general, transfer, archive, move. */
import { WREN } from "@wren/core/access";
import { clients } from "@wren/core/clients";
import { isOperator, PortalRefusal } from "@wren/core/portal";
import { eq } from "drizzle-orm";
import { isShareRole, TEAM } from "./access.js";
import { idOf, type NotesApiContext, type Req, str } from "./console-context.js";
import { move, setArchived, setGeneral, share, transfer } from "./store.js";
import type { General } from "./types.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function sharingHandlers(notes: NotesApiContext) {
  const { main, byOf, locate, peopleOf, tell, sharesOut } = notes;
  return {
    /** Share with a person, the team, or (from Wren) a client's people; a null role takes it back. */
    async share(req: Req<{ id?: unknown; who?: unknown; role?: unknown }>) {
      const { db, note, home, place } = await locate(req, req.id, "owner");
      const by = byOf(req);
      const who = str(req.who, 200, "who").trim().toLowerCase();
      const role = req.role === null ? null : isShareRole(req.role) ? req.role : undefined;
      if (role === undefined) throw new PortalRefusal("pick view, comment or edit", 400);
      if (who.startsWith("client:")) {
        if (home !== WREN || !isOperator(req.viewer))
          throw new PortalRefusal("only Wren's notes are shared with a client", 400);
        const [c] = await main
          .select({ id: clients.id })
          .from(clients)
          .where(eq(clients.id, who.slice("client:".length)));
        if (!c) throw new PortalRefusal("no such client", 404);
      } else if (who !== TEAM && !EMAIL.test(who))
        throw new PortalRefusal("share with an email, the team, or a client", 400);
      if (who === note.owner.toLowerCase()) throw new PortalRefusal("they own it", 400);
      await share(db, note.id, who, role, by);
      // A mention that waited for this share is mailed now.
      if (role) await tell(home, place);
      return { shares: await sharesOut(db, note.id) };
    },
    /** Who else gets it: only those named, or everyone in the workspace with a role. */
    async general(req: Req<{ id?: unknown; general?: unknown; role?: unknown }>) {
      const { db, note, home, place } = await locate(req, req.id, "owner");
      byOf(req);
      const general: General = req.general === "workspace" ? "workspace" : "private";
      const role = isShareRole(req.role) ? req.role : "view";
      await setGeneral(db, note.id, general, role);
      if (general === "workspace") await tell(home, place);
      return { general, generalRole: role };
    },
    /** A new owner from the workspace's people; the old one keeps edit. */
    async transfer(req: Req<{ id?: unknown; to?: unknown }>) {
      const { db, note, place } = await locate(req, req.id, "owner");
      const by = byOf(req);
      const to = str(req.to, 200, "the new owner").trim().toLowerCase();
      if (!(await peopleOf(place)).some((p) => p.email === to))
        throw new PortalRefusal("they aren't in this workspace", 400);
      await transfer(db, note.id, to, by);
      return { owner: to };
    },
    /** Archive (Docs' trash) or bring back; nothing is deleted. */
    async archive(req: Req<{ id?: unknown; on?: unknown }>) {
      const { db, note } = await locate(req, req.id, "owner");
      byOf(req);
      await setArchived(db, note.id, req.on !== false);
      return { archived: req.on !== false };
    },
    /** Under another note, or back to the top. */
    async move(req: Req<{ id?: unknown; parentId?: unknown }>) {
      const { db, note } = await locate(req, req.id, "edit");
      byOf(req);
      const parent =
        req.parentId === null || req.parentId === undefined ? null : idOf(req.parentId);
      if (parent) {
        const p = await locate(req, parent, "edit");
        if (p.db !== db) throw new PortalRefusal("move it within one workspace", 400);
      }
      await move(db, note.id, parent).catch((err: Error) => {
        throw new PortalRefusal(err.message, 400);
      });
      return { parentId: parent };
    },
  };
}
