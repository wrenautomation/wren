/** Executions: what Retry and Replay were given, and a hold let go. */
import { serializable, setAuditActor } from "@wren/db";
import { WREN } from "../../access.js";
import { release } from "../../checks.js";
import { REPLAY_MOST } from "../../executor.js";
import {
  isDemo,
  PortalRefusal,
  type PortalRequest,
  type SignedViewer,
  teamCan,
} from "../../portal.js";
import type { ConsoleContext } from "./context.js";

export function executionsHandlers(ctx: ConsoleContext) {
  const { main, team } = ctx;
  return {
    eventToRetry(req: PortalRequest & { id?: unknown }): string {
      team(req);
      if (!teamCan(req, "effect", WREN)) throw new PortalRefusal("your role can't run that", 403);
      if (isDemo(req.viewer)) throw new PortalRefusal("the demo is read-only", 403);
      const id = typeof req.id === "string" ? req.id : "";
      if (!/^[0-9a-f-]{36}$/.test(id)) throw new PortalRefusal("no such event", 404);
      return id;
    },

    /** What Replay was given: up to 200 event ids or `workflow/subject` executions. */
    toReplay(req: PortalRequest & { ids?: unknown }): string[] {
      team(req);
      if (!teamCan(req, "effect", WREN)) throw new PortalRefusal("your role can't run that", 403);
      if (isDemo(req.viewer)) throw new PortalRefusal("the demo is read-only", 403);
      const ids = Array.isArray(req.ids)
        ? req.ids.filter((x): x is string => typeof x === "string" && x.length <= 300)
        : [];
      if (!ids.length) throw new PortalRefusal("pick what to replay", 400);
      if (ids.length > REPLAY_MOST) throw new PortalRefusal(`at most ${REPLAY_MOST} at once`, 400);
      return ids;
    },

    /** Let a hold go: the unit runs again, or the source resumes. */
    async releaseHold(req: PortalRequest & { id?: unknown }): Promise<{ done: number[] }> {
      team(req);
      if (!teamCan(req, "run", WREN)) throw new PortalRefusal("your role can't run that", 403);
      if (isDemo(req.viewer)) throw new PortalRefusal("the demo is read-only", 403);
      const id = Number(req.id);
      if (!Number.isInteger(id) || id <= 0) throw new PortalRefusal("no such hold", 404);
      const rows = await serializable(main, async (tx) => {
        await setAuditActor(tx, (req.viewer as SignedViewer).email);
        return release(tx, [id], (req.viewer as SignedViewer).email);
      });
      if (rows.length === 0) throw new PortalRefusal("it isn't held now", 409);
      return { done: rows.map((r) => r.id) };
    },
  };
}
