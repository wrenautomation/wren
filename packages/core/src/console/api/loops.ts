/** Loops and agents: Restate's admin for the team, the loop list, the built parts, Decide's numbers. */
import { STAGES } from "../../components.js";
import { decideStats, type KindStats } from "../../decide/stats.js";
import { PortalRefusal, type PortalRequest } from "../../portal.js";
import { type AgentLine, LOOPS_SQL, type LoopRow, loopsOf, type SetLoopRequest } from "../loops.js";
import type { ConsoleContext } from "./context.js";

export function loopsHandlers(ctx: ConsoleContext) {
  const { main, components, team, adminFor } = ctx;
  return {
    adminFor,
    loops: async (req: PortalRequest): Promise<LoopRow[]> =>
      loopsOf(await adminFor(req)(LOOPS_SQL)),
    /**
     * Every built part that runs for Wren (its own, or a client part on Wren's settings), in the
     * stages' order.
     */
    agents: async (req: PortalRequest): Promise<AgentLine[]> => {
      team(req);
      const order = Object.keys(STAGES);
      return components
        .filter((c) => !c.planned && (c.for === "wren" || c.wrenSettings))
        .sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage))
        .map((c) => ({
          id: c.id,
          name: c.name,
          blurb: c.blurb,
          icon: c.icon,
          stage: c.stage,
          department: STAGES[c.stage],
          ready: c.ready,
          loops: c.provides.loops,
          counts: c.out.flatMap((p) =>
            p.count ? [{ port: p.id, label: p.label, ...p.count }] : [],
          ),
        }));
    },

    /** Decide's numbers per kind (designs/2026-10-16-decide.md): his calls, agreement, spend. */
    decisions: async (req: PortalRequest): Promise<KindStats[]> => {
      team(req);
      return decideStats(main);
    },
    pick(req: SetLoopRequest, loops: readonly LoopRow[]): LoopRow {
      if (typeof req.run !== "boolean") throw new PortalRefusal("say run: true or false", 400);
      const loop = loops.find((l) => l.service === req.service && l.key === req.key);
      if (!loop) throw new PortalRefusal("no such loop", 404);
      return loop;
    },
  };
}
