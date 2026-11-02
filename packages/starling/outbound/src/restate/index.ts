/**
 * Cold outreach on Restate:
 *
 * - `ReachSender/fleet`: the send loop. One pass = one tick (tick.ts) over
 *   the journal: database steps in `ctx.run`, platform calls as journaled
 *   calls to the Mac's desk. Next pass after the gap when it sent, five
 *   minutes when nothing could go. Off until `wren reach queue start`.
 * - `ReachWatch/daily`: reads each account's inbox on the warm cadence
 *   (`@wren/core/warm`): every 2 minutes right after a touch, easing to 30.
 *   DMs become replies, comments on our posts and under our comments become
 *   `comments` rows and events on the `reach.comments` workflow. Then each
 *   account's health (the warmup ladder runs on it). A send, an answer or a
 *   post wakes it, so the first check comes at once. Every 6 hours the
 *   LinkedIn invites account (Shop → LinkedIn invites) is swept for accepts
 *   and stale invites, then topped up (invites.ts). Last, DM drafts for threads
 *   waiting on William and accepted invites (drafts.ts), at most 30 a day.
 * - `ReachDesk`: the operator's reads and writes (accounts, finds, enrich,
 *   enroll, templates, threads), each one journaled.
 */

export type { Platform } from "../schema.js";
export {
  channelsFor,
  clientDeps,
  finalRefusal,
  type ReachClients,
  type ReachDeps,
  type ReachView,
  SENDER_KEY,
  WATCH_KEY,
  wakeWatch,
} from "./deps.js";
export { makeReachDesk, type PostSettle, type ReachDeskService, terminalWhy } from "./desk.js";
export {
  type DiscoveryDeps,
  makeRedditReads,
  READS_KEY,
  type RedditReadsObject,
} from "./discovery.js";
export {
  isSendNotSent,
  isSendTaken,
  isSendUnsure,
  SendNotSent,
  SendTaken,
  SendUnsure,
  sendAtMostOnce,
  sendError,
} from "./maybe-sent.js";
export {
  type CommentProofsService,
  makeCommentProofs,
  PROOFS_SERVICE,
  type ProofCheck,
  type ProofsDeps,
  scheduleProofs,
} from "./proofs.js";
export { makeReachSender, type ReachSender, reachDelayMs } from "./sender.js";
export {
  type InvitesPass,
  makeReachWatch,
  type ReachWatchObject,
  type ThreadsStats,
  type WatchStats,
} from "./watch.js";
