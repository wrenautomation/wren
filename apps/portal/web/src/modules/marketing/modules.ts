/**
 * The Module objects: Wren's Ads and Content apps, and a client's Marketing.
 */

import { POST_NOW as POST_NOW_FLAG } from "@wren/core/marketing/console-routes";
import type { Action } from "@wren/ui";
import type { ListPage, Module } from "../../module.js";
import { BROADCAST_DECIDE_ACTIONS } from "../people/broadcasts.js";
import { ASKED_REPLY_ACTIONS } from "./approval.js";
import { AutoReplyPage } from "./auto-reply.js";
import { askedReplyExtras, conversationExtras, conversationReply } from "./conversation.js";
import { DRAFT_ACTIONS, fieldActions, OPEN, POST_ACTIONS, UNSURE_ACTIONS } from "./drafts.js";
import { withShape } from "./fields.js";
import { INBOX_THREAD_ACTIONS, only, WAITS } from "./inbox.js";
import { AD_DAYS, MARKETING_PAGES, REVIEWS_PAGE, SITE_PAGES } from "./pages.js";
import { ReportsPage } from "./reports.js";
import { withThread } from "./thread-context.js";

/** Wren's Ads app: apart from Marketing, since ads carry spend, variants and their own numbers. */
export const ads: Module = {
  id: "ads",
  name: "Ads",
  icon: "billboard",
  component: "marketing.stats",
  blurb: "Every ad set by day: spend, reach, leads and what each one cost.",
  requires: { audience: "team" },
  pages: [
    { ...AD_DAYS, id: "sets", label: "Ad sets" },
    {
      id: "formats",
      label: "Formats",
      about: "The ad formats we make, and how each one does.",
      template: "list",
      record: "ads.format",
      empty: "No formats yet.",
    },
  ],
};

const P = MARKETING_PAGES;

/**
 * Content (designs/2026-10-14-content-types.md): what to make, make it, and how it did. Plan is the
 * day (what to make, what waits, what went out), Studio makes anything new and finishes what
 * waits, Pieces lists each thing made with everywhere it went, Posts what went out. The rest
 * opens from a link and lights the tab it belongs to.
 */
export const content: Module = {
  id: "content",
  name: "Content",
  component: "marketing.stats",
  icon: "megaphone",
  blurb: "Every platform's posts: plan, make, and how each did.",
  requires: { audience: "team" },
  pages: [
    P.plan,
    P.studio,
    P.pieces,
    P.content,
    P.overview,
    P.feed,
    { ...P.topics, group: "Setup" },
    { ...P.facts, group: "Setup" },
    P.drafts,
    P.write,
    P.videos,
    P.explore,
    { ...P.today, lights: "plan" },
    { ...P.digest, lights: "overview" },
    { ...P.metrics, lights: "overview" },
    { ...P.cadence, lights: "overview" },
    { ...P.reports, hidden: true, lights: "overview" },
  ],
};

const VERDICTS = new Set(["marketing.approveDraft", "marketing.redraft", "marketing.rejectDraft"]);
/** A client's Post now: only where its portal flag is on (an app reviewer's workspace). */
const POST_NOW = { id: "marketing.postNow", flag: POST_NOW_FLAG } as const;
/** A client's own draft edits (its post's fields and files), saved from inside the detail. */
const EDITS = new Set(fieldActions(OPEN).map((a) => a.id));
/** One of Wren's Marketing pages, as a client's: its records from its own database, read only. */
const asClient = (id: string, more: Partial<ListPage> = {}): ListPage => {
  const page = [AD_DAYS, ...SITE_PAGES, ...Object.values(MARKETING_PAGES)].find(
    (p) => p.id === id,
  ) as ListPage;
  const { actions: _a, extras: _e, ...rest } = page;
  return { ...rest, ...more };
};

/**
 * A client's own Inbox action: the same as Wren's, on `MarketingConsole`'s `inbox*` routes, which
 * run InboxDesk on the client's database (`inbox/take` -> `marketing/inboxTake`). Each needs
 * `act`; a send also needs `effect` and the approver, which the desk checks.
 */
const clientInbox = (a: Action): Action => {
  const verb = a.handler.slice(a.handler.indexOf("/") + 1);
  return {
    ...a,
    handler: `marketing/inbox${verb.charAt(0).toUpperCase()}${verb.slice(1)}`,
    requires: { ...a.requires, needs: "act" },
  };
};

/** A client's To approve: Inbox replies waiting on a yes, from whoever its approver setting names. */
const CLIENT_APPROVE: ListPage = {
  id: "approve",
  label: "To approve",
  about: "Inbox replies and broadcasts that wait on a yes, and sends that may have gone out.",
  template: "list",
  record: "marketing.asked_reply",
  columns: ["who", "kind", "why", "sendAt", "held", "account", "at"],
  empty: {
    waiting: "No Inbox reply or broadcast waits on a yes.",
    queued: "Nothing is queued. A reply you approved shows here when the frequency cap holds it.",
    all: "Replies asked from the Inbox show here.",
  },
  // A broadcast's yes is People's own route, which checks the approver itself.
  actions: [
    ...ASKED_REPLY_ACTIONS.map((a) =>
      clientInbox({ ...a, when: { ...a.when, kind: ["email", "text", "dm", "comment"] } }),
    ),
    ...BROADCAST_DECIDE_ACTIONS.map((a) => ({ ...a, when: { ...WAITS, kind: ["broadcast"] } })),
    // Its own send that may have gone out: its approver's word, which the console checks.
    ...UNSURE_ACTIONS.map(
      (a): Action => ({ ...only("unsure", a, WAITS), requires: { needs: "act" } }),
    ),
  ],
  extras: (detail, at) => askedReplyExtras(detail, at.row),
};

/**
 * A client's Marketing, once `marketing.stats` is installed: its Inbox, the replies there that
 * wait on a yes, its drafts, posts, ads and search (`MarketingConsole`, its own database). Drafts take its approver's verdict, a YouTube post its
 * approver's Promote (drafts on its own logins); the rest read only.
 * Same address as Wren's; the workspace picks which.
 */
export const clientMarketing: Module = {
  id: "marketing",
  name: "Marketing",
  component: "marketing.stats",
  icon: "megaphone",
  blurb: "Your posts, drafts, ads and search in one place.",
  pages: [
    // Its own threads: reply, Suggest, notes, assign, close and snooze.
    asClient("inbox", {
      hidden: true,
      actions: INBOX_THREAD_ACTIONS.map(clientInbox),
      // A comment's whole thread, read only: its reply box answers the comment.
      extras: withThread(conversationExtras, { readOnly: true }),
      reply: conversationReply,
    }),
    {
      id: "auto-reply",
      label: "Auto-reply",
      about: "What happens when someone writes in, per channel.",
      Page: AutoReplyPage,
    },
    REVIEWS_PAGE,
    CLIENT_APPROVE,
    // The draft's own settings and preview (a TikTok post's Direct Post panel), as Wren's.
    asClient("drafts", {
      actions: DRAFT_ACTIONS.filter(
        (a) => VERDICTS.has(a.id) || EDITS.has(a.id) || a.id === POST_NOW.id,
      ).map((a) =>
        a.id === POST_NOW.id ? { ...a, requires: { ...a.requires, flag: POST_NOW.flag } } : a,
      ),
      extras: withShape(),
    }),
    asClient("content", {
      hidden: true,
      actions: POST_ACTIONS.filter((a) => a.id === "marketing.postPromote"),
    }),
    asClient("ads", { empty: "In development: ads show here once your ad account is connected." }),
    asClient("search"),
    asClient("keywords"),
    {
      id: "reports",
      label: "Reports",
      about: "Your numbers by email each week or month, against the one before.",
      Page: ReportsPage,
      requires: { needs: "manage" },
    },
  ],
};
