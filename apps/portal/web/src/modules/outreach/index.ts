import { createElement } from "react";
import type { ListPage, Module } from "../../module.js";
import { draftActions, withDraft } from "../marketing/ask.js";
import { dmExtras } from "../marketing/dms.js";
import {
  ACCOUNT_ACTIONS,
  CONNECT_ACTIONS,
  DM_ACTIONS,
  DM_CANCEL,
  DM_DRAFT,
  ENGAGE_ACTIONS,
  ENGAGE_DRAFT,
  INVITE_ACTIONS,
  INVITE_DRAFT,
  MARKETING_PAGES,
} from "../marketing/index.js";
import { withProof } from "../marketing/proof.js";
import { withThread } from "../marketing/thread-context.js";
import { EngageHead } from "./engage.js";

const P = MARKETING_PAGES;

const GONE_VIEWS = new Set(["inbound", "outbound", "ours", "dms"]);

/** Comments to write on others' ground, and what went out with its proof. */
const ENGAGE_PAGE: ListPage = {
  id: "engage",
  label: "Engage",
  about: "Comments to write on other people's posts and threads.",
  template: "list",
  record: "marketing.engage",
  columns: ["who", "platform", "type", "state", "pick", "held", "proof", "at"],
  empty: {
    waiting: "No comment waits on you. Paste a link above to add one.",
    held: "No comment is held. One shows here when its subreddit asks for more karma or an older account than ours has.",
    posted: "Comments we send show here, each checked for a signed-out reader.",
    notlive: "Every sent comment checked so far is live for strangers.",
    threads: "No Reddit thread waits. Paste a subreddit to watch it, or a thread to answer it.",
    posts: "No one else's post waits. Paste one, or an account to follow.",
    all: "Reddit threads and others' posts with our comment show here.",
  },
  // The mixed queue's old views: replies to us live in this app's Inbox now.
  legacy: (params) => (GONE_VIEWS.has(params.get("view") ?? "") ? { view: null } : null),
  actions: ENGAGE_ACTIONS,
  extras: withDraft(
    (row) => ENGAGE_DRAFT[String(row.type)] ?? null,
    withThread(withProof(() => ({ sections: [] }))),
  ),
  head: (_meta, reload, at) => createElement(EngageHead, { reload, demo: !!at.demo }),
  count: { state: ["waiting"] },
};

export const engage: Module = {
  id: "engage",
  name: "Engage",
  component: "marketing.stats",
  icon: "reply",
  blurb: "Everything said with other people: comments, DMs, invites, replies and reviews.",
  requires: { audience: "team" },
  pages: [
    ENGAGE_PAGE,
    {
      id: "dms",
      label: "DMs",
      about: "DMs to answer or send, and what we sent.",
      template: "list",
      record: "marketing.dm",
      empty: {
        todo: "No DM to answer or send.",
        sent: "DMs we sent show here.",
        waiting: "No DM waits on you.",
        replied: "Threads where they wrote back show here.",
        all: "Threads show here once reach messages someone.",
      },
      actions: [
        ...DM_ACTIONS,
        DM_CANCEL,
        ...draftActions("dm", { state: ["new", "enrolled", "connected", "replied", "finished"] }),
      ],
      extras: withDraft(DM_DRAFT, dmExtras),
      count: { turn: ["reply", "draft"] },
    },
    {
      id: "invites",
      label: "Invites",
      about: "LinkedIn invites: to approve, sent, and accepted ones to message.",
      template: "list",
      record: "marketing.invite",
      // Who and why first; the campaign, size, what it waits on and each date are a Display pick
      // away (status and days say both). All fifteen ran past the page (William, 10-23).
      columns: ["who", "headline", "company", "status", "why", "days"],
      empty: {
        proposed: "No invite waits on you. The sweep proposes the day's every 6 hours.",
        queued: "Nothing to send. Invites queue once you approve them.",
        pending: "No invite waits on an answer.",
        message: "Everyone who accepted has a message.",
        accepted: "Accepted invites show here.",
        withdrawn: "Withdrawn and ended invites show here.",
        all: "LinkedIn invites show here.",
      },
      actions: [
        ...CONNECT_ACTIONS,
        ...INVITE_ACTIONS,
        ...draftActions("invite", { status: ["accepted"] }),
      ],
      // Only an accepted invite takes a message.
      extras: withDraft((row) => (row.status === "accepted" ? INVITE_DRAFT : null)),
      count: { next: ["approve", "message"] },
    },
    P.inbox,
    P.approve,
    P.comments,
    P.conversation,
    P.followers,
    {
      id: "accounts",
      label: "Accounts",
      about:
        "Every account we post as and every API key, with its health, or its spend and last use.",
      group: "Setup",
      template: "list",
      record: "marketing.account",
      columns: [
        "name",
        "platform",
        "state",
        "health",
        "stage",
        "karma",
        "ageDays",
        "today",
        "placeCount",
        "lastSent",
        "owner",
        "purposes",
        "until",
        "spend",
        "lastUsed",
      ],
      empty: {
        live: "No account yet. Each login we post or reply as shows here once it is set up.",
        keys: "No API key yet. The operator's keys are read from the vault every hour; a client's own show when it saves one.",
        all: "Our accounts show here once reach has one.",
      },
      actions: ACCOUNT_ACTIONS,
    },
  ],
};
