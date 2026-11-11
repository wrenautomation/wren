/**
 * Wake on row (designs/2026-10-11-push-not-poll.md): a row a loop must act on fires
 * `pg_notify('wren_wake', '<Service>/<unit>')` at commit (migration 0235). The box LISTENs on
 * Wren's database and each client's and calls that loop's `wake` through the ingress, keyed to
 * the database's owner: `fleet` in Wren's, `<client>/fleet` in a client's; `all` (one loop over
 * every workspace) stays `all`. A burst is one wake,
 * and a stream of them (a pipeline writing a row a second) wakes a loop at most every `SPACE_MS`:
 * each wake is a Lambda request, and a loop woken inside its own gap only says "soon". A wake
 * lost here (the box restarting) is covered by the loop's net, so nothing waits on this.
 *
 * The same connections hear `wren_live` (migration 0385): a topic an open page shows, relayed to
 * the portal's LiveRoom (`tellLive`), with the client for a client's database.
 */

import { clientUrl, listClients } from "@wren/core/clients";
import { tellLive } from "@wren/core/live";
import { clientKey } from "@wren/core/restate";
import { createDb, type Listening, listen } from "@wren/db";
import type { Logger } from "pino";

const WAKE_CHANNEL = "wren_wake";
/** Live topics on row (migration 0385): relayed to open tabs, designs/2026-11-08-live-topics.md. */
const LIVE_CHANNEL = "wren_live";
/** A topic's pushes: the first a beat after its commit, then at most one a second. */
const LIVE_SETTLE_MS = 250;
const LIVE_SPACE_MS = 1000;
/** Notices for one loop inside this window are one wake. */
const SETTLE_MS = 1000;
/** The least time between two wakes of one loop: a storm of rows is four wakes a minute. */
const SPACE_MS = 15_000;
/** New clients' databases are picked up this often. */
const CLIENTS_EVERY_MS = 10 * 60_000;

/** Unit of a loop over every workspace (`TouchToJourney/all`): never keyed to the owner. */
const EVERY_WORKSPACE = "all";

/** `Service/unit` from a notice, keyed to its database's owner; null when malformed. */
export function wakeTarget(
  payload: string,
  owner: string | null,
): { service: string; key: string } | null {
  const m = /^([A-Za-z][\w]*)\/([\w.@-]+)$/.exec(payload);
  if (!m) return null;
  const [, service, unit] = m as unknown as [string, string, string];
  return { service, key: owner && unit !== EVERY_WORKSPACE ? clientKey(owner, unit) : unit };
}

interface WakeOptions {
  databaseUrl: string;
  ingress: { url: string; headers?: Record<string, string> };
  log: Logger;
  /** Test seam. */
  fetch?: typeof fetch;
}

/**
 * Wakes paced per loop: the first a settle after its notice, the next no sooner than `spaceMs`
 * after the last, and notices in between fold into one. `close` drops what has not gone.
 */
export function pacedWakes(
  send: (service: string, key: string) => void,
  {
    settleMs = SETTLE_MS,
    spaceMs = SPACE_MS,
    now = Date.now,
  }: {
    settleMs?: number;
    spaceMs?: number;
    now?: () => number;
  } = {},
): { wake(service: string, key: string): void; close(): void } {
  const due = new Map<string, ReturnType<typeof setTimeout>>();
  const last = new Map<string, number>();
  return {
    wake(service, key) {
      const id = `${service}/${key}`;
      if (due.has(id)) return;
      const wait = Math.max(settleMs, (last.get(id) ?? 0) + spaceMs - now());
      due.set(
        id,
        setTimeout(() => {
          due.delete(id);
          last.set(id, now());
          send(service, key);
        }, wait),
      );
    },
    close() {
      for (const t of due.values()) clearTimeout(t);
      due.clear();
    },
  };
}

export async function startWakes(o: WakeOptions): Promise<{ close(): Promise<void> }> {
  const send = o.fetch ?? fetch;
  const paced = pacedWakes((service, key) => {
    const url = `${o.ingress.url.replace(/\/$/, "")}/${service}/${encodeURIComponent(key)}/wake/send`;
    send(url, { method: "POST", headers: o.ingress.headers ?? {} })
      .then((r) => {
        if (!r.ok) o.log.warn({ service, key, status: r.status }, "wake refused");
      })
      .catch((e: unknown) => o.log.warn({ service, key, err: String(e) }, "wake failed"));
  });
  const wake = paced.wake;
  // the pacer's "service" slot carries the topic, its "key" the database's owner ("" = Wren)
  const live = pacedWakes(
    (topic, owner) =>
      void tellLive([topic], { client: owner || null }).then((ok) => {
        if (!ok) o.log.warn({ topic, owner }, "live push not sent");
      }),
    { settleMs: LIVE_SETTLE_MS, spaceMs: LIVE_SPACE_MS },
  );
  const open = new Map<string, Listening>();
  const on = async (owner: string | null, url: string) => {
    const name = owner ?? "";
    if (open.has(name)) return;
    try {
      open.set(
        name,
        await listen(
          url,
          {
            [WAKE_CHANNEL]: (payload) => {
              const t = wakeTarget(payload, owner);
              if (t) wake(t.service, t.key);
              else o.log.warn({ payload, owner }, "wake notice not understood");
            },
            [LIVE_CHANNEL]: (topic) => live.wake(topic, name),
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
      paced.close();
      live.close();
      await Promise.all([...[...open.values()].map((l) => l.close()), main.close()]);
    },
  };
}
