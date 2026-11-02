/**
 * `ReachDesk`: the operator's reads and writes (accounts, finds, enrich, enroll, templates,
 * threads, comments, invites, posts, schedules), each one journaled. One context built once
 * (`desk-context.ts`), and one file per handler group that takes it: `desk-<group>.ts`.
 */
import * as restate from "@restatedev/restate-sdk";
import type { ReachDeps } from "./deps.js";
import { accountsHandlers } from "./desk-accounts.js";
import { commentsHandlers } from "./desk-comments.js";
import { contactsHandlers } from "./desk-contacts.js";
import { deskContext } from "./desk-context.js";
import { invitesHandlers } from "./desk-invites.js";
import { peopleHandlers } from "./desk-people.js";
import { postsHandlers } from "./desk-posts.js";
import { scheduleHandlers } from "./desk-schedule.js";
import { settleHandlers } from "./desk-settle.js";
import { statsHandlers } from "./desk-stats.js";
import { threadsHandlers } from "./desk-threads.js";
import { discoveryHandlers } from "./discovery.js";
import { pasteHandlers } from "./paste.js";

export { terminalWhy } from "./desk-context.js";
export type { PostSettle } from "./desk-settle.js";

export function makeReachDesk(deps: ReachDeps) {
  const desk = deskContext(deps);
  return restate.service({
    name: "ReachDesk",
    handlers: {
      ...accountsHandlers(desk),
      ...contactsHandlers(desk),
      ...threadsHandlers(desk),
      ...commentsHandlers(desk),
      ...invitesHandlers(desk),
      ...postsHandlers(desk),
      ...settleHandlers(desk),
      ...peopleHandlers(desk),
      ...scheduleHandlers(desk),
      ...discoveryHandlers(deps),
      ...pasteHandlers(deps),
      ...statsHandlers(desk),
    },
  });
}

export type ReachDeskService = ReturnType<typeof makeReachDesk>;
