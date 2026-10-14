/**
 * Account > Messaging: the rules a client sets for marketing messages, kept in its own database
 * (`@wren/core/message-settings`): the most messages one person gets a day and a week across email,
 * texts and DMs, whether links carry `utm_*` tags, the connected mailbox email marketing sends from
 * and the postal address it carries. Who may change them is the route's `manage`
 * need; a change is logged as the person who made it.
 */

import type { Client } from "@wren/core/clients";
import {
  capOf,
  type MessageSettings,
  postalOf,
  saveMessageSettings,
} from "@wren/core/message-settings";
import { PortalRefusal, type PortalRequest, pickForWrite } from "@wren/core/portal";
import { type Db, serializable, setAuditActor } from "@wren/db";

/** The rows `delivery.messaging` shows, in order. */
export const MESSAGING_ROWS = ["caps.day", "caps.week", "links", "sender", "postal"] as const;

/** A cap as a person reads it. */
export const capText = (n: number | null): string => (n === null ? "No cap" : String(n));

export interface MessagingDeps {
  main: Db;
  /** A client's own database; without it nothing here changes. */
  open?: ((client: Pick<Client, "id" | "database">) => Db) | undefined;
  /** The client's mailboxes that can send now; unset, no sender can be picked. */
  senders?: ((client: string) => Promise<string[]>) | undefined;
}

type Change = PortalRequest & { ids: string[]; value?: string };
type Done = { done: string[]; skipped: string[] };

export function messagingApi(deps: MessagingDeps) {
  const change = async (
    req: PortalRequest,
    patch: Partial<MessageSettings>,
    check?: (client: Client) => Promise<void>,
  ) => {
    const { client, viewer } = await pickForWrite(deps.main, req);
    if (!deps.open) throw new PortalRefusal("message rules aren't set up here", 409);
    await check?.(client);
    return serializable(deps.open(client), async (tx) => {
      await setAuditActor(tx, viewer.email);
      return saveMessageSettings(tx, patch, viewer.email);
    });
  };
  const only = (req: Change, ids: readonly string[]): string => {
    const id = Array.isArray(req.ids) && req.ids.length === 1 ? req.ids[0] : undefined;
    if (!id || !ids.includes(id)) throw new PortalRefusal("that isn't a message rule", 404);
    return id;
  };
  return {
    /** A cap: a whole number, or off. */
    messagingChange: async (req: Change): Promise<Done> => {
      const id = only(req, ["caps.day", "caps.week"]);
      let cap: number | null;
      try {
        cap = capOf(req.value);
      } catch (err) {
        throw new PortalRefusal(err instanceof Error ? err.message : String(err), 400);
      }
      try {
        await change(req, id === "caps.day" ? { capPerDay: cap } : { capPerWeek: cap });
      } catch (err) {
        if (err instanceof RangeError) throw new PortalRefusal(err.message, 400);
        throw err;
      }
      return { done: [id], skipped: [] };
    },
    /** The mailbox email marketing sends from: one connected in Mailboxes. Blank clears it. */
    messagingSender: async (req: Change): Promise<Done> => {
      const id = only(req, ["sender"]);
      const at = String(req.value ?? "")
        .trim()
        .toLowerCase();
      await change(req, { sender: at || null }, async (client) => {
        if (!at) return;
        const ok = deps.senders ? await deps.senders(client.id) : [];
        if (!ok.includes(at))
          throw new PortalRefusal(
            ok.length
              ? `${at} isn't a connected mailbox. Connected: ${ok.join(", ")}`
              : "Connect a mailbox in Account → Mailboxes first",
            400,
          );
      });
      return { done: [id], skipped: [] };
    },
    /** The postal address every marketing email carries. Blank clears it. */
    messagingPostal: async (req: Change): Promise<Done> => {
      const id = only(req, ["postal"]);
      let postal: string | null;
      try {
        postal = postalOf(req.value);
      } catch (err) {
        throw new PortalRefusal(err instanceof Error ? err.message : String(err), 400);
      }
      await change(req, { postal });
      return { done: [id], skipped: [] };
    },
    messagingLinksOn: async (req: Change): Promise<Done> => {
      const id = only(req, ["links"]);
      await change(req, { utmLinks: true });
      return { done: [id], skipped: [] };
    },
    messagingLinksOff: async (req: Change): Promise<Done> => {
      const id = only(req, ["links"]);
      await change(req, { utmLinks: false });
      return { done: [id], skipped: [] };
    },
  };
}
