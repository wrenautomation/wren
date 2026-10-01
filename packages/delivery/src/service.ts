/**
 * Delivery as a Restate service on the worker, beside each product's portal
 * service: the edge Worker checks who is asking and passes the viewer, this
 * picks the client. Clients answer asks and decide deliverables; the rest is
 * Wren's team. The demo reads its sample and writes nothing.
 */
import * as restate from "@restatedev/restate-sdk";
import type { Client } from "@wren/core/clients";
import {
  answer,
  isOperator,
  type Me,
  PortalRefusal,
  type PortalRequest,
  pickClient,
  pickForWrite,
  portalMe,
  type SignedViewer,
} from "@wren/core/portal";
import { type Db, type Queryable, setAuditActor } from "@wren/db";
import {
  addAsk,
  addDeliverable,
  answerAsk,
  type DeliveryHome,
  DeliveryRefusal,
  decideDeliverable,
  deliveryHome,
  type Engagement,
  engagementOf,
  hideUpdate,
  markDone,
  postUpdate,
  recordResult,
  slipMilestone,
  startEngagement,
  timeline,
  type UpdateView,
} from "./index.js";
import { DELIVERABLE_KINDS, type DeliverableKind } from "./schema.js";

export interface DeliveryDeps {
  /** The main database: the registry and the delivery schema. */
  main: Db;
  /** What the demo host calls its client. */
  demoName: string;
}

/** A browser can send anything: these turn it into what the domain takes, or refuse. */
const textOf = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v : undefined;
const needText = (v: unknown, what: string): string => {
  const t = textOf(v);
  if (t === undefined) throw new PortalRefusal(`${what} is missing`, 400);
  return t;
};
const idOf = (v: unknown, what: string): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : Number.NaN;
  if (!Number.isSafeInteger(n) || n <= 0) throw new PortalRefusal(`no such ${what}`, 404);
  return n;
};
const maybeId = (v: unknown, what: string) =>
  v === undefined || v === null ? undefined : idOf(v, what);

/** Read as the viewer: an operator sees internal notes, a client never does. */
async function read<T>(
  deps: DeliveryDeps,
  req: PortalRequest,
  view: (db: Queryable, client: Client, operator: boolean) => Promise<T>,
): Promise<T> {
  const client = await pickClient(deps.main, req);
  return view(deps.main, client, isOperator(req.viewer));
}

/**
 * A change in one transaction, logged as this person's. `team` writes are
 * Wren's only. A domain refusal leaves with its status.
 * ponytail: no journal, so a lost reply after commit retries the write (a
 * doubled update); add an idempotency key from the browser if that shows up.
 */
async function write<T>(
  deps: DeliveryDeps,
  req: PortalRequest,
  who: "client" | "team",
  change: (db: Queryable, client: Client, viewer: SignedViewer) => Promise<T>,
): Promise<T> {
  const { client, viewer } = await pickForWrite(deps.main, req);
  if (who === "team" && !viewer.operator) throw new PortalRefusal("that's for Wren's team", 403);
  try {
    return await deps.main.transaction(async (tx) => {
      await setAuditActor(tx, viewer.email);
      return change(tx, client, viewer);
    });
  } catch (err) {
    if (err instanceof DeliveryRefusal) throw new PortalRefusal(err.message, err.status);
    throw err;
  }
}

type EngagementReq = PortalRequest & { engagementId?: number };
const engagementFor = (db: Queryable, client: Client, req: EngagementReq): Promise<Engagement> =>
  engagementOf(db, client.id, maybeId(req.engagementId, "engagement"));

/** The handlers as plain functions: the service wraps them, tests call them. */
export function deliveryApi(deps: DeliveryDeps) {
  return {
    me: (req: PortalRequest): Promise<Me> => portalMe(deps.main, req.viewer, deps.demoName),
    home: (req: PortalRequest): Promise<DeliveryHome> =>
      read(deps, req, (db, c, operator) => deliveryHome(db, c.id, { operator })),
    updates: (
      req: EngagementReq & { before?: number },
    ): Promise<{ updates: UpdateView[]; more: boolean }> =>
      read(deps, req, (db, c, operator) => {
        const engagementId = maybeId(req.engagementId, "engagement");
        const before = maybeId(req.before, "update");
        return timeline(db, c.id, {
          operator,
          ...(engagementId === undefined ? {} : { engagementId }),
          ...(before === undefined ? {} : { before }),
        });
      }),

    /** The client answers an ask in place. */
    answer: (req: PortalRequest & { askId: number; answer?: string }) =>
      write(deps, req, "client", async (db, c, v) => {
        const a = await answerAsk(db, c.id, {
          id: idOf(req.askId, "ask"),
          answer: needText(req.answer, "the answer"),
          by: v.email,
        });
        return { id: a.id, answeredAt: a.answeredAt?.toISOString() ?? null };
      }),
    /** The client approves a deliverable, or asks for changes. */
    decide: (req: PortalRequest & { deliverableId: number; decision: string; note?: string }) =>
      write(deps, req, "client", async (db, c, v) => {
        if (req.decision !== "approved" && req.decision !== "changes")
          throw new PortalRefusal("approve it or ask for changes", 400);
        const d = await decideDeliverable(db, c.id, {
          id: idOf(req.deliverableId, "deliverable"),
          decision: req.decision,
          note: textOf(req.note),
          by: v.email,
        });
        return { id: d.id, status: d.status };
      }),

    start: (req: PortalRequest & { offerId: string; startsOn: string }) =>
      write(deps, req, "team", async (db, c, v) => {
        const e = await startEngagement(db, {
          clientId: c.id,
          offerId: needText(req.offerId, "the offer"),
          startsOn: needText(req.startsOn, "the start"),
          by: v.email,
        });
        return { id: e.id };
      }),
    post: (req: EngagementReq & { body: string; step?: string; internal?: boolean }) =>
      write(deps, req, "team", async (db, c, v) => {
        const u = await postUpdate(db, await engagementFor(db, c, req), {
          body: needText(req.body, "the update"),
          author: v.email,
          milestone: textOf(req.step),
          internal: req.internal === true,
        });
        return { id: u.id };
      }),
    deliver: (
      req: EngagementReq & {
        title: string;
        kind: string;
        url?: string;
        fileKey?: string;
        step?: string;
        replaces?: number;
      },
    ) =>
      write(deps, req, "team", async (db, c, v) => {
        if (!DELIVERABLE_KINDS.includes(req.kind as DeliverableKind))
          throw new PortalRefusal(`a deliverable is a ${DELIVERABLE_KINDS.join(", ")}`, 400);
        const replaces = maybeId(req.replaces, "deliverable");
        const d = await addDeliverable(db, await engagementFor(db, c, req), {
          title: needText(req.title, "the title"),
          kind: req.kind as DeliverableKind,
          url: textOf(req.url),
          fileKey: textOf(req.fileKey),
          milestone: textOf(req.step),
          replaces,
          by: v.email,
        });
        return { id: d.id, version: d.version };
      }),
    ask: (req: EngagementReq & { text: string; dueOn?: string; step?: string }) =>
      write(deps, req, "team", async (db, c, v) => {
        const a = await addAsk(db, await engagementFor(db, c, req), {
          text: needText(req.text, "the ask"),
          dueOn: textOf(req.dueOn),
          milestone: textOf(req.step),
          by: v.email,
        });
        return { id: a.id };
      }),
    done: (req: EngagementReq & { step: string; on?: string | null }) =>
      write(deps, req, "team", async (db, c) => {
        const m = await markDone(db, await engagementFor(db, c, req), {
          milestone: needText(req.step, "the step"),
          on: req.on === null ? null : (textOf(req.on) ?? new Date().toISOString().slice(0, 10)),
        });
        return { step: m.key, doneOn: m.doneOn };
      }),
    slip: (req: EngagementReq & { step: string; to: string; reason: string }) =>
      write(deps, req, "team", async (db, c) => {
        const m = await slipMilestone(db, await engagementFor(db, c, req), {
          milestone: needText(req.step, "the step"),
          to: needText(req.to, "the new date"),
          reason: needText(req.reason, "the reason"),
        });
        return { step: m.key, dueOn: m.dueOn };
      }),
    result: (req: EngagementReq & { key: string; value: number; note?: string }) =>
      write(deps, req, "team", async (db, c, v) => {
        if (typeof req.value !== "number") throw new PortalRefusal("the value isn't a number", 400);
        await recordResult(db, await engagementFor(db, c, req), {
          key: needText(req.key, "the measure"),
          value: req.value,
          note: textOf(req.note),
          by: v.email,
        });
        return { key: req.key, value: req.value };
      }),
    hide: (req: PortalRequest & { updateId: number }) =>
      write(deps, req, "team", async (db, c) => {
        await hideUpdate(db, c.id, idOf(req.updateId, "update"));
        return { hidden: true };
      }),
  };
}

export type DeliveryApi = ReturnType<typeof deliveryApi>;
export type { Me } from "@wren/core/portal";
export type {
  AskView,
  DeliverableView,
  DeliveryHome,
  EngagementView,
  MilestoneState,
  ResultView,
  StepView,
  UpdateView,
} from "./index.js";
export { DELIVERY_ROUTES, DELIVERY_WRITES } from "./routes.js";

/** No journal, like every portal service: pages stay out of Restate's storage. */
export function makeDeliveryPortal(deps: DeliveryDeps) {
  const api = deliveryApi(deps);
  type Req<K extends keyof DeliveryApi> = Parameters<DeliveryApi[K]>[0];
  return restate.service({
    name: "DeliveryPortal",
    handlers: {
      me: (_: restate.Context, req: Req<"me">) => answer(() => api.me(req)),
      home: (_: restate.Context, req: Req<"home">) => answer(() => api.home(req)),
      updates: (_: restate.Context, req: Req<"updates">) => answer(() => api.updates(req)),
      answer: (_: restate.Context, req: Req<"answer">) => answer(() => api.answer(req)),
      decide: (_: restate.Context, req: Req<"decide">) => answer(() => api.decide(req)),
      start: (_: restate.Context, req: Req<"start">) => answer(() => api.start(req)),
      post: (_: restate.Context, req: Req<"post">) => answer(() => api.post(req)),
      deliver: (_: restate.Context, req: Req<"deliver">) => answer(() => api.deliver(req)),
      ask: (_: restate.Context, req: Req<"ask">) => answer(() => api.ask(req)),
      done: (_: restate.Context, req: Req<"done">) => answer(() => api.done(req)),
      slip: (_: restate.Context, req: Req<"slip">) => answer(() => api.slip(req)),
      result: (_: restate.Context, req: Req<"result">) => answer(() => api.result(req)),
      hide: (_: restate.Context, req: Req<"hide">) => answer(() => api.hide(req)),
    },
  });
}
