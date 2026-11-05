/**
 * Outreach → Engage: its draft boxes and actions, and Feed's Explore.
 */

import { type Action, said } from "@wren/ui";
import { ONPOST_DRAFT, THREAD_DRAFT } from "./approval.js";
import { type DraftOf, draftActions } from "./ask.js";
import { PASS_ACTION } from "./drafts.js";
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
