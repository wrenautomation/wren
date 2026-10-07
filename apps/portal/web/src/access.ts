/**
 * This login's access in one workspace, as `delivery/me` sent it: the same `Who` the server's
 * guard reads, so the web's `canAt` and the server's `can` answer alike
 * (designs/2026-10-06-scoped-access.md). Left out on the demo: its `can` list is all it has.
 */
import type { Who } from "@wren/core/access";
import type { Me } from "./api.js";
import { WREN } from "./module.js";

export function whoAt(me: Me | null | undefined, id: string | undefined): Who | undefined {
  if (!me || me.demo || !id) return undefined;
  if (me.team) {
    const grants = me.team.grants;
    return { team: me.team.role, clients: null, ...(grants ? { grants } : {}) };
  }
  if (id === WREN.id) return undefined;
  const c = me.clients.find((x) => x.id === id);
  if (!c?.role) return undefined;
  return { member: c.role, client: id, ...(c.grants ? { grants: c.grants } : {}) };
}
