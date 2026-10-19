/**
 * Engage (designs/2026-10-16-outreach-app.md, 2026-10-19-portal-reshape.md): everything said to and
 * with other people. Comments on others' posts, DMs, Invites and People, then the Inbox and To
 * approve, the comments on our own posts, reviews, the conversation's speed, followers and
 * subscribers; Reddit's threads and places; and, under Setup, the accounts we send as, the DMs'
 * words, the auto-reply and the comment keywords. Records stay `marketing.*`; the app was Outreach,
 * and old `/outreach/...`, `/marketing/...` and Inbox addresses redirect here (`../../moved.ts`).
 */
import type { Action } from "@wren/ui";
import { createElement } from "react";
import { findRecords } from "../../find.js";
import type { ListPage, Module } from "../../module.js";
import { draftActions, withDraft } from "../marketing/ask.js";
import { ENGAGE_CARD } from "../marketing/cards.js";
import { copyExtras, dmExtras } from "../marketing/dms.js";
import { factsDropped } from "../marketing/facts.js";
import {
  ACCOUNT_ACTIONS,
  CONNECT_ACTIONS,
  DM_ACTIONS,
  DM_DRAFT,
  ENGAGE_ACTIONS,
  ENGAGE_DRAFT,
  INVITE_ACTIONS,
  INVITE_DRAFT,
  MARKETING_PAGES,
  PLACE_ACTIONS,
  THREAD_ACTIONS,
  THREAD_DRAFT,
} from "../marketing/index.js";
import { withProof } from "../marketing/proof.js";
import { withThread } from "../marketing/thread-context.js";
import { EngageHead } from "./engage.js";

const P = MARKETING_PAGES;
/** A page of Marketing's, taken in without the heading it had there. */
const bare = ({ group: _, ...page }: ListPage): ListPage => page;

const said = (line: string) => () => line;

const PERSON_ACTIONS: Action[] = [
  {
    id: "marketing.personDraft",
    label: "Draft",
    handler: "marketing/personDraft",
    key: "d",
    when: { can: ["message"] },
    done: said("Drafted. Message opens with it."),
  },
  {
    id: "marketing.personMessage",
    label: "Message",
    handler: "marketing/personMessage",
    ask: { field: "body", label: "Your message", from: "draft" },
    key: "r",
    when: { can: ["message"] },
    done: said("Queued. It leaves on the next tick."),
  },
  {
    id: "marketing.personInvite",
    label: "Invite",
    handler: "marketing/personInvite",
    confirm: "Send them a LinkedIn invite?",
    key: "i",
    when: { can: ["invite"] },
    done: said("Queued. It leaves under the day's invite cap."),
  },
  {
    id: "marketing.personFollow",
    label: "Follow",
    handler: "marketing/personFollow",
    confirm: "Follow them from Wren's account?",
    key: "f",
    when: { platform: ["linkedin", "x", "instagram"] },
    done: said("Followed."),
  },
];

const GONE_VIEWS = new Set(["inbound", "outbound", "ours", "dms"]);

/** Comments to write on others' ground, and what went out with its proof. */
const ENGAGE_PAGE: ListPage = {
  id: "engage",
  label: "Engage",
  about: "Comments to write on other people's posts and threads.",
  template: "list",
  record: "marketing.engage",
  card: ENGAGE_CARD,
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
  find: findRecords({ record: "marketing.person", path: "/engage/people", kind: "Person" }),
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
    {
      id: "people",
      label: "People",
      about: "People you can message, and what's open with each.",
      template: "list",
      record: "marketing.person",
      empty: {
        message: "No one to message yet. Accepted invites and Reddit people show here.",
        invite: "No one to invite. People with a LinkedIn page show here.",
        all: "People with a LinkedIn page or a Reddit read show here.",
      },
      actions: PERSON_ACTIONS,
    },
    P.inbox,
    P.approve,
    P.comments,
    bare(P.reviews),
    P.conversation,
    P.followers,
    P.subscribers,
    {
      id: "threads",
      label: "Thread replies",
      about: "New posts in the places you watch, each with a reply drafted.",
      group: "Reddit",
      template: "list",
      record: "marketing.thread",
      empty: {
        queued: "No thread to answer. Watch a place to read its new posts.",
        commented: "Threads we commented in show here.",
        all: "New posts in watched places show here.",
      },
      actions: THREAD_ACTIONS,
      extras: withDraft(THREAD_DRAFT, factsDropped("dropped", "Dropped because")),
    },
    {
      id: "places",
      label: "Places",
      about: "Subreddits worth posting in, and what each one wants.",
      group: "Reddit",
      template: "list",
      record: "marketing.place",
      empty: {
        found: "Nothing to pick. Places are found once a month from the audience.",
        watching: "No place watched yet. Pick one under To pick.",
        held: "No subreddit holds our comments back. One shows here when it asks for more karma or an older account than we have.",
        all: "Subreddits found for the audience show here.",
      },
      actions: PLACE_ACTIONS,
    },
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
    {
      id: "dm-copy",
      label: "DM copy",
      about: "The words each DM sends, slot by slot.",
      group: "Setup",
      template: "list",
      record: "marketing.dm_copy",
      empty: { empty: "Every slot has words.", all: "No reach sequence has slots." },
      extras: copyExtras,
    },
    { ...P["auto-reply"], group: "Setup" },
    { ...P.keywords, group: "Setup" },
    { ...P["keyword-dms"], group: "Setup" },
  ],
};
