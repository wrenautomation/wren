/** The Monitor: new mail onto the `watch` workflow, and the Watch console. */
import { ingressOf } from "@wren/config";
import { ingressSites } from "@wren/core/autobrowse/ingress";
import { DESK } from "@wren/core/autobrowse/restate";
import { makeWatch, makeWatchConsole } from "@wren/watch/restate";
import { gmailPushTopic } from "@wrenautomation/autobrowse/google";
import { type AnyService, BOOKS_DESK_TIMEOUT_MS, type Deps, googleKey } from "./deps.js";

/** The watch domain's services, in the order they were served from `services.ts`. */
export function watchServices(deps: Deps): AnyService[] {
  const { db, gmail, keyPath, mailboxOf, settings, watchLlm } = deps;
  const services: AnyService[] = [];
  // The Monitor: new mail every 15 minutes, onto the `watch` workflow; off until `wren watch start`.
  const watchBoxes = settings.watchMailboxes.length
    ? settings.watchMailboxes
    : settings.booksMailboxes;
  // Gmail push wakes the Monitor (designs/2026-10-06-mail-push.md); prod only, as the inboxes' watches.
  const watchVia = new Map(watchBoxes.map((m) => [m.address.toLowerCase(), m.via]));
  const watchSites = ingressSites(ingressOf(settings), {
    caller: "wren:watch",
    service: DESK,
    timeoutMs: BOOKS_DESK_TIMEOUT_MS,
  });
  const watchPush =
    settings.sendTransport === "gmail"
      ? async (address: string): Promise<number | null> => {
          const via = watchVia.get(address.toLowerCase());
          if (via === "delegated")
            return gmail.watch(address, gmailPushTopic(googleKey(keyPath).clientEmail));
          if (!settings.watchSiteTopic) return null;
          const r = await watchSites.call<{ expiration: string }>(
            "gmail",
            "POST",
            "/gmail/v1/users/me/watch",
            { topicName: settings.watchSiteTopic, labelIds: ["INBOX"] },
            address,
          );
          return Number(r.expiration);
        }
      : undefined;
  services.push(
    makeWatch({
      db,
      mailboxes: watchBoxes.map(mailboxOf("wren:watch")),
      ...(watchPush ? { watch: watchPush } : {}),
    }),
  );
  services.push(makeWatchConsole(db, watchLlm));
  return services;
}
