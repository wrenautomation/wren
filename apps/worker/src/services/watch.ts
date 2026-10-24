/**
 * The Monitor: new mail onto the `watch` workflow, Learn's pictures, and the Watch and Learn
 * consoles.
 */
import { ingressOf } from "@wren/config";
import { putMedia, s3MediaHost } from "@wren/content";
import { ingressSites } from "@wren/core/content/ingress";
import { DESK } from "@wren/core/content/restate";
import { makeLearnPictures, type PictureStore } from "@wren/learn";
import { makeLearnConsole } from "@wren/learn/console";
import { gatewayEmbed } from "@wren/llm";
import { makeWatch, makeWatchConsole } from "@wren/watch/restate";
import { gmailPushTopic } from "@wrenautomation/autobrowse/google";
import { type AnyService, BOOKS_DESK_TIMEOUT_MS, type Deps, googleKey } from "./deps.js";

/** The watch domain's services, in the order they were served from `services.ts`. */
export function watchServices(deps: Deps): AnyService[] {
  const {
    bookerMailer,
    clientDb,
    db,
    gmail,
    keyPath,
    mailboxOf,
    mediaBucket,
    notify,
    settings,
    watchLlm,
  } = deps;
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
  const pictures: PictureStore | null = mediaBucket
    ? {
        put: (bytes, ext) => putMedia(bytes, ext, { bucket: mediaBucket }),
        sign: s3MediaHost({ bucket: mediaBucket }).host,
      }
    : null;
  services.push(makeLearnPictures(db, pictures));
  services.push(
    makeWatch({
      db,
      pictures,
      mailboxes: watchBoxes.map(mailboxOf("wren:watch")),
      ...(watchPush ? { watch: watchPush } : {}),
      // Learn's alerts and its 09:00 digest ride the Monitor's pass, on the main lane.
      ...notify,
      zone: settings.sendTimezone,
      portal: settings.portalOrigin ?? null,
      // Each person's Learn digest, from portal@, only in a workspace that turned it on.
      send: bookerMailer?.("Wren") ?? null,
      embed: gatewayEmbed(process.env),
      // Learn's Instagram and X creators: Graph business discovery and X's signed-in page, free.
      sites: ingressSites(ingressOf(settings), {
        caller: "wren:learn",
        service: DESK,
        timeoutMs: 60_000,
      }),
    }),
  );
  services.push(makeWatchConsole(db, watchLlm));
  services.push(makeLearnConsole(db, fetch, clientDb, gatewayEmbed(process.env)));
  return services;
}
