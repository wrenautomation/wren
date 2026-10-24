/**
 * The Call form over Restate's handlers: the read the call journals, the handler it names and
 * whether this teammate may call it, and the runs row around the call.
 */
import { serializable, setAuditActor } from "@wren/db";
import { WREN, whole } from "../../access.js";
import { spendGrant } from "../../grants.js";
import { accessOf, PortalRefusal, type SignedViewer, teamCan } from "../../portal.js";
import { finishRun, openRun } from "../../runs.js";
import { type HandlerRow, handlersOf, isPortal } from "../handlers.js";
import type { ConsoleContext } from "./context.js";
import { type CallRequest, callCommand } from "./requests.js";

/**
 * Does a handler's input value name row `id`: the id itself, or a list of just it. A row id may
 * carry its kind ("draft:3"); the input names the bare id.
 */
function names(v: unknown, id: string): boolean {
  const bare = id.slice(id.indexOf(":") + 1);
  const one = Array.isArray(v) ? (v.length === 1 ? v[0] : undefined) : v;
  return (
    (typeof one === "string" || typeof one === "number") &&
    (String(one) === id || String(one) === bare)
  );
}

export function callsHandlers(ctx: ConsoleContext) {
  const { main, adminGet, team, rowAt, verbAt, typesFor } = ctx;
  return {
    /** The loop `req` names, if `loops` listed it; anything else names no loop. */
    /** The read `call` journals: the handler `req` names, as a list of 0 or 1. Refused before it, as `adminFor` is. */
    reader(req: CallRequest): () => Promise<HandlerRow[]> {
      team(req);
      const get = adminGet;
      if (!get) throw new PortalRefusal("this worker has no Restate admin URL", 503);
      return async () =>
        handlersOf(await get("/services")).filter(
          (h) => h.service === req.service && h.handler === req.handler,
        );
    },
    /**
     * The handler `req` names, if a form may call it: operator only, public, not a Portal
     * backend, a key exactly when it needs one, and its name typed in when it has an effect.
     */
    target(req: CallRequest, all: readonly HandlerRow[]): HandlerRow {
      team(req);
      if (typeof req.service !== "string" || typeof req.handler !== "string")
        throw new PortalRefusal("say service and handler", 400);
      if (isPortal(req.service)) throw new PortalRefusal("a Portal's handlers are its app's", 403);
      const h = all.find((x) => x.service === req.service && x.handler === req.handler);
      if (!h) throw new PortalRefusal("no such handler", 404);
      if (!h.public) throw new PortalRefusal("that handler is never called from outside", 403);
      const keyed = h.kind !== "service";
      if (keyed !== (typeof req.key === "string" && req.key !== ""))
        throw new PortalRefusal(keyed ? "say the key" : "a service takes no key", 400);
      if (h.effect && !teamCan(req, "effect", WREN))
        throw new PortalRefusal(`it ${h.effect}: your role can't do that`, 403);
      if (h.effect && req.confirm !== h.handler)
        throw new PortalRefusal(`it ${h.effect}: type ${h.handler} to confirm`, 400);
      return h;
    },
    /**
     * Whether this teammate may make this call: anyone with `run` over all of Wren may; anyone
     * else only a call its row's type declares, naming that row, on a row they may act on. A
     * counted grant is spent here, in its own transaction, before the call goes out.
     */
    async callOn(req: CallRequest, h: HandlerRow): Promise<void> {
      if (whole(accessOf(req), "run", WREN)) return;
      const on = req.on;
      const record = typeof on?.record === "string" ? on.record : "";
      const id = typeof on?.id === "string" || typeof on?.id === "number" ? String(on.id) : "";
      if (!record || !id) throw new PortalRefusal("your role can't do that", 403);
      const t = (await typesFor(req)).find((x) => x.id === record);
      if (!t) throw new PortalRefusal("no such record", 404);
      const key = t.calls?.[`${h.service}/${h.handler}`];
      if (!key) throw new PortalRefusal(`your role can't do that on ${t.name.many}`, 403);
      if (!names((req.input as Record<string, unknown> | undefined)?.[key], id))
        throw new PortalRefusal("that call isn't about this row", 400);
      const at = await rowAt(t, id);
      if (!at) throw new PortalRefusal(`no such ${t.name.one}`, 404);
      const verb = verbAt(req, "run", at);
      if (!verb) throw new PortalRefusal("your role can't do that here", 403);
      await serializable(main, async (tx) => {
        await setAuditActor(tx, (req.viewer as SignedViewer).email);
        await spendGrant(tx, accessOf(req), verb, at);
      });
    },
    /** The runs row for one call: who, what, with what. Never the answer. */
    openCall: (req: CallRequest, h: HandlerRow) =>
      openRun(main, {
        command: callCommand(h.service, h.handler),
        argv: {
          by: (req.viewer as SignedViewer).email,
          ...(req.key ? { key: req.key } : {}),
          input: req.input ?? null,
        },
      }).then((r) => r.id),
    closeCall: (runId: string, error: string | null) =>
      finishRun(main, runId, error === null ? { ok: true } : { error: error.slice(0, 5000) }),
  };
}
