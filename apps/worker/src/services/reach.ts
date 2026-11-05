/**
 * Cold outreach on Reddit and LinkedIn over the Mac's desk worker: sender, watch, desk,
 * comment proofs.
 */

import { putMedia } from "@wren/starling-inbound";
import {
  makeCommentProofs,
  makeReachDesk,
  makeReachInboxRead,
  makeReachSend,
} from "@wren/starling-outbound/restate";
import type { AnyService, Deps } from "./deps.js";

/** The reach domain's services, in the order they were served from `services.ts`. */
export function reachServices(deps: Deps): AnyService[] {
  const { db, log, mediaBucket, reach, reachNotify, settings } = deps;
  const services: AnyService[] = [];
  // Cold outreach on Reddit and LinkedIn, over the Mac's desk worker as each
  // reach account. Always bound: the sender and watch are off until
  // `wren reach queue start` / `wren reach watch start`, and nothing leaves
  // until WREN_REACH_LIVE says so.
  if (!settings.reachLive) log.info("WREN_REACH_LIVE off: reach plans and holds, nothing is sent");
  services.push(
    makeReachSend(reach),
    makeReachInboxRead(reach),
    makeReachDesk(reach),
    // Each sent comment's proof (designs/2026-10-14-comment-proof.md): read through the desk,
    // its shot in the media bucket, the hour's hidden or missing on the reach lane.
    makeCommentProofs({
      db,
      sitesFor: reach.sitesFor,
      ...(mediaBucket
        ? { keep: (jpeg: Uint8Array) => putMedia(jpeg, ".jpg", { bucket: mediaBucket }) }
        : {}),
      linkedinAccount: "linkedin@wren",
      ...reachNotify,
    }),
  );
  return services;
}
