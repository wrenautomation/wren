/**
 * Account > Webhooks (designs/2026-10-07-webhooks-out.md): a client's URLs, the events each
 * hears, its log and the buttons on it. Anyone who may read sees them; an owner, or Wren's team
 * with `manage`, changes them. A secret shows once, on add and on rotate.
 */
import { isOwner } from "@wren/core/clients";
import {
  isDemo,
  PortalRefusal,
  type PortalRequest,
  pickClient,
  pickForWrite,
  seesInternal,
  teamCan,
} from "@wren/core/portal";
import { WEBHOOK_EVENTS } from "@wren/core/webhook-events";
import {
  addSubscription,
  deliveriesOf,
  deliveryOf,
  editSubscription,
  removeSubscription,
  reopenDelivery,
  rotateSubscription,
  SubscriptionInput,
  subscriptionsOf,
  testSubscription,
} from "@wren/core/webhooks";
import type { Db } from "@wren/db";
import { z } from "zod";

const EVENTS = Object.entries(WEBHOOK_EVENTS).map(([id, says]) => ({ id, says }));

const EDIT = z.object({
  id: z.string(),
  name: z.string().trim().min(1).max(80).optional(),
  url: z.string().trim().max(2000).optional(),
  events: z.array(z.string()).min(1).optional(),
  active: z.boolean().optional(),
});

function read<T>(schema: z.ZodType<T>, v: unknown): T {
  const got = schema.safeParse(v);
  if (!got.success) {
    const i = got.error.issues[0];
    throw new PortalRefusal(`that doesn't read: ${i?.path.join(".")} ${i?.message}`, 400);
  }
  return got.data;
}

const idOf = (req: { id?: unknown }) => (typeof req.id === "string" ? req.id : "");

export function webhooksApi(deps: { main: Db }) {
  const { main } = deps;
  const canManage = async (req: PortalRequest, client: string) =>
    seesInternal(req)
      ? teamCan(req, "manage", client)
      : !isDemo(req.viewer) && isOwner(main, client, req.viewer.email);
  /** An owner of this client, or Wren's team with `manage` there. */
  const manager = async (req: PortalRequest) => {
    const { client, viewer } = await pickForWrite(main, req);
    if (!(await canManage(req, client.id)))
      throw new PortalRefusal("only an owner of this account can do that", 403);
    return { client: client.id, by: viewer.email };
  };
  return {
    /** This client's URLs, the newest deliveries, and the events a URL may hear. */
    webhooks: async (req: PortalRequest) => {
      const client = await pickClient(main, req);
      if (isDemo(req.viewer))
        return { webhooks: [], deliveries: [], events: EVENTS, canManage: false };
      const [webhooks, deliveries] = await Promise.all([
        subscriptionsOf(main, client.id),
        deliveriesOf(main, client.id, { limit: 50 }),
      ]);
      return { webhooks, deliveries, events: EVENTS, canManage: await canManage(req, client.id) };
    },
    /** One delivery: the body as signed, and every try. */
    webhookDelivery: async (req: PortalRequest & { id?: unknown }) => {
      const client = await pickClient(main, req);
      return deliveryOf(main, client.id, idOf(req));
    },
    webhookAdd: async (
      req: PortalRequest & { name?: unknown; url?: unknown; events?: unknown },
    ) => {
      const { client, by } = await manager(req);
      return addSubscription(main, client, read(SubscriptionInput, req), by);
    },
    webhookEdit: async (req: PortalRequest & Record<string, unknown>) => {
      const { client } = await manager(req);
      const { id, name, url, events, active } = read(EDIT, req);
      return editSubscription(main, client, id, {
        ...(name === undefined ? {} : { name }),
        ...(url === undefined ? {} : { url }),
        ...(events === undefined ? {} : { events }),
        ...(active === undefined ? {} : { active }),
      });
    },
    webhookRemove: async (req: PortalRequest & { id?: unknown }) => {
      const { client } = await manager(req);
      return removeSubscription(main, client, idOf(req));
    },
    webhookRotate: async (req: PortalRequest & { id?: unknown }) => {
      const { client } = await manager(req);
      return rotateSubscription(main, client, idOf(req));
    },
    /** A signed test, sent now, logged; its status, time and the answer's start come back. */
    webhookTest: async (req: PortalRequest & { id?: unknown }) => {
      const { client } = await manager(req);
      const { answer, ...delivery } = await testSubscription(main, client, idOf(req));
      return { ...delivery, error: answer?.error ?? delivery.error };
    },
    /** The delivery's id once it's set going again; the handler sends it. */
    webhookRedeliver: async (req: PortalRequest & { id?: unknown }) => {
      const { client } = await manager(req);
      return reopenDelivery(main, client, idOf(req));
    },
  };
}
