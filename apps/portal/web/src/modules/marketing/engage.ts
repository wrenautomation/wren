/**
 * Outreach → Engage: its draft boxes and actions, and Feed's Explore.
 */

import { type Action, said } from "@wren/ui";
import { createElement } from "react";
import type { ListPage } from "../../module.js";
import { ONPOST_DRAFT, THREAD_DRAFT } from "./approval.js";
import { type DraftOf, draftActions } from "./ask.js";
import { PASS_ACTION, REJECT_FORM } from "./drafts.js";
import { FeedTabs } from "./feed.js";
import { only, own, threadWhen, WAITS } from "./inbox.js";
import { ONPOST_ACTIONS, THREAD_ACTIONS } from "./threads.js";

/** Outreach → Engage's row type picks its box, as on each kind's own page. */
export const ENGAGE_DRAFT: Record<string, DraftOf> = {
  thread: THREAD_DRAFT,
  onpost: ONPOST_DRAFT,
};
/** DM the author of a thread or post. On LinkedIn before they accept, an invite goes first. */
const DM_FROM_ACTION: Action = {
  id: "marketing.messageFrom",
  label: "DM them",
  icon: "dm",
  handler: "marketing/messageFrom",
  ask: { field: "body", label: "Your DM" },
  key: "m",
  done: said(
    "Queued. On LinkedIn, if you're not connected yet, an invite goes first and your DM waits.",
  ),
};

/** Outreach → Engage's actions: each kind's own, on its rows; the typed-id box, as To approve's. */
export const ENGAGE_ACTIONS: Action[] = [
  ...THREAD_ACTIONS.filter(own).map((a) => only("thread", a, threadWhen(a))),
  ...ONPOST_ACTIONS.map((a) => only("onpost", a, WAITS)),
  only("thread", DM_FROM_ACTION, WAITS),
  only("onpost", DM_FROM_ACTION, WAITS),
  PASS_ACTION,
  ...draftActions("inbox", { type: ["thread", "onpost"], state: ["waiting"] }),
];
/** Explore's picks: as if pasted (`ReachDesk.pick`), so a reply waits in Engage. */
const EXPLORE_ACTIONS: Action[] = [
  {
    id: "marketing.exploreReply",
    label: "Reply",
    icon: "reply",
    handler: "marketing/exploreReply",
    key: "r",
    done: said("It waits in Engage"),
  },
  {
    id: "marketing.exploreFollow",
    label: "Follow",
    icon: "addPerson",
    handler: "marketing/exploreFollow",
    done: said("Following"),
  },
  only(
    "onpost",
    {
      id: "marketing.onpostSkip",
      label: "Skip",
      icon: "close",
      handler: "marketing/onpostSkip",
      form: REJECT_FORM,
      each: true,
      bulk: true,
      key: "e",
      done: said("Skipped"),
    },
    {},
  ),
  only(
    "thread",
    {
      id: "marketing.threadSkip",
      label: "Skip",
      icon: "close",
      handler: "marketing/threadSkip",
      bulk: true,
      key: "e",
      done: said("Skipped"),
    },
    {},
  ),
  PASS_ACTION,
];
/** Marketing → Feed's Explore (`marketing.explore`): found by topic, not followed or picked yet. */
export const EXPLORE_PAGE: ListPage = {
  id: "explore",
  label: "Feed",
  about: "New posts the topic searches found, to reply to or follow.",
  hidden: true,
  lights: "feed",
  template: "list",
  record: "marketing.explore",
  columns: ["who", "platform", "where", "fit", "at"],
  empty: {
    best: "Nothing new was found. The topic searches run each day.",
    posts: "No new posts were found on your topics.",
    reddit: "No new Reddit threads fit.",
    new: "Nothing new was found.",
  },
  actions: EXPLORE_ACTIONS,
  head: () => createElement(FeedTabs, { on: "explore" }),
};
