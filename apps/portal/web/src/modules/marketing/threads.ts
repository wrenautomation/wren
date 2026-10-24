/**
 * Thread row actions: a comment drafted on someone else's post, and a found thread's reply.
 */
import type { Action } from "@wren/ui";
import { draftActions } from "./ask.js";
import { REJECT_FORM, said } from "./drafts.js";
import { DISCOVERY_READ } from "./places.js";

/** A comment drafted on someone else's post (LinkedIn, X, Instagram): his click posts it, with a like and follow when set. */
export const ONPOST_ACTIONS: Action[] = [
  {
    id: "marketing.onpostComment",
    label: "Comment",
    icon: "reply",
    handler: "marketing/onpostComment",
    confirm: "Post this comment on their post?",
    key: "r",
    done: said("Commented"),
  },
  {
    id: "marketing.onpostLike",
    label: "Like only",
    icon: "heart",
    handler: "marketing/onpostLike",
    confirm: "Like their post without commenting?",
    done: said("Liked"),
  },
  {
    id: "marketing.onpostFollow",
    label: "Follow only",
    icon: "addPerson",
    handler: "marketing/onpostFollow",
    confirm: "Follow them without commenting?",
    done: said("Following"),
  },
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
];

export const THREAD_ACTIONS: Action[] = [
  {
    id: "marketing.threadComment",
    label: "Comment",
    icon: "reply",
    handler: "marketing/threadComment",
    confirm: "Post this comment in the thread?",
    key: "r",
    when: { state: ["queued"] },
    done: said("Commented"),
  },
  {
    id: "marketing.threadSkip",
    label: "Skip",
    icon: "close",
    handler: "marketing/threadSkip",
    bulk: true,
    key: "e",
    when: { state: ["new", "ranked", "queued"] },
    done: said("Skipped"),
  },
  ...draftActions("thread", { state: ["new", "ranked", "queued"] }),
  DISCOVERY_READ,
];
