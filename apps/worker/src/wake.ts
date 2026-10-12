/**
 * Wake on row (designs/2026-10-11-push-not-poll.md): a row a loop must act on fires
 * `pg_notify('wren_wake', '<Service>/<unit>')` at commit (migration 0235). The box LISTENs on
 * Wren's database and each client's and calls that loop's `wake` through the ingress, keyed to
 * the database's owner: `fleet` in Wren's, `<client>/fleet` in a client's. A burst is one wake.
 * A wake lost here (the box restarting) is covered by the loop's net, so nothing waits on this.
 */

import { clientUrl, listClients } from "@wren/core/clients";
import { clientKey } from "@wren/core/restate";
import { createDb, type Listening, listen } from "@wren/db";
import type { Logger } from "pino";

export const WAKE_CHANNEL = "wren_wake";
/** Notices for one loop inside this window are one wake. */
const SETTLE_MS = 1000;
/** New clients' databases are picked up this often. */
const CLIENTS_EVERY_MS = 10 * 60_000;

/** `Service/unit` from a notice, keyed to its database's owner; null when malformed. */
export function wakeTarget(
  payload: string,
  owner: string | null,
): { service: string; key: string } | null {
  const m = /^([A-Za-z][\w]*)\/([\w.@-]+)$/.exec(payload);
  if (!m) return null;
  const [, service, unit] = m as unknown as [string, string, string];
  return { service, key: owner ? clientKey(owner, unit) : unit };
}

export interface WakeOptions {
  databaseUrl: string;
  ingress: { url: string; headers?: Record<string, string> };
  log: Logger;
  /** Test seam. */
  fetch?: typeof fetch;
}

export async function startWakes(o: WakeOptions): Promise<{ close(): Promise<void> }> {
  const send = o.fetch ?? fetch;
  const due = new Map<string, ReturnType<typeof setTimeout>>();
  const wake = (service: string, key: string) => {
    const id = `${service}/${key}`;
    if (due.has(id)) return;
    due.set(
      id,
      setTimeout(() => {
        due.delete(id);
        const url = `${o.ingress.url.replace(/\/$/, "")}/${service}/${encodeURIComponent(key)}/wake/send`;
        send(url, { method: "POST", headers: o.ingress.headers ?? {} })
          .then((r) => {
            if (!r.ok) o.log.warn({ service, key, status: r.status }, "wake refused");
          })
          .catch((e: unknown) => o.log.warn({ service, key, err: String(e) }, "wake failed"));
      }, SETTLE_MS),
    );
  };
  const open = new Map<string, Listening>();
  const on = async (owner: string | null, url: string) => {
    const name = owner ?? "";
    if (open.has(name)) return;
    try {
      open.set(
        name,
        await listen(
          url,
          WAKE_CHANNEL,
          (payload) => {
            const t = wakeTarget(payload, owner);
            if (t) wake(t.service, t.key);
            else o.log.warn({ payload, owner }, "wake notice not understood");
          },
          { app: "wren-wake" },
        ),
      );
    } catch (e) {
      o.log.warn({ owner, err: String(e) }, "wake listen failed; its loops keep their net");
    }
  };
  await on(null, o.databaseUrl);
  const main = createDb(o.databaseUrl, { max: 1, idleSeconds: 30, app: "wren-wake" });
  const clients = async () => {
    try {
      for (const c of await listClients(main.db)) await on(c.id, clientUrl(o.databaseUrl, c));
    } catch (e) {
      o.log.warn({ err: String(e) }, "wake: clients not listed");
    }
  };
  await clients();
  const timer = setInterval(clients, CLIENTS_EVERY_MS);
  timer.unref();
  o.log.info({ databases: open.size }, "wake listening");
  return {
    async close() {
      clearInterval(timer);
      for (const t of due.values()) clearTimeout(t);
      await Promise.all([...[...open.values()].map((l) => l.close()), main.close()]);
    },
  };
}
