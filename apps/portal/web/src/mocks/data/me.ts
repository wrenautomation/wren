/**
 * Who is signed in, for page stories: a client's owner with every app, or Wren's admin. Synthetic
 * names on `.example` addresses; the repo is public.
 */
import { MEMBER_GRANTS, PERMISSIONS } from "@wren/core/access";
import type { Me } from "../../api.js";
import { MODULES } from "../../modules/index.js";

/** Every component an app belongs to, so each client app shows. */
const EVERY = [...new Set(MODULES.flatMap((m) => (m.component ? [m.component] : [])))];

export const CLIENT = { id: "acme", name: "Acme Plumbing" };

/** A client's owner: one workspace, every app installed. */
export const OWNER: Me = {
  clients: [
    {
      ...CLIENT,
      installed: EVERY,
      can: [...MEMBER_GRANTS.owner],
      role: "owner",
      flags: {},
    },
  ],
  demo: false,
  operator: false,
};

/** Wren's admin: Wren's own apps, and the client beside them. */
export const ADMIN: Me = {
  ...OWNER,
  operator: true,
  team: { role: "admin", wren: [...PERMISSIONS], flags: {} },
};
