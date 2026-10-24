/**
 * Cold outreach on Reddit and LinkedIn over the Mac's desk worker: sender, watch, desk,
 * comment proofs and Reddit reads.
 */
import { DEFAULT_VOICE, putMedia } from "@wren/content";
import { ourPosts } from "@wren/content/our-posts";
import { settingsFor } from "@wren/core/clients";
import { wrenFacts } from "@wren/core/facts";
import { discoverySettingsSchema, WREN_AUDIENCE } from "@wren/outreach";
import {
  makeCommentProofs,
  makeReachDesk,
  makeReachSender,
  makeReachWatch,
  makeRedditReads,
} from "@wren/outreach/restate";
import { type AnyService, type Deps, playbooksOf } from "./deps.js";

/** The reach domain's services, in the order they were served from `services.ts`. */
export function reachServices(deps: Deps): AnyService[] {
  const { db, draftsLlm, log, mediaBucket, reach, reachNotify, settings, voice } = deps;
  const services: AnyService[] = [];
  // Cold outreach on Reddit and LinkedIn, over the Mac's desk worker as each
  // reach account. Always bound: the sender and watch are off until
  // `wren reach queue start` / `wren reach watch start`, and nothing leaves
  // until WREN_REACH_LIVE says so.
  if (!settings.reachLive) log.info("WREN_REACH_LIVE off: reach plans and holds, nothing is sent");
  services.push(
    makeReachSender(reach),
    makeReachWatch(reach),
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
    // Reddit discovery reads signed out; drafts in the content voice, researched against the SOPs.
    makeRedditReads({
      ...reach,
      discovery: {
        llm: draftsLlm,
        voice: voice ?? DEFAULT_VOICE,
        facts: () => playbooksOf(db),
        truths: () => wrenFacts(db),
        ours: () => ourPosts(db),
        // Wren's saved block (Shop → Reddit discovery); a bad one reads as the default.
        audience: async () => {
          const got = discoverySettingsSchema.safeParse(
            (await settingsFor(db, null))["reddit.discovery"] ?? {},
          );
          return got.success ? got.data : WREN_AUDIENCE;
        },
      },
    }),
  );
  return services;
}
